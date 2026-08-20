/* audio-test.js — Node-only unit tests for fx/audio.js.
 *
 * Runs the real module in Node (window = globalThis, no AudioContext, no
 * document, no localStorage) and asserts:
 *   - the public API shape (window.AUDIO) and the pure test seam
 *   - SCENES/QUALITIES table integrity
 *   - midiToFreq / chordNotes / buildSteps are pure, finite, well-formed,
 *     and layer monotonically with intensity (0..3) across all 5 scenes
 *   - with no AudioContext present: ensure() is false, play() and
 *     music.start/stop are safe no-ops (no throw, no timer, no hang)
 *   - settings get/set with clamping, and a broken localStorage is safe
 *
 *   node audio-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis; // must exist before the module loads (it early-returns otherwise)

let failures = 0;
let n = 0;
function a(cond, msg) { if (!cond) throw new Error(msg); }
function t(label, fn) {
  n++;
  try {
    fn();
    console.log('PASS  ' + label.padEnd(42));
  } catch (e) {
    failures++;
    console.log('FAIL  ' + label.padEnd(42) + ' — ' + e.message);
  }
}
function loadFile(rel) {
  const f = path.join(__dirname, rel);
  vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}

loadFile('fx/audio.js');
let A = globalThis.AUDIO;
const P = globalThis.__AUDIO_PURE;

t('window.AUDIO registered with full API', () => {
  a(A && typeof A === 'object', 'window.AUDIO missing');
  for (const k of ['ensure', 'ready', 'play', 'setMuted', 'muted', 'setVolume', 'volume', 'setMusicOn', 'musicOn', 'setSfxOn', 'sfxOn']) {
    a(typeof A[k] === 'function', 'AUDIO.' + k + ' missing');
  }
  a(A.music && typeof A.music.start === 'function' && typeof A.music.stop === 'function' &&
    typeof A.music.setIntensity === 'function', 'AUDIO.music API incomplete');
});

t('__AUDIO_PURE test seam exported', () => {
  a(P && P.SCENES && P.QUALITIES, 'seam missing');
  for (const k of ['midiToFreq', 'chordNotes', 'buildSteps', 'settings']) a(P[k], 'seam.' + k + ' missing');
});

t('5 scenes, all well-formed', () => {
  a(JSON.stringify(Object.keys(P.SCENES).sort()) === JSON.stringify(['checkers', 'chess', 'menu', 'poker', 'uno']),
    'scene names: ' + Object.keys(P.SCENES).join(','));
  for (const name of Object.keys(P.SCENES)) {
    const sc = P.SCENES[name];
    a(typeof sc.bpm === 'number' && sc.bpm > 0 && sc.bpm < 300, name + ': bad bpm ' + sc.bpm);
    a(Array.isArray(sc.prog) && sc.prog.length === 4, name + ': prog must be 4 chords');
    for (const ch of sc.prog) {
      a(typeof ch.r === 'number' && P.QUALITIES[ch.q], name + ': bad chord ' + JSON.stringify(ch));
    }
    a(Array.isArray(sc.bass) && sc.bass.length >= 2, name + ': bass pattern too short');
    a(typeof sc.padG === 'number' && sc.padG > 0, name + ': padG');
    a(sc.arp || sc.stab, name + ': needs an arp or stab for layer 1');
    if (sc.arp) a(typeof sc.arp.div === 'number' && sc.arp.div >= 2, name + ': arp.div');
    if (sc.perc) a(sc.perc.length >= 2, name + ': perc too short');
  }
});

t('midiToFreq: A4=440 exact, monotonic, finite', () => {
  a(P.midiToFreq(69) === 440, 'midi 69 must be exactly 440 Hz');
  a(Math.abs(P.midiToFreq(60) - 261.6256) < 0.01, 'midi 60 ≈ 261.63 Hz, got ' + P.midiToFreq(60));
  a(Math.abs(P.midiToFreq(96) - 2093.01) < 0.1, 'midi 96 ≈ 2093 Hz (2.25 octaves above A4)');
  let prev = P.midiToFreq(-10);
  for (let m = -9; m <= 120; m++) {
    const f = P.midiToFreq(m);
    a(Number.isFinite(f) && f > prev, 'not monotonic/finite at midi ' + m);
    prev = f;
  }
});

t('chordNotes: all qualities + fallback', () => {
  const eq = (got, want, label) => a(JSON.stringify(got) === JSON.stringify(want), label + ' ' + JSON.stringify(got));
  eq(P.chordNotes(60, 'maj'), [60, 64, 67], 'maj');
  eq(P.chordNotes(60, 'min'), [60, 63, 67], 'min');
  eq(P.chordNotes(60, 'maj7'), [60, 64, 67, 71], 'maj7');
  eq(P.chordNotes(60, 'min7'), [60, 63, 67, 70], 'min7');
  eq(P.chordNotes(60, 'dom7'), [60, 64, 67, 70], 'dom7');
  eq(P.chordNotes(60, 'maj9'), [60, 64, 67, 71, 74], 'maj9');
  eq(P.chordNotes(60, 'min9'), [60, 63, 67, 70, 74], 'min9');
  eq(P.chordNotes(60, 'dom9'), [60, 64, 67, 70, 74], 'dom9');
  eq(P.chordNotes(60, 'bogus'), [60, 64, 67], 'unknown quality → maj fallback');
});

t('buildSteps: all scenes × intensities 0–3 × bars, finite + layered', () => {
  const insts = new Set(['bass', 'pad', 'pluck', 'stab', 'hat', 'brush', 'clap', 'kick', 'pulse']);
  for (const name of Object.keys(P.SCENES)) {
    for (let bar = 0; bar < 4; bar++) {
      let prevLen = -1;
      for (let lvl = 0; lvl <= 3; lvl++) {
        const steps = P.buildSteps(name, lvl, bar);
        a(steps.length > 0, name + ' lvl' + lvl + ' bar' + bar + ': empty');
        a(steps.length >= prevLen, name + ' bar' + bar + ': layer not monotonic at lvl ' + lvl);
        prevLen = steps.length;
        let bassN = 0, padN = 0;
        for (const st of steps) {
          a(insts.has(st.inst), name + ': unknown inst ' + st.inst);
          a(st.beat >= 0 && st.beat < 4, name + ': beat out of bar: ' + st.beat);
          a(Number.isFinite(st.dur) && st.dur > 0, name + ': dur');
          a(Number.isFinite(st.gain) && st.gain > 0, name + ': gain');
          if (st.inst === 'bass') { bassN++; a(Number.isFinite(st.midi), name + ': bass midi'); }
          if (st.inst === 'pad') {
            padN++;
            a(Array.isArray(st.chord) && st.chord.length >= 3 && st.chord.every(Number.isFinite), name + ': pad chord');
          }
          if (st.inst === 'pluck' || st.inst === 'stab') a(Number.isFinite(st.midi), name + ': ' + st.inst + ' midi');
        }
        a(bassN >= 1, name + ' bar' + bar + ' lvl' + lvl + ': no bass');
        a(padN === 1, name + ' bar' + bar + ' lvl' + lvl + ': expected exactly one pad, got ' + padN);
      }
    }
    // layer 2 exists only where the scene defines percussion
    if (P.SCENES[name].perc) {
      a(P.buildSteps(name, 2, 0).length > P.buildSteps(name, 1, 0).length,
        name + ': perc layer missing at intensity 2');
    }
    // layer 3 always adds something (tense pulse or lead plucks)
    a(P.buildSteps(name, 3, 0).length > P.buildSteps(name, 2, 0).length,
      name + ': layer 3 missing at intensity 3');
  }
  a(P.buildSteps('bogus', 2, 0).length === 0, 'unknown scene must return []');
});

t('no AudioContext: ensure() false, play/start/stop are safe no-ops', () => {
  a(A.ensure() === false, 'ensure() must be false without AudioContext');
  a(A.ready() === false, 'ready() must be false without AudioContext');
  A.play('move'); // no throw, no-op
  A.play('mate');
  A.play('does-not-exist');
  A.music.start('bogus'); // no throw
  A.music.start('chess'); // no throw — must NOT start the interval
  a(A.music.playing === false, 'music must not be playing');
  a(A.music.scene === null, 'music.scene must stay null');
  A.music.stop(); // no-op
  A.music.stop();
});

t('music.setIntensity: clamps to 0–3, no-op on repeat', () => {
  A.music.setIntensity(2); a(A.music.intensity === 2, 'set to 2');
  A.music.setIntensity(2); a(A.music.intensity === 2, 'repeat is a no-op');
  A.music.setIntensity(-4); a(A.music.intensity === 0, 'clamped to 0, got ' + A.music.intensity);
  A.music.setIntensity(99); a(A.music.intensity === 3, 'clamped to 3, got ' + A.music.intensity);
  A.music.setIntensity(1.4); a(A.music.intensity === 1, 'rounded to 1, got ' + A.music.intensity);
});

t('settings: mute/volume/music/sfx get+set with clamping (no storage)', () => {
  A.setMuted(true); a(A.muted() === true, 'muted on');
  A.setMuted(false); a(A.muted() === false, 'muted off');
  A.setVolume(1.5); a(A.volume() === 1, 'volume clamped to 1');
  A.setVolume(-1); a(A.volume() === 0, 'volume clamped to 0');
  A.setVolume(0.5); a(A.volume() === 0.5, 'volume 0.5');
  A.setMusicOn(false); a(A.musicOn() === false, 'musicOn off (no throw with nothing playing)');
  A.setMusicOn(true); a(A.musicOn() === true, 'musicOn on');
  A.setSfxOn(false); a(A.sfxOn() === false, 'sfxOn off');
  A.setSfxOn(true); a(A.sfxOn() === true, 'sfxOn on');
});

t('broken localStorage is swallowed (write + fresh load)', () => {
  globalThis.window.localStorage = {
    getItem: function () { throw new Error('storage boom'); },
    setItem: function () { throw new Error('storage boom'); }
  };
  A.setMuted(true); // saveSettings must not throw
  a(A.muted() === true, 'muted still applied in memory');
  A.setVolume(0.25);
  a(A.volume() === 0.25, 'volume still applied in memory');
  // fresh module load with storage throwing → defaults, no crash
  loadFile('fx/audio.js');
  A = globalThis.AUDIO;
  a(A && A.muted() === false && A.volume() === 0.8, 'defaults after load with broken storage');
  delete globalThis.window.localStorage;
});

console.log('\n' + (failures === 0 ? 'ALL GREEN' : failures + ' FAILURE(S)') + ' (' + n + ' tests)');
process.exit(failures === 0 ? 0 : 1);

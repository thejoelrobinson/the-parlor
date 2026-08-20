/* fx/audio.js — The Parlor's procedural sound engine.
 *
 * Everything is synthesized with Web Audio: no audio files, no assets, so it
 * works offline and straight from file://. Two buses (sfx + music) feed a
 * master gain and a compressor. The music engine is a look-ahead step
 * sequencer over pure-data scene tables (menu, chess, checkers, uno, poker)
 * with four intensity layers.
 *
 * Node-safe: with no AudioContext the whole module no-ops, so the headless
 * click-test and the unit tests can load it and exercise the pure parts
 * (exposed on window.__AUDIO_PURE for tests).
 *
 *   window.AUDIO = {
 *     ensure(), ready(),
 *     play(name),
 *     music: { start(scene), stop(), setIntensity(0..3), scene, playing, onchange },
 *     setMuted(b), muted(), setVolume(0..1), volume(),
 *     setMusicOn(b), musicOn(), setSfxOn(b), sfxOn()
 *   }
 *
 * Settings persist to localStorage['parlor:audio'] when available.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  /* ================= pure data & math (Node-testable) ================= */

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var QUALITIES = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    maj9: [0, 4, 7, 11, 14],
    min9: [0, 3, 7, 10, 14],
    dom9: [0, 4, 7, 10, 14]
  };

  function chordNotes(root, q) {
    var offs = QUALITIES[q] || QUALITIES.maj;
    var out = [];
    for (var i = 0; i < offs.length; i++) out.push(root + offs[i]);
    return out;
  }

  /* Scene tables.
   *   bpm     tempo
   *   swing   0..1 — offbeat 8ths delayed by swing * (1/8 of a beat)
   *   prog    one chord per bar: {r: root midi, q: quality}
   *   bass    layer-0 pattern: [{b: beat, d: semitone offset, g: gain}]
   *   padG    pad gain (layer 0)
   *   arp     layer-1 pattern: {div: subdivision of the bar, step: tone index
   *           stride, up: whether to jump an octave in the top half, g: gain}
   *   stab    layer-1 alternative: chord stabs on given beats
   *   perc    layer-2 pattern: [{b: beat, i: 'hat'|'brush'|'clap'|'kick', g}]
   *   tense   layer-3: heartbeat pulse (chess check tension)
   *   lead    layer-3: countermelody over the chord (else pulse if tense)
   */
  var SCENES = {
    menu: {
      bpm: 60, swing: 0,
      prog: [{ r: 57, q: 'min' }, { r: 53, q: 'maj' }, { r: 60, q: 'maj' }, { r: 55, q: 'maj' }], // Am F C G
      bass: [{ b: 0, d: -12, g: 0.5 }, { b: 2, d: -12, g: 0.4 }],
      padG: 0.10,
      arp: { div: 8, step: 1, up: true, g: 0.16 }
    },
    chess: {
      bpm: 54, swing: 0,
      prog: [{ r: 50, q: 'min' }, { r: 53, q: 'maj' }, { r: 60, q: 'maj' }, { r: 57, q: 'maj' }], // Dm F C A
      bass: [{ b: 0, d: -12, g: 0.55 }, { b: 2, d: -5, g: 0.4 }],
      padG: 0.12,
      arp: { div: 8, step: 1, up: true, g: 0.15 },
      tense: true
    },
    checkers: {
      bpm: 96, swing: 0,
      prog: [{ r: 52, q: 'min' }, { r: 48, q: 'maj' }, { r: 55, q: 'maj' }, { r: 50, q: 'maj' }], // Em C G D
      bass: [{ b: 0, d: -12, g: 0.55 }, { b: 1, d: -12, g: 0.35 }, { b: 2, d: -12, g: 0.5 }, { b: 3, d: -12, g: 0.35 }],
      padG: 0.08,
      arp: { div: 8, step: 2, up: false, g: 0.18 },
      perc: [{ b: 0.5, i: 'hat', g: 0.12 }, { b: 1.5, i: 'hat', g: 0.1 }, { b: 2.5, i: 'hat', g: 0.12 }, { b: 3.5, i: 'hat', g: 0.1 }]
    },
    uno: {
      bpm: 112, swing: 0,
      prog: [{ r: 48, q: 'maj' }, { r: 43, q: 'maj' }, { r: 45, q: 'min' }, { r: 41, q: 'maj' }], // C G Am F
      bass: [{ b: 0, d: -12, g: 0.6 }, { b: 1.5, d: -5, g: 0.4 }, { b: 2, d: -12, g: 0.55 }, { b: 3.5, d: 0, g: 0.35 }],
      padG: 0.07,
      arp: { div: 8, step: 1, up: true, g: 0.17 },
      perc: [
        { b: 0.5, i: 'hat', g: 0.14 }, { b: 1.5, i: 'hat', g: 0.14 },
        { b: 2.5, i: 'hat', g: 0.14 }, { b: 3.5, i: 'hat', g: 0.14 },
        { b: 1, i: 'clap', g: 0.16 }, { b: 3, i: 'clap', g: 0.16 },
        { b: 0, i: 'kick', g: 0.2 }
      ]
    },
    poker: {
      bpm: 72, swing: 0.33,
      prog: [{ r: 50, q: 'min9' }, { r: 55, q: 'dom9' }, { r: 48, q: 'maj9' }, { r: 45, q: 'dom9' }], // Dm9 G13 Cmaj9 A7
      bass: [{ b: 0, d: -12, g: 0.5 }, { b: 1, d: -12, g: 0.3 }, { b: 2, d: -12, g: 0.45 }, { b: 3, d: -12, g: 0.3 }],
      padG: 0.09,
      stab: [{ b: 0, g: 0.13 }, { b: 2.5, g: 0.11 }],
      perc: [{ b: 0, i: 'brush', g: 0.1 }, { b: 1.5, i: 'brush', g: 0.12 }, { b: 2, i: 'brush', g: 0.1 }, { b: 3.5, i: 'brush', g: 0.12 }]
    }
  };

  /* Deterministic per-bar step builder.
   * Returns [{beat, inst, midi, chord, dur, gain}] with beat in quarter notes.
   *   inst: 'bass' | 'pad' | 'pluck' | 'stab' | 'hat' | 'brush' | 'clap' | 'kick' | 'pulse'
   * Pure on purpose: the Node unit test asserts these without an AudioContext.
   */
  function buildSteps(sceneName, intensity, bar) {
    var sc = SCENES[sceneName];
    if (!sc) return [];
    var chord = sc.prog[bar % sc.prog.length];
    var tones = chordNotes(chord.r, chord.q);
    var steps = [];
    var i, b, p;

    // layer 0 — bass
    for (i = 0; i < sc.bass.length; i++) {
      p = sc.bass[i];
      steps.push({ beat: p.b, inst: 'bass', midi: chord.r + p.d, dur: 0.45, gain: p.g || 0.5 });
    }
    // layer 0 — pad (whole bar)
    steps.push({ beat: 0, inst: 'pad', midi: tones[0], chord: tones, dur: 3.9, gain: sc.padG || 0.1 });

    // layer 1 — arps or stabs
    if (intensity >= 1) {
      if (sc.arp) {
        var a = sc.arp;
        for (i = 0; i < a.div; i++) {
          var tone = tones[(i * a.step) % tones.length];
          if (a.up && i >= a.div / 2) tone += 12;
          steps.push({ beat: (i / a.div) * 4, inst: 'pluck', midi: tone + 12, dur: 0.4, gain: a.g || 0.15 });
        }
      }
      if (sc.stab) {
        for (i = 0; i < sc.stab.length; i++) {
          p = sc.stab[i];
          steps.push({ beat: p.b, inst: 'stab', midi: tones[0], chord: tones, dur: 0.22, gain: p.g || 0.12 });
        }
      }
    }

    // layer 2 — percussion
    if (intensity >= 2 && sc.perc) {
      for (i = 0; i < sc.perc.length; i++) {
        p = sc.perc[i];
        steps.push({ beat: p.b, inst: p.i, dur: p.i === 'brush' ? 0.14 : 0.07, gain: p.g || 0.12 });
      }
    }

    // layer 3 — tension / lead
    if (intensity >= 3) {
      if (sc.tense) {
        for (b = 0; b < 4; b++) {
          steps.push({ beat: b, inst: 'pulse', dur: 0.22, gain: 0.4 });
          steps.push({ beat: b + 0.25, inst: 'pulse', dur: 0.16, gain: 0.28 });
        }
      } else {
        for (i = 0; i < 4; i++) {
          steps.push({ beat: i * 0.5 + 0.5, inst: 'pluck', midi: tones[(i + 1) % tones.length] + 24, dur: 0.3, gain: 0.1 });
        }
      }
    }
    return steps;
  }

  /* ================= settings ================= */

  var settings = { muted: false, volume: 0.8, musicOn: true, sfxOn: true };
  function loadSettings() {
    try {
      var raw = window.localStorage && window.localStorage.getItem('parlor:audio');
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s === 'object' && s) {
          if (typeof s.muted === 'boolean') settings.muted = s.muted;
          if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) settings.volume = s.volume;
          if (typeof s.musicOn === 'boolean') settings.musicOn = s.musicOn;
          if (typeof s.sfxOn === 'boolean') settings.sfxOn = s.sfxOn;
        }
      }
    } catch (e) { /* memory-only fallback */ }
  }
  function saveSettings() {
    try { if (window.localStorage) window.localStorage.setItem('parlor:audio', JSON.stringify(settings)); }
    catch (e) { /* ignore */ }
  }

  /* ================= Web Audio graph ================= */

  var ctx = null, master = null, comp = null, sfxBus = null, musicBus = null;
  var noiseBuf = null;

  function makeNoiseBuffer() {
    var n = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') { try { ctx.resume(); } catch (e) {} }
      return true;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = settings.muted ? 0 : settings.volume;
    master.connect(comp);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = settings.musicOn ? 0.9 : 0;
    musicBus.connect(master);
    makeNoiseBuffer();
    return true;
  }

  function ready() { return !!ctx && ctx.state === 'running'; }

  function applyMaster() {
    if (!ctx) return;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, ctx.currentTime, 0.03);
    musicBus.gain.setTargetAtTime(settings.musicOn ? 0.9 : 0, ctx.currentTime, 0.05);
  }

  /* ---- low-level voices ---- */

  function tone(t, freq, dur, type, gain, opts) {
    if (!ctx) return;
    opts = opts || {};
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    var g = ctx.createGain();
    var a = opts.a || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.06);
  }

  function chordHit(t, midis, dur, type, gain) {
    for (var i = 0; i < midis.length; i++) tone(t, midiToFreq(midis[i]), dur, type, gain);
  }

  function noiseHit(t, dur, gain, ftype, f0, q, f1) {
    if (!ctx || !noiseBuf) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = ftype || 'lowpass';
    f.frequency.setValueAtTime(f0 || 1000, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    f.Q.value = q || 0.8;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t); src.stop(t + dur + 0.03);
  }

  /* ---- ducking: SFX briefly push the music down ---- */

  var ducking = false;
  function duck() {
    if (!ctx || !musicBus || ducking) return;
    ducking = true;
    var t = ctx.currentTime;
    var g = musicBus.gain;
    var base = settings.musicOn ? 0.9 : 0;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, base * 0.55), t + 0.04);
    g.linearRampToValueAtTime(base, t + 0.28);
    window.setTimeout(function () { ducking = false; }, 300);
  }

  /* ================= SFX catalog (all synthesized) ================= */

  var SFX = {
    click: function (t) {
      noiseHit(t, 0.03, 0.22, 'highpass', 2500, 0.8);
      tone(t, 1200, 0.05, 'sine', 0.14);
    },
    move: function (t) {
      noiseHit(t, 0.09, 0.5, 'lowpass', 420, 0.8);
      tone(t, 95, 0.13, 'sine', 0.5, { slide: 55 });
    },
    capture: function (t) {
      noiseHit(t, 0.06, 0.55, 'bandpass', 750, 1.4);
      tone(t, 70, 0.17, 'sine', 0.6, { slide: 40 });
      tone(t + 0.01, 2100, 0.09, 'triangle', 0.1);
    },
    check: function (t) {
      tone(t, 1318.5, 0.11, 'square', 0.11);
      tone(t + 0.13, 1760, 0.15, 'square', 0.11);
    },
    mate: function (t) {
      var seq = [587.33, 739.99, 880, 1174.66];
      for (var i = 0; i < seq.length; i++) tone(t + i * 0.12, seq[i], 0.5, 'triangle', 0.2);
      noiseHit(t + 0.42, 0.9, 0.1, 'highpass', 6000, 0.8);
    },
    deal: function (t) {
      noiseHit(t, 0.07, 0.28, 'highpass', 1800, 0.8);
    },
    draw1: function (t) {
      noiseHit(t, 0.09, 0.26, 'highpass', 1400, 0.8);
    },
    flip: function (t) {
      noiseHit(t, 0.05, 0.2, 'highpass', 1200, 0.8);
      noiseHit(t + 0.035, 0.05, 0.16, 'lowpass', 500, 0.8);
    },
    chip: function (t) {
      noiseHit(t, 0.03, 0.4, 'bandpass', 1600, 2);
      tone(t, 1850, 0.06, 'sine', 0.09);
    },
    fold: function (t) {
      noiseHit(t, 0.18, 0.18, 'lowpass', 1100, 0.8, 280);
    },
    allin: function (t) {
      noiseHit(t, 0.5, 0.2, 'bandpass', 300, 1.2, 3200);
      tone(t + 0.48, 55, 0.4, 'sine', 0.6, { slide: 32 });
    },
    showdown: function (t) {
      noiseHit(t, 0.5, 0.15, 'highpass', 700, 0.8, 4500);
      chordHit(t + 0.38, [60, 64, 67], 0.5, 'triangle', 0.12);
    },
    uno: function (t) {
      tone(t, 55, 0.2, 'sine', 0.7, { slide: 38 });
      noiseHit(t, 0.05, 0.5, 'lowpass', 300, 0.8);
      tone(t + 0.13, 493.88, 0.1, 'square', 0.1);
      tone(t + 0.23, 659.25, 0.16, 'square', 0.1);
    },
    wild: function (t) {
      var seq = [1046.5, 1318.5, 1568];
      for (var i = 0; i < seq.length; i++) tone(t + i * 0.07, seq[i], 0.28, 'triangle', 0.14);
    },
    shuffle: function (t) {
      noiseHit(t, 0.06, 0.24, 'highpass', 1600, 0.8);
      noiseHit(t + 0.09, 0.06, 0.24, 'highpass', 1900, 0.8);
      noiseHit(t + 0.18, 0.08, 0.28, 'highpass', 1500, 0.8);
    },
    crown: function (t) {
      tone(t, 659.25, 0.12, 'triangle', 0.18);
      tone(t + 0.11, 880, 0.2, 'triangle', 0.18);
      noiseHit(t + 0.11, 0.25, 0.08, 'highpass', 5000, 0.8);
    },
    promo: function (t) {
      tone(t, 587.33, 0.12, 'triangle', 0.18);
      tone(t + 0.1, 880, 0.14, 'triangle', 0.16);
      tone(t + 0.2, 1174.66, 0.22, 'triangle', 0.16);
    },
    chat: function (t) {
      tone(t, 620, 0.05, 'sine', 0.15);
    },
    connect: function (t) {
      tone(t, 523.25, 0.15, 'triangle', 0.2);
      tone(t + 0.12, 783.99, 0.22, 'triangle', 0.2);
    },
    disconnect: function (t) {
      tone(t, 783.99, 0.15, 'triangle', 0.16);
      tone(t + 0.12, 523.25, 0.24, 'triangle', 0.16);
    },
    tick: function (t) {
      tone(t, 1000, 0.03, 'sine', 0.07);
    },
    win: function (t) {
      chordHit(t, [57, 60, 64], 1.0, 'sawtooth', 0.09);
      chordHit(t + 0.18, [60, 64, 67], 1.2, 'sawtooth', 0.09);
      noiseHit(t + 0.1, 0.5, 0.16, 'bandpass', 1800, 1);
      noiseHit(t + 0.36, 1.3, 0.12, 'highpass', 5000, 0.8);
    },
    lose: function (t) {
      tone(t, 233.08, 0.5, 'sine', 0.24);
      tone(t + 0.38, 174.61, 0.85, 'sine', 0.24, { slide: 146 });
    },
    draw: function (t) {
      tone(t, 587.33, 0.3, 'triangle', 0.14);
      tone(t + 0.16, 523.25, 0.42, 'triangle', 0.12);
    }
  };

  function play(name) {
    if (!settings.sfxOn || !ctx || ctx.state !== 'running') return;
    var fn = SFX[name];
    if (typeof fn !== 'function') return;
    try {
      var t = ctx.currentTime + 0.01;
      fn(t);
      if (name !== 'tick') duck();
    } catch (e) { /* never break gameplay on audio */ }
  }

  /* ================= music sequencer ================= */

  var music = {
    scene: null,
    playing: false,
    intensity: 1,
    onchange: null,
    start: function (scene) {
      if (!SCENES[scene]) return;
      if (!ensure()) return;
      if (!settings.musicOn) return;
      music.scene = scene;
      music.playing = true;
      music._bar = 0;
      music._nextBar = ctx.currentTime + 0.15;
      music._timer = window.setInterval(tickScheduler, 25);
      tickScheduler();
      emitMusicChange();
    },
    stop: function () {
      if (music._timer) { window.clearInterval(music._timer); music._timer = null; }
      if (music.playing) {
        music.playing = false;
        if (ctx && musicBus) {
          var base = 0.0001;
          musicBus.gain.cancelScheduledValues(ctx.currentTime);
          musicBus.gain.setTargetAtTime(base, ctx.currentTime, 0.12);
        }
        emitMusicChange();
      }
    },
    setIntensity: function (x) {
      var v = Math.max(0, Math.min(3, Math.round(x)));
      if (v === music.intensity) return;
      music.intensity = v; // takes effect on the next bar
      emitMusicChange();
    }
  };

  function emitMusicChange() {
    if (typeof music.onchange === 'function') {
      try { music.onchange({ scene: music.scene, playing: music.playing, intensity: music.intensity }); } catch (e) {}
    }
  }

  function tickScheduler() {
    if (!ctx || !music.playing) return;
    if (!settings.musicOn) return;
    var sc = SCENES[music.scene];
    if (!sc) return;
    var spb = 60 / sc.bpm;
    while (music._nextBar < ctx.currentTime + 0.35) {
      var steps = buildSteps(music.scene, music.intensity, music._bar);
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        var beat = s.beat;
        if (sc.swing && (beat % 1) >= 0.5) beat = Math.floor(beat) + 0.5 + sc.swing * 0.25;
        scheduleStep(s, music._nextBar + beat * spb, spb);
      }
      music._bar++;
      music._nextBar += 4 * spb;
    }
  }

  function scheduleStep(s, t, spb) {
    if (!ctx || ctx.state !== 'running') return;
    var f, i;
    switch (s.inst) {
      case 'bass':
        f = ctx.createOscillator(); f.type = 'sine'; f.frequency.value = midiToFreq(s.midi);
        var g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(s.gain, t + 0.02);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
        f.connect(g1); g1.connect(musicBus);
        f.start(t); f.stop(t + s.dur + 0.05);
        break;
      case 'pad':
        for (i = 0; i < (s.chord || []).length; i++) {
          (function (midi) {
            var o = ctx.createOscillator(); o.type = 'triangle';
            o.frequency.value = midiToFreq(midi - 12);
            o.detune.value = (i % 2 ? 4 : -4);
            var g = ctx.createGain();
            var atk = Math.min(0.5, spb * 0.5);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(s.gain / Math.max(1, s.chord.length - 1), t + atk);
            g.gain.setValueAtTime(s.gain / Math.max(1, s.chord.length - 1), t + s.dur - 0.4);
            g.gain.linearRampToValueAtTime(0.0001, t + s.dur);
            var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
            o.connect(lp); lp.connect(g); g.connect(musicBus);
            o.start(t); o.stop(t + s.dur + 0.05);
          })(s.chord[i]);
        }
        break;
      case 'pluck': {
        var o2 = ctx.createOscillator(); o2.type = 'triangle';
        o2.frequency.value = midiToFreq(s.midi);
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(s.gain, t);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, s.dur));
        var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass';
        lp2.frequency.value = Math.min(8000, midiToFreq(s.midi) * 4);
        o2.connect(lp2); lp2.connect(g2); g2.connect(musicBus);
        o2.start(t); o2.stop(t + s.dur + 0.05);
        break;
      }
      case 'stab':
        for (i = 0; i < (s.chord || []).length; i++) {
          (function (midi) {
            var o = ctx.createOscillator(); o.type = 'triangle';
            o.frequency.value = midiToFreq(midi - 12);
            var g = ctx.createGain();
            g.gain.setValueAtTime(s.gain, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
            var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
            o.connect(lp); lp.connect(g); g.connect(musicBus);
            o.start(t); o.stop(t + s.dur + 0.05);
          })(s.chord[i]);
        }
        break;
      case 'hat':
        musicNoise(t, 0.05, s.gain, 'highpass', 7000, 0.8);
        break;
      case 'brush':
        musicNoise(t, 0.14, s.gain, 'lowpass', 2800, 0.8, 900);
        break;
      case 'clap':
        musicNoise(t, 0.1, s.gain, 'bandpass', 1500, 1.4);
        break;
      case 'kick':
        {
          var o3 = ctx.createOscillator(); o3.type = 'sine';
          o3.frequency.setValueAtTime(120, t);
          o3.frequency.exponentialRampToValueAtTime(42, t + 0.12);
          var g3 = ctx.createGain();
          g3.gain.setValueAtTime(s.gain, t);
          g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          o3.connect(g3); g3.connect(musicBus);
          o3.start(t); o3.stop(t + 0.2);
        }
        break;
      case 'pulse':
        {
          var o4 = ctx.createOscillator(); o4.type = 'sine';
          o4.frequency.value = 48;
          var g4 = ctx.createGain();
          g4.gain.setValueAtTime(s.gain, t);
          g4.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
          o4.connect(g4); g4.connect(musicBus);
          o4.start(t); o4.stop(t + s.dur + 0.05);
        }
        break;
    }
  }

  function musicNoise(t, dur, gain, ftype, f0, q, f1) {
    if (!ctx || !noiseBuf) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = ftype; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(t); src.stop(t + dur + 0.03);
  }

  /* pause the sequencer while the tab is hidden */
  function onVisibility() {
    if (!ctx) return;
    if (document.hidden) {
      if (music.playing) { music._timer && window.clearInterval(music._timer); music._timer = null; music._paused = true; }
    } else if (music.playing && music._paused) {
      music._paused = false;
      music._nextBar = ctx.currentTime + 0.1;
      music._timer = window.setInterval(tickScheduler, 25);
    }
  }

  /* ================= public API ================= */

  loadSettings();
  try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisibility); } catch (e) {}

  window.AUDIO = {
    ensure: ensure,
    ready: ready,
    play: play,
    music: music,
    setMuted: function (b) { settings.muted = !!b; saveSettings(); applyMaster(); },
    muted: function () { return settings.muted; },
    setVolume: function (v) { settings.volume = Math.max(0, Math.min(1, v)); saveSettings(); applyMaster(); },
    volume: function () { return settings.volume; },
    setMusicOn: function (b) { settings.musicOn = !!b; saveSettings(); applyMaster(); if (!settings.musicOn && music.playing) music.stop(); else if (settings.musicOn && music.scene) music.start(music.scene); },
    musicOn: function () { return settings.musicOn; },
    setSfxOn: function (b) { settings.sfxOn = !!b; saveSettings(); },
    sfxOn: function () { return settings.sfxOn; }
  };

  // test seam for the Node unit tests (harmless in the browser)
  window.__AUDIO_PURE = { SCENES: SCENES, QUALITIES: QUALITIES, midiToFreq: midiToFreq, chordNotes: chordNotes, buildSteps: buildSteps, settings: settings };
})();

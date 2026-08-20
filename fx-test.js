/* fx-test.js — Node-only unit tests for fx/fx.js.
 *
 * Two environments in one process:
 *   1. BARE  — window = globalThis, no document, no canvas, no rAF.
 *              Asserts the module degrades to safe no-ops (this is exactly
 *              what click-test.js exercises for main.js wiring).
 *   2. RICH  — a minimal DOM (document.createElement → fake canvas with a
 *              recording 2d context, manual requestAnimationFrame queue,
 *              synchronous setTimeout). Asserts real behavior: attach
 *              idempotency, particle spawning for every kind, coordinate
 *              mapping for F.at, render-loop animation + drain, the
 *              MAX_PARTICLES cap, shake class lifecycle, and the
 *              enabled()/reduced-motion gates.
 *
 *   node fx-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
let n = 0;
function a(cond, msg) { if (!cond) throw new Error(msg); }
function t(label, fn) {
  n++;
  try {
    fn();
    console.log('PASS  ' + label.padEnd(52));
  } catch (e) {
    failures++;
    console.log('FAIL  ' + label.padEnd(52) + ' — ' + e.message);
  }
}

globalThis.window = globalThis; // required before the module loads (it early-returns otherwise)
globalThis.setTimeout = function (fn) { try { fn(); } catch (e) {} return 0; }; // shake's fallback timer fires sync

function loadFile(rel) {
  const f = path.join(__dirname, rel);
  vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}
loadFile('fx/fx.js');
const F = globalThis.FX;
a(F && typeof F.attach === 'function' && typeof F.burst === 'function' && typeof F.at === 'function' &&
  typeof F.shake === 'function' && typeof F.camera === 'function' && typeof F.vibrate === 'function' &&
  typeof F.setEnabled === 'function' && typeof F.enabled === 'function', 'window.FX missing/incomplete');

const KINDS = ['dust', 'spark', 'confetti', 'ring', 'firework', 'sweep', 'goldrain', 'smoke'];
function makeClassList() {
  const s = new Set();
  return {
    add: function () { for (const c of arguments) s.add(c); },
    remove: function () { for (const c of arguments) s.delete(c); },
    contains: function (c) { return s.has(c); }
  };
}

/* ================= 1. BARE environment ================= */

t('bare: attach without document → null (no throw)', () => {
  a(F.attach(null) === null, 'null container');
  a(F.attach(undefined) === null, 'undefined container');
  a(F.attach({ style: {} }) === null, 'no document.createElement');
});

t('bare: burst/at for every kind + bogus → no throw', () => {
  for (const kind of KINDS.concat(['bogus'])) {
    F.burst(kind, 10, 10);
    F.burst(kind, 10, 10, { n: 3 });
    F.at(null, kind);
    F.at({ style: {} }, kind);
    F.at({ getBoundingClientRect: function () { throw new Error('boom'); } }, kind);
  }
});

t('bare: shake adds class, sync fallback removes it', () => {
  const listeners = [];
  const el = {
    classList: makeClassList(),
    offsetWidth: 0,
    addEventListener: function (ev, fn, opts) { listeners.push([ev, fn, opts]); }
  };
  F.shake(el, 'md');
  a(!el.classList.contains('fx-shake-md'), 'class removed by sync fallback');
  a(listeners.length === 1 && listeners[0][0] === 'animationend' && listeners[0][2] && listeners[0][2].once === true,
    'animationend once-listener registered');
  listeners[0][1](); // the animationend handler fires too — no throw, no re-add
  a(!el.classList.contains('fx-shake-md'), 'still off after animationend handler');
  F.shake(el, 'bogus'); // unknown magnitude falls back to sm
  a(!el.classList.contains('fx-shake-sm'), 'fallback magnitude removed');
  F.shake({ offsetWidth: 0 }, 'sm'); // no classList → safe no-op
  F.shake(null, 'sm');
});

t('bare: camera without geometry → no throw', () => {
  F.camera({ style: {} }, {}, 8);
  F.camera(null, null, 8);
});

t('bare: vibrate without navigator → no throw', () => {
  F.vibrate(10);
  F.vibrate();
});

t('bare: setEnabled(false) gates burst; reduced-motion wins too', () => {
  a(F.enabled() === true, 'enabled by default (no matchMedia)');
  F.setEnabled(false);
  a(F.enabled() === false, 'setEnabled(false)');
  F.burst('dust', 0, 0); // no-op, no throw
  F.setEnabled(true);
  a(F.enabled() === true, 'setEnabled(true)');
  globalThis.window.matchMedia = function () { return { matches: true }; };
  a(F.enabled() === false, 'prefers-reduced-motion disables');
  F.burst('confetti', 0, 0); // no-op, no throw
  delete globalThis.window.matchMedia;
  a(F.enabled() === true, 'enabled again after motion query removed');
});

/* ================= 2. RICH environment ================= */

const canvases = [];
function makeCtx() {
  const calls = {
    setTransform: 0, clearRect: 0, beginPath: 0, arc: 0, fill: 0, stroke: 0,
    moveTo: 0, lineTo: 0, save: 0, restore: 0, translate: 0, rotate: 0,
    fillRect: 0, createLinearGradient: 0, addColorStop: 0
  };
  return {
    calls: calls,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    setTransform: function () { calls.setTransform++; },
    clearRect: function () { calls.clearRect++; },
    beginPath: function () { calls.beginPath++; },
    arc: function () { calls.arc++; },
    fill: function () { calls.fill++; },
    stroke: function () { calls.stroke++; },
    moveTo: function () { calls.moveTo++; },
    lineTo: function () { calls.lineTo++; },
    save: function () { calls.save++; },
    restore: function () { calls.restore++; },
    translate: function () { calls.translate++; },
    rotate: function () { calls.rotate++; },
    fillRect: function () { calls.fillRect++; },
    createLinearGradient: function () { calls.createLinearGradient++; return { addColorStop: function () { calls.addColorStop++; } }; }
  };
}
globalThis.document = {
  createElement: function (tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const cv = {
      width: 0, height: 0, style: {}, className: '',
      setAttribute: function (k, v) { if (k === 'class') this.className = v; },
      getContext: function (type) {
        if (type !== '2d') return null;
        if (!cv._ctx) cv._ctx = makeCtx();
        return cv._ctx;
      }
    };
    canvases.push(cv);
    return cv;
  }
};
const winListeners = [];
globalThis.addEventListener = function (ev, fn) { winListeners.push([ev, fn]); };

const rafQueue = [];
globalThis.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function pump(frames, dtMs) {
  let now = 0;
  for (let i = 0; i < frames; i++) {
    now += dtMs;
    const q = rafQueue.splice(0);
    for (const fn of q) fn(now);
  }
}
function makeContainer(w, h, left, top) {
  return {
    style: {},
    clientWidth: w, clientHeight: h,
    children: [],
    appendChild: function (c) { this.children.push(c); },
    getBoundingClientRect: function () { return { left: left, top: top, width: w, height: h }; }
  };
}
function newLayer(w, h, left, top) {
  const c = makeContainer(w, h, left, top);
  const layer = F.attach(c);
  if (!layer) throw new Error('attach failed in rich env');
  layer.container = c; // (already set by attach, but be explicit)
  return layer;
}
t('rich: attach creates sized layer + canvas, idempotent per container', () => {
  const c = makeContainer(300, 200, 50, 80);
  const layer = F.attach(c);
  a(layer && layer.g, 'layer with 2d context');
  a(layer.w === 300 && layer.h === 200 && layer.dpr === 1, 'sized from clientWidth/Height (dpr 1)');
  a(layer.canvas.width === 300 && layer.canvas.height === 200, 'canvas backing store sized');
  a(layer.canvas.__fxCanvas === true && layer.canvas.className === 'fx-canvas', 'canvas tagged');
  a(c.children.length === 1 && c.children[0] === layer.canvas, 'canvas appended to container');
  a(F.attach(c) === layer, 'idempotent — same layer');
  a(canvases.length === 1, 'only one canvas created');
  a(F.attach(makeContainer(100, 100, 0, 0)) !== layer, 'second container gets its own layer');
  a(winListeners.some(function (l) { return l[0] === 'resize'; }), 'resize listener registered (no ResizeObserver)');
});

t('rich: burst spawns every kind with finite particle fields', () => {
  const layer = newLayer(300, 200, 0, 0);
  for (const kind of KINDS) {
    const before = layer.particles.length;
    F.burst(kind, 100, 50, { layer: layer });
    const added = layer.particles.length - before;
    a(added > 0, kind + ': no particles');
    if (kind === 'ring' || kind === 'sweep') a(added === 1, kind + ': expected exactly 1');
    const fresh = layer.particles.slice(before);
    for (const p of fresh) {
      a(p.kind === kind, kind + ': kind field');
      a(Number.isFinite(p.x) && Number.isFinite(p.y), kind + ': position finite');
      a(Number.isFinite(p.vx) && Number.isFinite(p.vy), kind + ': velocity finite');
      a(Number.isFinite(p.life) && p.life > 0, kind + ': life > 0');
      a(Number.isFinite(p.size) && p.size > 0, kind + ': size > 0');
      a(typeof p.color === 'string' && p.color.length > 0, kind + ': color');
      if (kind === 'goldrain') a(p.x >= 0 && p.x <= 300, 'goldrain: x spread across layer width');
    }
    layer.particles.length = 0; // keep runs independent
  }
});

t('rich: opts.n is honored; unknown kind is a no-op', () => {
  const layer = newLayer(300, 200, 0, 0);
  F.burst('dust', 10, 10, { n: 5, layer: layer });
  a(layer.particles.length === 5, 'n:5 → exactly 5, got ' + layer.particles.length);
  const before = layer.particles.length;
  F.burst('does-not-exist', 10, 10, { layer: layer });
  a(layer.particles.length === before, 'unknown kind adds nothing');
  F.burst('dust', 10, 10, { layer: layer, n: 'nope' }); // bad n ignored → default range
  a(layer.particles.length > before, 'non-numeric n falls back to default range');
});

t('rich: F.at maps element center into layer coords', () => {
  const layer = newLayer(300, 200, 50, 80); // container at (50, 80)
  const el = { getBoundingClientRect: function () { return { left: 100, top: 50, width: 20, height: 20 }; } };
  // element center (110, 60) − container origin (50, 80) = (60, −20)
  F.at(el, 'spark', { layer: layer });
  a(layer.particles.length > 0, 'spark at el spawned');
  for (const p of layer.particles) {
    a(p.x === 60 && p.y === -20, 'at(): exact layer-local center, got (' + p.x + ',' + p.y + ')');
  }
  layer.particles.length = 0;
  // el without geometry → layer center
  F.at({}, 'dust', { layer: layer });
  for (const p of layer.particles) {
    a(p.x === 150 && p.y === 100, 'at(): layer center fallback, got (' + p.x + ',' + p.y + ')');
  }
});

t('rich: render loop animates particles, draws, drains, then stops', () => {
  const layer = newLayer(300, 200, 0, 0);
  a(layer.particles.length === 0, 'starts empty');
  F.burst('dust', 150, 100, { n: 10, layer: layer });
  a(layer.raf !== 0, 'loop scheduled on burst');
  const g = layer.g;
  const beforeDraw = g.calls.fill + g.calls.stroke;
  pump(1, 16);
  a(g.calls.clearRect > 0 && g.calls.setTransform >= 2, 'draw happened');
  a(g.calls.fill + g.calls.stroke > beforeDraw, 'particles were drawn');
  const p0 = layer.particles[0];
  a(p0 && p0.age > 0 && Math.abs(p0.x - 150) > 0.01, 'particle aged + moved');
  a(layer.particles.length === 10, 'still alive mid-life');
  pump(300, 50); // 15 s simulated — well past max life (0.9 s)
  a(layer.particles.length === 0, 'drained to zero');
  a(rafQueue.length === 0, 'loop stopped rescheduling');
  a(layer.raf === 0, 'layer.raf cleared');
});

t('rich: sweep uses gradient fill; confetti uses save/translate/rotate', () => {
  const layer = newLayer(300, 200, 0, 0);
  F.burst('sweep', 0, 0, { layer: layer });
  pump(1, 16);
  a(layer.g.calls.createLinearGradient === 1 && layer.g.calls.addColorStop === 3, 'sweep gradient');
  a(layer.g.calls.fillRect > 0, 'sweep fillRect');
  layer.particles.length = 0;
  F.burst('confetti', 150, 100, { n: 8, layer: layer });
  pump(1, 16);
  a(layer.g.calls.save === 8 && layer.g.calls.restore === 8 && layer.g.calls.rotate === 8, 'confetti transform path');
  layer.particles.length = 0;
});

t('rich: MAX_PARTICLES caps the pool (spike-and-drop)', () => {
  const layer = newLayer(300, 200, 0, 0);
  for (let i = 0; i < 20; i++) F.burst('confetti', 0, 0, { n: 40, layer: layer }); // 800 requested
  a(layer.particles.length <= 400, 'capped at 400, got ' + layer.particles.length);
  a(layer.particles.length === 400, 'pool saturated, got ' + layer.particles.length);
  F.burst('dust', 0, 0, { n: 5, layer: layer }); // 5 more → 5 oldest evicted
  a(layer.particles.length === 400, 'still capped after more bursts');
});

t('rich: setEnabled(false) blocks spawning; reduced-motion blocks too', () => {
  const layer = newLayer(300, 200, 0, 0);
  F.setEnabled(false);
  a(F.enabled() === false, 'disabled');
  F.burst('dust', 0, 0, { layer: layer });
  a(layer.particles.length === 0, 'no spawn while disabled');
  F.setEnabled(true);
  globalThis.window.matchMedia = function () { return { matches: true }; };
  F.burst('dust', 0, 0, { layer: layer });
  a(layer.particles.length === 0, 'no spawn under reduced motion');
  delete globalThis.window.matchMedia;
  F.burst('dust', 0, 0, { n: 3, layer: layer });
  a(layer.particles.length === 3, 'spawns again when motion allowed');
});

console.log('\n' + (failures === 0 ? 'ALL GREEN' : failures + ' FAILURE(S)') + ' (' + n + ' tests)');
process.exit(failures === 0 ? 0 : 1);

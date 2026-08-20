/* fx/fx.js — The Parlor's canvas particle + juice layer.
 *
 * One absolutely-positioned <canvas> per attached container, sized to fit,
 * redrawn with requestAnimationFrame only while particles exist. Everything
 * is guarded so the module is Node-safe (headless click-test): no canvas
 * context, no requestAnimationFrame, no getBoundingClientRect → no-ops.
 *
 * Reduced motion (prefers-reduced-motion) disables all of it; the "Effects"
 * toggle in the audio popover does too.
 *
 *   window.FX = {
 *     attach(container)      → layer (idempotent per container)
 *     at(el, kind, opts)     → burst at an element's center (el may be null)
 *     burst(kind, x, y, opts)→ burst at layer-local coords (needs a layer)
 *     shake(el, 'sm'|'md'|'lg')
 *     camera(wrapEl, targetEl, mag)
 *     vibrate(msOrPattern)
 *     setEnabled(b), enabled()
 *   }
 *
 * Kinds: dust, spark, confetti, ring, firework, sweep, goldrain, smoke
 * opts: { n, palette, layer } — layer is the attach() return value.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var MAX_PARTICLES = 400;
  var DPR_CAP = 2;

  function motionOff() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  var enabledFlag = true;
  function enabled() { return enabledFlag && !motionOff(); }

  /* ================= particle kind parameters ================= */

  var KINDS = {
    dust: {
      n: [10, 18], life: [0.45, 0.9], size: [2, 5],
      spawn: function (x, y, r) {
        var ang = r() * Math.PI * 2, sp = 20 + r() * 70;
        return { x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 20, g: 60 };
      }
    },
    spark: {
      n: [14, 22], life: [0.35, 0.7], size: [1.5, 2.6],
      spawn: function (x, y, r) {
        var ang = r() * Math.PI * 2, sp = 120 + r() * 240;
        return { x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 260 };
      }
    },
    confetti: {
      n: [90, 140], life: [1.5, 2.6], size: [5, 9],
      spawn: function (x, y, r) {
        var ang = -Math.PI / 2 + (r() - 0.5) * 1.9, sp = 160 + r() * 320;
        return { x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 230, sway: 2 + r() * 4, phase: r() * 6.28 };
      }
    },
    ring: {
      n: [1, 1], life: [0.45, 0.45], size: [8, 8],
      spawn: function (x, y) { return { x: x, y: y, vx: 0, vy: 0, g: 0 }; }
    },
    firework: {
      n: [30, 42], life: [0.8, 1.4], size: [1.8, 2.8],
      spawn: function (x, y, r) {
        var ang = r() * Math.PI * 2, sp = 120 + r() * 260;
        return { x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 240 };
      }
    },
    sweep: {
      n: [1, 1], life: [0.7, 0.7], size: [1, 1],
      spawn: function (x, y) { return { x: x, y: y, vx: 0, vy: 0, g: 0 }; }
    },
    goldrain: {
      n: [40, 70], life: [1.1, 2.0], size: [1, 2.2],
      spawn: function (x, y, r, w) {
        var bx = r() * (w || 300);
        return { x: bx, y: y, vx: (r() - 0.5) * 30, vy: 110 + r() * 150, g: 0, len: 8 + r() * 10 };
      }
    },
    smoke: {
      n: [16, 26], life: [1.0, 1.8], size: [12, 28],
      spawn: function (x, y, r) {
        return { x: x + (r() - 0.5) * 40, y: y, vx: (r() - 0.5) * 24, vy: -20 - r() * 40, g: -8 };
      }
    }
  };

  var PALETTES = {
    dust: ['#b8a27a', '#a08a5f', '#8d7a55'],
    spark: ['#ffd76a', '#ffb347', '#fff3c4', '#ff9d5c'],
    confetti: ['#16683f', '#c29330', '#c7513f', '#2b4a6f', '#f0e6cf'],
    goldrain: ['#ffd76a', '#c29330', '#ffe9a8'],
    firework: ['#ffd76a', '#7ec8e3', '#f0a35e', '#ffffff', '#e37ec8'],
    smoke: ['#5a5f5b', '#494e4a', '#3c413d']
  };

  /* ================= layers ================= */

  function attach(container) {
    if (!container) return null;
    if (container.__fxLayer) return container.__fxLayer;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    var canvas;
    try { canvas = document.createElement('canvas'); } catch (e) { return null; }
    if (typeof canvas.getContext !== 'function') { container.__fxLayer = null; return null; }
    canvas.__fxCanvas = true;
    canvas.setAttribute('class', 'fx-canvas');
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(container) : null;
      if (cs && cs.position === 'static') container.style.position = 'relative';
    } catch (e) { if (container.style) container.style.position = 'relative'; }
    try { container.appendChild(canvas); } catch (e) { return null; }

    var layer = {
      container: container,
      canvas: canvas,
      g: null,
      w: 0, h: 0, dpr: 1,
      particles: [],
      raf: 0,
      last: 0
    };
    layer.g = canvas.getContext('2d');
    resizeLayer(layer);

    var resized = false;
    var doResize = function () { if (!resized) { resized = true; resizeLayer(layer); window.requestAnimationFrame ? requestAnimationFrame(function () { resized = false; }) : (resized = false); } };
    if (typeof window.ResizeObserver === 'function') {
      try { new window.ResizeObserver(doResize).observe(container); } catch (e) { if (typeof window.addEventListener === 'function') window.addEventListener('resize', doResize); }
    } else if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', doResize);
    }

    container.__fxLayer = layer;
    return layer;
  }

  function resizeLayer(layer) {
    var c = layer.container;
    var w = (c && c.clientWidth) || 0;
    var h = (c && c.clientHeight) || 0;
    if (!w || !h) return;
    var dpr = Math.min(DPR_CAP, (window.devicePixelRatio || 1) || 1);
    layer.w = w; layer.h = h; layer.dpr = dpr;
    layer.canvas.width = Math.round(w * dpr);
    layer.canvas.height = Math.round(h * dpr);
  }

  /* ================= bursts ================= */

  function pick(arr, r) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  function burst(kind, x, y, opts, layer) {
    if (!enabled() || !KINDS[kind]) return;
    layer = layer || defaultLayer;
    if (!layer || !layer.g) return;
    var p = KINDS[kind];
    var n = 0;
    if (opts && typeof opts.n === 'number') n = opts.n;
    if (!n) n = p.n[0] + Math.floor(Math.random() * (p.n[1] - p.n[0] + 1));
    var palette = (opts && opts.palette) || PALETTES[kind] || PALETTES.dust;

    for (var i = 0; i < n; i++) {
      if (layer.particles.length >= MAX_PARTICLES) layer.particles.splice(0, 1);
      var s = p.spawn(x, y, Math.random, layer.w);
      if (kind === 'sweep') { s.x = layer.w; s.y = layer.h; } // sweep spans the whole layer
      layer.particles.push({
        kind: kind,
        x: s.x, y: s.y, vx: s.vx, vy: s.vy, g: s.g,
        len: s.len || 0, sway: s.sway || 0, phase: s.phase || 0,
        age: 0,
        life: p.life[0] + Math.random() * (p.life[1] - p.life[0]),
        size: p.size[0] + Math.random() * (p.size[1] - p.size[0]),
        color: pick(palette, Math.random),
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8
      });
    }
    startLoop(layer);
  }

  var defaultLayer = null;

  function at(el, kind, opts) {
    var layer = (opts && opts.layer) || null;
    if (el && typeof el.getBoundingClientRect === 'function' && layer && typeof layer.container.getBoundingClientRect === 'function') {
      var r, cr;
      try {
        r = el.getBoundingClientRect();
        cr = layer.container.getBoundingClientRect();
      } catch (e) { return; }
      burst(kind, r.left + r.width / 2 - cr.left, r.top + r.height / 2 - cr.top, opts, layer);
    } else {
      // no geometry: center of the layer
      burst(kind, (layer ? layer.w / 2 : 0), (layer ? layer.h / 2 : 0), opts, layer);
    }
  }

  /* ================= render loop ================= */

  function startLoop(layer) {
    if (layer.raf) return;
    layer.last = 0;
    var step = function (now) {
      layer.raf = 0;
      if (layer.particles.length === 0) {
        try { layer.g.clearRect(0, 0, layer.canvas.width, layer.canvas.height); } catch (e) {}
        return;
      }
      if (!layer.last) layer.last = now || 0;
      var dt = Math.min(0.05, ((now || 0) - layer.last) / 1000 || 0.016);
      layer.last = now || 0;
      draw(layer, dt);
      if (layer.particles.length > 0 && typeof requestAnimationFrame === 'function') layer.raf = requestAnimationFrame(step);
    };
    layer.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(step) : 0;
  }

  function draw(layer, dt) {
    var g = layer.g, dpr = layer.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (var i = layer.particles.length - 1; i >= 0; i--) {
      var p = layer.particles[i];
      p.age += dt;
      if (p.age >= p.life) { layer.particles.splice(i, 1); continue; }
      var k = p.age / p.life;
      var alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;

      if (p.kind === 'sweep') { drawSweep(g, p, k); continue; }
      if (p.kind === 'ring') {
        var rr = 10 + k * 70;
        g.globalAlpha = alpha * 0.8;
        g.strokeStyle = p.color;
        g.lineWidth = 3 * (1 - k) + 1;
        g.beginPath();
        g.arc(p.x, p.y, rr, 0, Math.PI * 2);
        g.stroke();
        continue;
      }

      p.vy += (p.g || 0) * dt;
      if (p.sway) p.x += Math.sin(p.age * p.sway * 4 + p.phase) * dt * 24;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      g.globalAlpha = alpha;
      g.fillStyle = p.color;

      if (p.kind === 'spark' || p.kind === 'firework') {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        var tl = 0.016;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * tl, p.y - p.vy * tl);
        g.stroke();
      } else if (p.kind === 'confetti') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
        g.restore();
      } else if (p.kind === 'goldrain') {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.05, p.y - (p.len || 10));
        g.stroke();
      } else if (p.kind === 'smoke') {
        g.globalAlpha = alpha * 0.35;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 + k * 1.2), 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function drawSweep(g, p, k) {
    var w = p.x > 0 ? p.x : 300; // x carries the layer width
    var x = -140 + k * (w + 280);
    var grad = g.createLinearGradient(x - 70, 0, x + 70, 0);
    grad.addColorStop(0, 'rgba(255, 235, 180, 0)');
    grad.addColorStop(0.5, 'rgba(255, 235, 180, 0.28)');
    grad.addColorStop(1, 'rgba(255, 235, 180, 0)');
    g.globalAlpha = k < 0.85 ? 1 : (1 - k) / 0.15;
    g.fillStyle = grad;
    g.fillRect(x - 70, 0, 140, p.y > 0 ? p.y : 300); // y carries the layer height
  }

  /* ================= shake / camera / haptics ================= */

  var MAGS = { sm: 'fx-shake-sm', md: 'fx-shake-md', lg: 'fx-shake-lg' };

  function shake(el, mag) {
    if (!el || !enabled()) return;
    var cls = MAGS[mag] || MAGS.sm;
    try {
      if (!el.classList || typeof el.classList.add !== 'function' || typeof el.classList.remove !== 'function') return;
      el.classList.remove(MAGS.sm, MAGS.md, MAGS.lg);
      // restart the animation
      void el.offsetWidth;
      el.classList.add(cls);
      var off = function () { el.classList.remove(cls); };
      if (typeof el.addEventListener === 'function') {
        el.addEventListener('animationend', off, { once: true });
        window.setTimeout(off, 900); // fallback if animationend never fires
      }
    } catch (e) { /* never break gameplay */ }
  }

  function camera(wrapEl, targetEl, mag) {
    if (!wrapEl || !targetEl || !enabled()) return;
    if (typeof targetEl.getBoundingClientRect !== 'function' || typeof wrapEl.getBoundingClientRect !== 'function') return;
    try {
      var wr = wrapEl.getBoundingClientRect();
      var tr = targetEl.getBoundingClientRect();
      var dx = (tr.left + tr.width / 2) - (wr.left + wr.width / 2);
      var dy = (tr.top + tr.height / 2) - (wr.top + wr.height / 2);
      var m = mag || 8;
      dx = Math.max(-m, Math.min(m, dx));
      dy = Math.max(-m, Math.min(m, dy));
      if (!wrapEl.style) return;
      wrapEl.style.transition = 'transform .16s ease-out';
      wrapEl.style.transform = 'translate(' + (-dx) + 'px,' + (-dy) + 'px)';
      window.setTimeout(function () {
        if (!wrapEl.style) return;
        wrapEl.style.transition = 'transform .45s cubic-bezier(.2,.7,.3,1)';
        wrapEl.style.transform = '';
      }, 170);
    } catch (e) { /* never break gameplay */ }
  }

  function vibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern || 12);
    } catch (e) { /* unsupported */ }
  }

  /* ================= public API ================= */

  window.FX = {
    attach: attach,
    at: at,
    burst: function (kind, x, y, opts) { burst(kind, x, y, opts, (opts && opts.layer) || null); },
    shake: shake,
    camera: camera,
    vibrate: vibrate,
    setEnabled: function (b) { enabledFlag = !!b; },
    enabled: enabled
  };
})();

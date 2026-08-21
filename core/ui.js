/* The Parlor — shared DOM/UI helpers (core/ui.js).
   Loaded before every game module. No top-level DOM access: every helper
   runs at call time, so the Node click-test stub (no matchMedia/rAF/canvas/
   localStorage) can load this file safely.

   API (on global.UI):
   UI.motionOff()                 -> boolean; prefers-reduced-motion detect
   UI.animOk()                    -> boolean; rAF + layout geometry gate
   UI.events(el, arr)             -> void;   el.__events = arr (fresh-array FX contract)
   UI.playerRow(host, { label, detail, active, you, nameClass, detailClass })
                                  -> element; standard per-side status row
   UI.flipCapture(el, { boardSel, glides, ghosts })
                                  -> plan|null; read old-square rects BEFORE the board wipe
   UI.flipPlay(plan, boardEl, { squareAt, moverAt, ghostEl })
                                  -> void; glide movers + fade ghosts AFTER the new board is built
*/
(function (global) {
  'use strict';

  function motionOff() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function animOk() {
    if (typeof window.requestAnimationFrame !== 'function') return false;
    if (motionOff()) return false;
    return typeof document.createElement('div').getBoundingClientRect === 'function';
  }

  function events(el, arr) {
    el.__events = (arr == null) ? [] : arr;
  }

  /* Standard per-side status row, matching the markup all games ship:
     <div class="player-row [active]"><span[.nameClass]>You? — label</span>
     <span class="muted|[.detailClass]">detail</span></div>
     nameClass defaults to unset; detailClass defaults to 'muted'. */
  function playerRow(host, o) {
    const row = document.createElement('div');
    row.className = 'player-row' + (o.active ? ' active' : '');
    const name = document.createElement('span');
    if (o.nameClass) name.className = o.nameClass;
    name.textContent = (o.you ? 'You — ' : '') + o.label;
    const det = document.createElement('span');
    det.className = o.detailClass || 'muted';
    det.textContent = o.detail;
    row.appendChild(name);
    row.appendChild(det);
    host.appendChild(row);
    return row;
  }

  /* FLIP glide/ghost helpers (shared chess + checkers visual layer).
     No state, no FX, no board diff, no el.__* slots: each game keeps its own
     diff, piece matching, cascade/land/crown class logic, FX planning and
     write-backs.

     flipCapture(el, opts) -- call BEFORE el.innerHTML = '' while the previous
       board is still in the DOM. opts: { boardSel, glides: [{from,to}],
       ghosts: [{i,piece}] }. Returns null when !animOk(), both lists are
       empty, or the board element is missing (the original gates).
     flipPlay(plan, boardEl, opts) -- call AFTER the new board is built and in
       the DOM. plan may be null (no-op). Adapters (the only per-game surface):
       squareAt(boardEl, i) -> sqEl|null, moverAt(toSq) -> pieceEl|null,
       ghostEl(g, sqEl) -> HTMLElement (game builds its own ghost markup).
     The glide delta is newFrom - oldFrom (measured in both DOMs); on a static
     board it is 0 and the glide silently skips. That is today's behavior. */
  function flipCapture(el, opts) {
    const glides = opts.glides || [], ghosts = opts.ghosts || [];
    if (!animOk() || (!glides.length && !ghosts.length)) return null;
    const oldBoard = el.querySelector(opts.boardSel);
    if (!oldBoard) return null;
    const oldRects = {};
    for (const g of glides) {
      const s = oldBoard.querySelector('[data-i="' + g.from + '"]');
      if (s) oldRects['f' + g.from] = s.getBoundingClientRect();
    }
    for (const g of ghosts) {
      const s = oldBoard.querySelector('[data-i="' + g.i + '"]');
      if (s) oldRects['g' + g.i] = s.getBoundingClientRect();
    }
    return { oldRects: oldRects, glides: glides, ghosts: ghosts };
  }

  function flipPlay(plan, boardEl, opts) {
    if (!plan) return;
    const t = Object.assign({
      moverZ: '30',
      ghostZ: '20',
      glideTransition: 'transform .18s cubic-bezier(.2,.75,.3,1.08)',
      ghostTransition: 'opacity .22s ease .08s, transform .22s ease .08s',
      ghostScale: 'scale(.55)',
      ghostFallbackMs: 900,
    }, opts.timings || {});
    const boardRect = boardEl.getBoundingClientRect();
    for (const g of plan.glides) {
      const r0 = plan.oldRects['f' + g.from];
      const fromSq = opts.squareAt(boardEl, g.from);
      const toSq = opts.squareAt(boardEl, g.to);
      const pc = toSq ? opts.moverAt(toSq) : null;
      if (!r0 || !fromSq || !pc) continue;
      const r1 = fromSq.getBoundingClientRect();
      const dx = r1.left - r0.left, dy = r1.top - r0.top;
      if (!dx && !dy) continue;
      pc.style.zIndex = t.moverZ;
      pc.style.transition = 'none';
      pc.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      void pc.offsetWidth;
      pc.style.transition = t.glideTransition;
      pc.style.transform = 'translate(0,0)';
      pc.addEventListener('transitionend', function done() {
        pc.style.transition = ''; pc.style.transform = ''; pc.style.zIndex = '';
        pc.removeEventListener('transitionend', done);
      });
    }
    for (const g of plan.ghosts) {
      const r0 = plan.oldRects['g' + g.i];
      const sq = opts.squareAt(boardEl, g.i);
      if (!r0 || !sq) continue;
      const r1 = sq.getBoundingClientRect();
      const gh = opts.ghostEl(g, sq);
      gh.style.left = (r1.left - boardRect.left) + 'px';
      gh.style.top = (r1.top - boardRect.top) + 'px';
      gh.style.width = r1.width + 'px';
      gh.style.height = r1.height + 'px';
      gh.style.zIndex = t.ghostZ;
      boardEl.appendChild(gh);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          gh.style.transition = t.ghostTransition;
          gh.style.opacity = '0';
          gh.style.transform = t.ghostScale;
          gh.addEventListener('transitionend', function () {
            if (gh.parentNode) gh.parentNode.removeChild(gh);
          }, { once: true });
        });
      });
      window.setTimeout(function () { if (gh.parentNode) gh.parentNode.removeChild(gh); }, t.ghostFallbackMs);
    }
  }

  const UI = { motionOff: motionOff, animOk: animOk, events: events, playerRow: playerRow, flipCapture: flipCapture, flipPlay: flipPlay };
  global.UI = UI;
  if (typeof module !== 'undefined' && module.exports) module.exports = UI;
})(typeof window !== 'undefined' ? window : globalThis);

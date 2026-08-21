/* games/chess/view.js — Chess: DOM render layer. Logic symbols via L = global.PARLOR['chess'].logic. */
(function (global) {
  'use strict';

  const L = global.PARLOR['chess'].logic;
  const { FILES, VAL, NAME, KNIGHT, KINGD, ROOKD, BISHD, CENTER, MATE, startBoard, newState, posKey, inb, enemy, attacked, kingSq, inCheck, applyBoard, genPseudo, genLegal, legalMoves, nm, lastChip, applyMove, describeMove, insufficientMaterial, outcome, currentSide, viewFor, evalBoard, orderMoves, childEp, childCr, negamax, aiMove, GLYPH } = L;

  /* ---------- render ---------- */

  /* ---------- FLIP board transition ----------
     render() rebuilds the whole board every call, so to make pieces *glide*
     across the board instead of teleporting we snapshot the previous
     render's board and read the old square rects while the old DOM is still
     live (FLIP: First, Last, Invert, Play). Only a single legal move
     (1–4 changed squares) animates; a larger diff (board reset) plays a
     staggered cascade instead. The layout reads are feature-detected so the
     Node click-test stub (no layout, no rAF) simply skips the effect. The
     snapshot hangs off the render element (el.__prevBoard & friends) rather
     than module state, so two boards rendered in one process cannot clobber
     each other's animation. Animation state never touches state or moves —
     the JSON contract holds. */


  function pieceSame(a, c) {
    return !!a && !!c && a.p === c.p && a.c === c.c;
  }

  function render(view, el, opts) {
    const mySide = opts.mySide;
    const interactive = !!opts.interactive;
    const onMove = opts.onMove;
    const b = view.board;

    if (!interactive) { el.__sel = -1; el.__promo = null; }
    const getSel = () => (typeof el.__sel === 'number' ? el.__sel : -1);
    const sel = getSel();
    const getPromo = () => (el.__promo && typeof el.__promo === 'object' ? el.__promo : null);
    const promo = getPromo();

    /* --- diff against the previous render's board ---
       Computed even when FLIP is unavailable (no rAF/layout under Node) so FX
       events fire in every environment; `flip` only gates the visual work. */
    const flip = UI.animOk();
    const glides = [], ghosts = [];
    const fx = [];
    const landSet = {};
    let cascade = false;
    const prevBoard = el.__prevBoard;
    if (b.length === 64) {
      if (!prevBoard) {
        cascade = flip; // first paint: deal the board in (visual only)
      } else {
        let changed = 0;
        for (let i = 0; i < 64; i++) {
          const a = prevBoard[i], c = b[i];
          if (!a && !c) continue; // empty staying empty is not a change
          if (!pieceSame(a, c)) changed++;
        }
        if (changed > 4) {
          cascade = flip; // board reset (rematch)
        } else if (changed > 0) {
          const froms = [], tos = [];
          for (let i = 0; i < 64; i++) {
            if (prevBoard[i] && !b[i]) froms.push(i);
            else if (!prevBoard[i] && b[i]) tos.push(i);
          }
          const used = {};
          for (const to of tos) { // pair moved pieces by identity (castling = 2 pairs)
            const pc = b[to];
            let hit = -1, isPromo = false;
            for (let f = 0; f < froms.length; f++) {
              if (used[f]) continue;
              const pp = prevBoard[froms[f]];
              if (pieceSame(pp, pc)) { hit = f; break; }
              // promotion: own pawn one row back on the same file becomes a piece
              if (pc.p !== 'p' && pp.p === 'p' && pp.c === pc.c && (to & 7) === (froms[f] & 7) &&
                  ((pc.c === 'white' && to < 8) || (pc.c === 'black' && to >= 56))) {
                hit = f; isPromo = true; break;
              }
            }
            if (hit >= 0) {
              glides.push({ from: froms[hit], to: to });
              used[hit] = true;
              if (isPromo) fx.push({ t: 'promo', sq: to });
              else fx.push({ t: (pc.p === 'k' && Math.abs(to - froms[hit]) === 2) ? 'castle' : 'move', sq: to });
            }
          }
          for (let f = 0; f < froms.length; f++) { // unpaired = captured (incl. en passant)
            if (!used[f]) {
              ghosts.push({ i: froms[f], piece: prevBoard[froms[f]] });
              fx.push({ t: 'capture', sq: froms[f] });
            }
          }
          if (fx.some((e) => e.t === 'castle')) { // the castling rook's move stays silent
            const k = fx.find((e) => e.t === 'castle');
            for (const e of fx) if (e.t === 'move' && (e.sq >> 3) === (k.sq >> 3)) e.t = null;
          }
          for (const g of glides) landSet[g.to] = true;
          for (let i = 0; i < 64; i++) { // piece swapped in place (capturing promo target)
            if (prevBoard[i] && b[i] && !pieceSame(prevBoard[i], b[i])) landSet[i] = true;
          }
        }
      }
    }

    /* --- capture old square rects while the old board is still in the DOM --- */
    const flipPlan = UI.flipCapture(el, { boardSel: '.chess-board', glides: glides, ghosts: ghosts });

    el.innerHTML = '';

    /* --- last-move notation chip --- */
    const text = lastChip(view.last);
    const textChanged = text !== el.__lastTextKey;
    const lmKey = view.last ? (view.last.from + ':' + view.last.to + ':' + (view.last.promo || '')) : '';
    const lmChanged = lmKey !== el.__lastLmKey;
    const chipEl = document.createElement('div');
    chipEl.className = 'chess-last' + (textChanged ? '' : ' still');
    chipEl.textContent = text;
    el.appendChild(chipEl);

    /* --- board --- */
    const boardEl = document.createElement('div');
    boardEl.className = 'chess-board';

    const targets = {};
    if (interactive) {
      const moves = legalMoves(view, mySide);
      for (const m of moves) (targets[m.from] = targets[m.from] || []).push(m);
    }

    const checked = view.turn ? (inCheck(b, view.turn) ? view.turn : null) : null;
    if (checked && checked !== el.__prevChecked) {
      let ksq = -1;
      for (let i = 0; i < 64; i++) if (b[i] && b[i].p === 'k' && b[i].c === checked) { ksq = i; break; }
      if (ksq >= 0) fx.push({ t: 'check', sq: ksq });
    }

    for (let i = 0; i < 64; i++) {
      const r = i >> 3, c = i & 7;
      const sq = document.createElement('div');
      sq.className = 'chess-sq ' + (((r + c) & 1) ? 'dark' : 'light');
      sq.dataset.i = String(i);
      const p = b[i];
      if (view.last && (view.last.from === i || view.last.to === i)) {
        sq.classList.add('lm');
        if (lmChanged) sq.classList.add('lm-new');
      }
      if (checked && p && p.p === 'k' && p.c === checked) sq.classList.add('check');
      if (p) {
        const sp = document.createElement('span');
        sp.className = 'chess-pc ' + p.c + (cascade ? ' deal' : landSet[i] ? ' land' : '');
        const gl = document.createElement('span');
        gl.className = 'pc-glyph';
        gl.textContent = GLYPH[p.c][p.p];
        sp.appendChild(gl);
        if (cascade) sp.style.animationDelay = (i * 3) + 'ms';
        sq.appendChild(sp);
      }
      if (interactive) {
        if (p && p.c === mySide) sq.classList.add('own');
        if (sel === i) sq.classList.add('sel');
        if (sel >= 0 && targets[sel] && targets[sel].some((m) => m.to === i)) {
          sq.classList.add('tgt');
          if (p) sq.classList.add('occ');
        }
      }
      sq.addEventListener('click', () => onSquare(i));
      boardEl.appendChild(sq);
    }
    for (const e of fx) { // resolve square indices to the fresh DOM elements
      if (typeof e.sq === 'number') {
        const s = boardEl.querySelector('[data-i="' + e.sq + '"]');
        if (s) e.el = s;
        delete e.sq;
      }
    }
    el.appendChild(boardEl);

    /* --- game-over stamp --- */
    if (view.over) {
      const mate = view.over.indexOf('Checkmate') === 0;
      if (view.over !== el.__prevOver) fx.push({ t: mate ? 'mate' : 'draw' });
      const st = document.createElement('div');
      st.className = 'chess-over' + (mate ? ' mate' : '');
      const word = document.createElement('span');
      word.className = 'chess-overword';
      word.textContent = mate ? 'Checkmate' : view.over.indexOf('Stalemate') === 0 ? 'Stalemate' : 'Draw';
      st.appendChild(word);
      boardEl.appendChild(st);
    }

    /* --- promotion picker: a pawn on a last-rank target opens a 4-choice bar --- */
    if (interactive && promo) {
      const cands = (targets[promo.from] || []).filter((m) => m.to === promo.to && m.promo);
      if (cands.length) {
        const bar = document.createElement('div');
        bar.className = 'chess-promo';
        for (const q of ['q', 'r', 'b', 'n']) {
          const mv = cands.find((m) => m.promo === q);
          const bt = document.createElement('button');
          bt.className = 'btn';
          bt.textContent = GLYPH[mySide][q];
          bt.addEventListener('click', () => { el.__promo = null; onMove(mv); });
          bar.appendChild(bt);
        }
        const cx = document.createElement('button');
        cx.className = 'btn';
        cx.textContent = 'Cancel';
        cx.addEventListener('click', () => { el.__promo = null; render(view, el, opts); });
        bar.appendChild(cx);
        el.appendChild(bar);
      }
    }

    /* --- FLIP invert + play, and capture ghosts --- */
    UI.flipPlay(flipPlan, boardEl, {
      squareAt: (b, i) => b.querySelector('[data-i="' + i + '"]'),
      moverAt: (toSq) => toSq.querySelector('.chess-pc'),
      ghostEl: (g, sq) => {
        const gh = document.createElement('span');
        gh.className = 'chess-pc ' + g.piece.c + ' ghost';
        const gl = document.createElement('span');
        gl.className = 'pc-glyph';
        gl.textContent = GLYPH[g.piece.c][g.piece.p];
        gh.appendChild(gl);
        return gh;
      }
    });

    el.__events = fx.filter((e) => e.t); // fresh array every render, even empty (pumpEvents contract)
    el.__prevBoard = b;
    el.__prevChecked = checked;
    el.__prevOver = view.over || '';
    el.__lastTextKey = text;
    el.__lastLmKey = lmKey;

    function paint() {
      const s0 = getSel();
      boardEl.querySelectorAll('.sel,.tgt').forEach((x) => x.classList.remove('sel', 'tgt'));
      const bar = el.querySelector('.chess-promo');
      if (bar && !getPromo() && bar.parentNode) bar.parentNode.removeChild(bar);
      if (s0 >= 0) {
        const s = boardEl.querySelector('[data-i="' + s0 + '"]');
        if (s) s.classList.add('sel');
        (targets[s0] || []).forEach((m) => {
          const t = boardEl.querySelector('[data-i="' + m.to + '"]');
          if (t) {
            t.classList.add('tgt');
            if (b[m.to]) t.classList.add('occ'); // occupied enemy target → capture ring
          }
        });
      }
    }

    function onSquare(i) {
      if (!interactive) return;
      if (el.__promo) el.__promo = null; // any square click dismisses an open picker
      const s0 = getSel();
      const p = b[i];
      const own = !!p && p.c === mySide;
      if (s0 === i) { el.__sel = -1; paint(); return; }
      if (own) { el.__sel = i; paint(); return; }
      if (s0 >= 0 && targets[s0]) {
        const cands = targets[s0].filter((m) => m.to === i);
        if (cands.length) {
          el.__sel = -1;
          if (cands.some((m) => m.promo)) {
            el.__promo = { from: s0, to: i };
            render(view, el, opts); // rebuild with the picker bar
            return;
          }
          onMove(cands[0]);
          return;
        }
      }
      el.__sel = -1;
      paint();
    }
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    for (const side of ['white', 'black']) {
      let mat = 0;
      for (let i = 0; i < 64; i++) {
        const p = view.board[i];
        if (p && p.c === side) mat += VAL[p.p];
      }
      const row = document.createElement('div');
      row.className = 'player-row' + (view.turn === side ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = (opts.mySide === side ? 'You — ' : '') + (side === 'white' ? 'White' : 'Black');
      const det = document.createElement('span');
      det.className = 'muted';
      let t = 'material ' + mat;
      if (view.turn === side && inCheck(view.board, side)) t += ' · in check';
      det.textContent = t;
      row.appendChild(name);
      row.appendChild(det);
      el.appendChild(row);
    }
  }

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['chess'] = global.PARLOR['chess'] || {};
  global.PARLOR['chess'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);

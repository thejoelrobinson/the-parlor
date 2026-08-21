/* games/checkers/view.js — Checkers: DOM render layer. Logic symbols via L = global.PARLOR['checkers'].logic. */
(function (global) {
  'use strict';

  const L = global.PARLOR['checkers'].logic;
  const { FILES, DIRS, CENTER, BIG, inb, enemy, nm, lastChip, startBoard, newState, movesFrom, jumpsFrom, legalMoves, applyMove, describeMove, outcome, currentSide, viewFor, scoreBoard, simApply, ab, aiMove } = L;

  /* ---------- render ---------- */

  /* ---------- FX events (P2P-safe) ----------
     Both P2P peers diff the same consecutive views, so each fires identical
     SFX/particles locally: main.js's pumpEvents consumes el.__events after
     every render. Signature = 64-char board encoding ('.' empty, 'r'/'b' men,
     'R'/'B' kings) + '|' + turn + '|' + jump pointer. The previous signature
     and the other per-render presentation state live on the render element
     (el.__ckPrevSig / __ckPrevBoard / __ckChipKey / __ckLmKey) because #board
     persists across games in one session. No result events: the overlay's
     resultTone carries the win/draw audio. */
  const sigOf = (view) => {
    const b = view.board;
    let s = '';
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) s += '.';
      else s += p.c === 'red' ? (p.king ? 'R' : 'r') : (p.king ? 'B' : 'b');
    }
    return s + '|' + view.turn + '|' + view.jumpFrom;
  };

  const isManCh = (c) => c === 'r' || c === 'b';
  const isKingCh = (c) => c === 'R' || c === 'B';
  const sameCh = (a, b) => a === b || (a === 'r' && b === 'R') || (a === 'b' && b === 'B');

  // Plan {t, i?} events from two signatures (pure; render attaches the square
  // elements). Vanished unpaired man = capture (multijump while a jump
  // sequence is still in progress), paired mover = move (suppressed when a
  // capture happened), man->king flip = crown (may ride on a capture).
  function diffFx(prevSig, newSig, view) {
    const plan = [];
    if (typeof prevSig !== 'string') { plan.push({ t: 'deal' }); return plan; }
    const oldC = prevSig.slice(0, 64);
    const newC = newSig.slice(0, 64);
    let changed = 0;
    for (let i = 0; i < 64; i++) if (oldC[i] !== newC[i]) changed++;
    if (changed > 8) { plan.push({ t: 'deal' }); return plan; } // board reset (rematch)
    if (changed === 0) return plan; // identical re-render: nothing to play
    const jumping = view.jumpFrom >= 0;
    const froms = [], tos = [];
    for (let i = 0; i < 64; i++) {
      if (oldC[i] !== '.' && newC[i] === '.') froms.push(i);
      else if (oldC[i] === '.' && newC[i] !== '.') tos.push(i);
    }
    // Pair mover origins with landing squares by identity: same color; a
    // crowning move flips man->king on the landing square and still pairs.
    const used = {};
    const pairs = [];
    for (let ti = 0; ti < tos.length; ti++) {
      const to = tos[ti], nc = newC[to];
      for (let f = 0; f < froms.length; f++) {
        if (used[f]) continue;
        if (sameCh(oldC[froms[f]], nc)) {
          pairs.push({ from: froms[f], to: to });
          used[f] = true;
          break;
        }
      }
    }
    let captured = false;
    for (let f = 0; f < froms.length; f++) {
      if (used[f]) continue;
      captured = true;
      plan.push({ t: jumping ? 'multijump' : 'capture', i: froms[f] }); // one per captured man
    }
    if (!captured) {
      for (const pr of pairs) plan.push({ t: 'move', i: pr.to });
    }
    for (const pr of pairs) { // crowned on the landing move (man -> king)
      if (isManCh(oldC[pr.from]) && isKingCh(newC[pr.to])) plan.push({ t: 'crown', i: pr.to });
    }
    for (let i = 0; i < 64; i++) { // defensive in-place man->king flip (cannot occur in this engine)
      if (oldC[i] !== '.' && newC[i] !== '.' && isManCh(oldC[i]) && isKingCh(newC[i]) && sameCh(oldC[i], newC[i])) {
        plan.push({ t: 'crown', i: i });
      }
    }
    return plan;
  }

  /* ---------- FLIP board transition ----------
     Same technique as chess: snapshot the previous render's board, read the
     old square rects while the old DOM is still live, then glide the moved
     pieces, fade captured ones as ghosts, and pop the landing piece.
     Feature-detected so the Node click-test stub skips the effect entirely.
     Per-render state (previous board, chip/lm keys, FX signature) lives on
     the render element: el.__ckPrevBoard / __ckChipKey / __ckLmKey / __ckPrevSig. */


  function pieceSame(a, c) {
    return !!a && !!c && a.c === c.c && !!a.king === !!c.king;
  }

  function makeDisc(piece, i) {
    const pc = document.createElement('div');
    pc.className = 'chk-pc ' + piece.c;
    if (piece.king) {
      pc.classList.add('ck-king');
      const cr = document.createElement('span');
      cr.className = 'crown';
      cr.textContent = '♛';
      pc.appendChild(cr);
    } else if (typeof i === 'number') {
      const r = i >> 3;
      if (piece.c === 'red' ? r === 0 : r === 7) pc.classList.add('ck-crownrow'); // promotion row
    }
    return pc;
  }

  function render(view, el, opts) {
    const mySide = opts.mySide;
    const interactive = !!opts.interactive;
    const onMove = opts.onMove;
    const b = view.board;

    /* --- FX event plan: pure diff of this view against the last rendered
       signature on this element (P2P-safe; main.js pumps el.__events) --- */
    const newSig = sigOf(view);
    const evPlan = diffFx(el.__ckPrevSig, newSig, view);

    if (!interactive) el.__sel = -1;
    const getSel = () => (typeof el.__sel === 'number' ? el.__sel : -1);
    const sel = getSel();

    /* --- diff against the previous render's board --- */
    const flip = UI.animOk();
    const prevBoard = el.__ckPrevBoard;
    const glides = [], ghosts = [];
    const landSet = {};
    let cascade = false;
    if (flip && b.length === 64) {
      if (!prevBoard) {
        cascade = true; // first paint: deal the board in
      } else {
        let changed = 0;
        for (let i = 0; i < 64; i++) if (!pieceSame(prevBoard[i], b[i])) changed++;
        if (changed > 4) {
          cascade = true; // board reset (rematch)
        } else if (changed > 0) {
          const froms = [], tos = [];
          for (let i = 0; i < 64; i++) {
            if (prevBoard[i] && !b[i]) froms.push(i);
            else if (!prevBoard[i] && b[i]) tos.push(i);
          }
          const used = {};
          for (const to of tos) { // pair moved pieces by identity (a jump = 1 pair)
            for (let f = 0; f < froms.length; f++) {
              if (used[f]) continue;
              if (pieceSame(prevBoard[froms[f]], b[to])) {
                glides.push({ from: froms[f], to: to });
                used[f] = true;
                break;
              }
            }
          }
          for (let f = 0; f < froms.length; f++) { // unpaired = captured
            if (!used[f]) ghosts.push({ i: froms[f], piece: prevBoard[froms[f]] });
          }
          for (const g of glides) landSet[g.to] = true;
          for (let i = 0; i < 64; i++) { // crowning: piece swapped in place
            if (prevBoard[i] && b[i] && !pieceSame(prevBoard[i], b[i])) landSet[i] = true;
          }
        }
      }
    }

    /* --- capture old square rects while the old board is still in the DOM --- */
    const flipPlan = UI.flipCapture(el, { boardSel: '.chk-board', glides: glides, ghosts: ghosts });

    el.innerHTML = '';

    /* --- last-move chip (with keep-jumping badge) --- */
    const jumping = view.jumpFrom >= 0;
    const text = lastChip(view.last) + (jumping ? '  ·  jump again' : '');
    const chipChanged = text !== el.__ckChipKey;
    const lmKey = view.last ? (view.last.from + ':' + view.last.to + ':' + (view.last.cap ? 1 : 0)) : '';
    const lmChanged = lmKey !== el.__ckLmKey;
    const chipEl = document.createElement('div');
    chipEl.className = 'chk-last' + (chipChanged ? '' : ' still') + (jumping ? ' jump' : '');
    chipEl.textContent = text;
    el.appendChild(chipEl);

    /* --- board --- */
    const boardEl = document.createElement('div');
    boardEl.className = 'chk-board' + (jumping ? ' ck-jumping' : '');

    const targets = {};
    if (interactive) {
      const moves = legalMoves(view, mySide);
      for (const m of moves) (targets[m.from] = targets[m.from] || []).push(m);
    }

    const sqEls = [];
    for (let i = 0; i < 64; i++) {
      const r = i >> 3, c = i & 7;
      const dark = ((r + c) & 1) === 1;
      const sq = document.createElement('div');
      sq.className = 'chk-sq ' + (dark ? 'dark' : 'light');
      sq.dataset.i = String(i);
      sqEls.push(sq);
      if (i === view.jumpFrom) sq.classList.add('must-jump');
      if (view.last && (view.last.from === i || view.last.to === i)) {
        sq.classList.add('lm');
        if (lmChanged) sq.classList.add('lm-new');
      }
      const p = b[i];
      if (p) {
        const wrap = document.createElement('span');
        wrap.className = 'chk-wrap' + (cascade ? ' deal' : '');
        const pc = makeDisc(p, i);
        if (landSet[i]) pc.classList.add('land');
        if (!cascade && landSet[i] && p.king && prevBoard && prevBoard[i] && !prevBoard[i].king) pc.classList.add('crowned');
        wrap.appendChild(pc);
        if (cascade) wrap.style.animationDelay = (i * 3) + 'ms';
        sq.appendChild(wrap);
      }
      if (interactive && dark) {
        if (p && p.c === mySide) sq.classList.add('own');
        if (sel === i) sq.classList.add('sel');
        if (sel >= 0 && targets[sel] && targets[sel].some((m) => m.to === i)) sq.classList.add('tgt');
      }
      sq.addEventListener('click', () => onSquare(i));
      boardEl.appendChild(sq);
    }
    el.appendChild(boardEl);

    /* --- game-over stamp --- */
    if (view.over) {
      const draw = view.over.indexOf('Draw') === 0;
      const red = view.over.indexOf('Red wins') === 0;
      const st = document.createElement('div');
      st.className = 'chk-over' + (draw ? '' : red ? ' red' : ' black');
      const word = document.createElement('span');
      word.className = 'chk-overword';
      word.textContent = draw ? 'Draw' : red ? 'Red wins' : 'Black wins';
      st.appendChild(word);
      boardEl.appendChild(st);
    }

    /* --- FLIP invert + play, and capture ghosts --- */
    UI.flipPlay(flipPlan, boardEl, {
      squareAt: (b, i) => b.querySelector('[data-i="' + i + '"]'),
      moverAt: (toSq) => toSq.querySelector('.chk-wrap'),
      ghostEl: (g, sq) => {
        const gh = makeDisc(g.piece);
        gh.classList.add('ghost');
        return gh;
      }
    });

    el.__events = evPlan.map((p) => (p.i >= 0 ? { t: p.t, el: sqEls[p.i] } : { t: p.t, el: boardEl })); // deal centers on the whole board
    el.__ckPrevSig = newSig;
    el.__ckPrevBoard = b;
    el.__ckChipKey = text;
    el.__ckLmKey = lmKey;

    function paint() {
      const s0 = getSel();
      boardEl.querySelectorAll('.sel,.tgt').forEach((x) => x.classList.remove('sel', 'tgt'));
      if (s0 >= 0) {
        const s = boardEl.querySelector('[data-i="' + s0 + '"]');
        if (s) s.classList.add('sel');
        (targets[s0] || []).forEach((m) => {
          const t = boardEl.querySelector('[data-i="' + m.to + '"]');
          if (t) t.classList.add('tgt');
        });
      }
    }

    function onSquare(i) {
      if (!interactive) return;
      const s0 = getSel();
      const p = b[i];
      const own = !!p && p.c === mySide;
      if (s0 === i) { el.__sel = -1; paint(); return; }
      if (own) { el.__sel = i; paint(); return; }
      if (s0 >= 0 && targets[s0]) {
        const cands = targets[s0].filter((m) => m.to === i);
        if (cands.length) { el.__sel = -1; onMove(cands[0]); return; }
      }
      el.__sel = -1;
      paint();
    }
  }

  function countPieces(view, side) {
    let men = 0, kings = 0;
    for (let i = 0; i < 64; i++) {
      const p = view.board[i];
      if (p && p.c === side) {
        if (p.king) kings++;
        else men++;
      }
    }
    return { men: men, kings: kings };
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    for (const side of ['red', 'black']) {
      const n = countPieces(view, side);
      const row = document.createElement('div');
      row.className = 'player-row' + (view.turn === side ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = (opts.mySide === side ? 'You — ' : '') + (side === 'red' ? 'Red' : 'Black');
      const det = document.createElement('span');
      det.className = 'muted';
      let t = n.men + ' men · ' + n.kings + ' kings';
      if (view.jumpFrom >= 0 && view.board[view.jumpFrom] && view.board[view.jumpFrom].c === side) t += ' · must continue jumping';
      det.textContent = t;
      row.appendChild(name);
      row.appendChild(det);
      el.appendChild(row);
    }
  }

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['checkers'] = global.PARLOR['checkers'] || {};
  global.PARLOR['checkers'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);

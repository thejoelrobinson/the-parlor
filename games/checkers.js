(function (global) {
  'use strict';
  /* Checkers — pure logic (Node-testable) + DOM render.
   * Board: 64-array, index 0 = a8 ... 63 = h1. Playable squares are dark: (row+col)%2===1.
   * Red sits on rows 5-7 and moves up (row-1); black sits on rows 0-2 and moves down.
   * Piece: {c:'red'|'black', king:bool}. Move: {from, to, cap}.
   * Mandatory captures; multi-jump continuation tracked via state.jumpFrom.
   */

  const FILES = 'abcdefgh';
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const CENTER = [27, 28, 35, 36]; // d4 e4 d5 e5
  const BIG = 10000;

  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const enemy = (c) => (c === 'red' ? 'black' : 'red');
  const nm = (i) => FILES[i & 7] + (8 - (i >> 3));

  function startBoard() {
    const b = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (((r + c) & 1) !== 1) continue;
        if (r >= 5) b[r * 8 + c] = { c: 'red', king: false };
        else if (r <= 2) b[r * 8 + c] = { c: 'black', king: false };
      }
    }
    return b;
  }

  function newState() {
    return { board: startBoard(), turn: 'red', jumpFrom: -1, quiet: 0, last: null };
  }

  function movesFrom(b, i, p) {
    const out = [];
    const r = i >> 3, c = i & 7;
    const dirs = p.king ? DIRS : (p.c === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
    for (const [dr, dc] of dirs) {
      const rr = r + dr, cc = c + dc;
      if (!inb(rr, cc)) continue;
      const t = rr * 8 + cc;
      const tp = b[t];
      if (!tp) {
        out.push([t, false]);
      } else if (tp.c !== p.c) {
        const br = rr + dr, bc = cc + dc;
        if (inb(br, bc) && !b[br * 8 + bc]) out.push([br * 8 + bc, true]);
      }
    }
    return out;
  }

  const jumpsFrom = (b, i, p) => movesFrom(b, i, p).filter((x) => x[1]);

  function legalMoves(state, side) {
    if (side !== state.turn) return [];
    const b = state.board;
    if (state.jumpFrom >= 0) {
      const p = b[state.jumpFrom];
      if (!p || p.c !== side) return [];
      return jumpsFrom(b, state.jumpFrom, p).map((x) => ({ from: state.jumpFrom, to: x[0], cap: true }));
    }
    const simple = [];
    const caps = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p.c !== side) continue;
      for (const [to, cap] of movesFrom(b, i, p)) {
        const m = { from: i, to: to, cap: !!cap };
        if (cap) caps.push(m);
        else simple.push(m);
      }
    }
    return caps.length ? caps : simple;
  }

  function applyMove(state, m) {
    const side = state.turn;
    const b = state.board;
    const p = b[m.from];
    const r1 = m.from >> 3, c1 = m.from & 7;
    const r2 = m.to >> 3, c2 = m.to & 7;
    const mid = m.cap ? ((r1 + r2) >> 1) * 8 + ((c1 + c2) >> 1) : -1;
    const midPiece = m.cap ? b[mid] : null;

    b[m.to] = p;
    b[m.from] = null;
    if (m.cap) b[mid] = null;

    let text = (side === 'red' ? 'Red ' : 'Black ') + (p.king ? 'king ' : 'man ') + nm(m.from) +
      (m.cap ? '×' : '–') + nm(m.to);
    if (m.cap) text += ' (captures ' + (midPiece.king ? 'king' : 'man') + ')';

    const lastRow = side === 'red' ? 0 : 7;
    if (!p.king && (m.to >> 3) === lastRow) {
      p.king = true;
      text += ', crowned';
    }

    if (m.cap) {
      const more = jumpsFrom(b, m.to, p).length > 0;
      state.jumpFrom = more ? m.to : -1;
      if (!more) state.turn = enemy(side);
    } else {
      state.jumpFrom = -1;
      state.turn = enemy(side);
    }
    state.quiet = m.cap ? 0 : (state.quiet || 0) + 1;
    state.last = { side: side, from: m.from, to: m.to, cap: !!m.cap, text: text };
  }

  function describeMove(state, m) {
    if (state.last && state.last.from === m.from && state.last.to === m.to && !!state.last.cap === !!m.cap) {
      return state.last.text;
    }
    return 'move';
  }

  function outcome(state) {
    const side = state.turn;
    if (legalMoves(state, side).length === 0) {
      const w = enemy(side);
      return { over: true, text: (w === 'red' ? 'Red' : 'Black') + ' wins — ' + (side === 'red' ? 'Red' : 'Black') + ' has no moves left.' };
    }
    if ((state.quiet || 0) >= 80) return { over: true, text: 'Draw — 40 moves without a capture.' };
    return { over: false };
  }

  function currentSide(state) {
    return outcome(state).over ? null : state.turn;
  }

  function viewFor(state, side) {
    return JSON.parse(JSON.stringify(state));
  }

  /* ---------- AI: alpha-beta, depth 6 (captures continue inside the search) ---------- */

  function scoreBoard(b, color) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const r = i >> 3;
      let v = p.king ? 160 : 100;
      if (!p.king) {
        v += p.c === 'red' ? (6 - r) * 2 : r * 2;
        if ((p.c === 'red' && r === 6) || (p.c === 'black' && r === 1)) v += 3;
      }
      if (CENTER.indexOf(i) >= 0) v += 2;
      s += p.c === color ? v : -v;
    }
    return s;
  }

  function simApply(st, m) {
    const b = st.board.slice();
    const p = { c: b[m.from].c, king: b[m.from].king };
    const r1 = m.from >> 3, c1 = m.from & 7;
    const r2 = m.to >> 3, c2 = m.to & 7;
    const mid = m.cap ? ((r1 + r2) >> 1) * 8 + ((c1 + c2) >> 1) : -1;
    b[m.to] = p;
    b[m.from] = null;
    if (m.cap) b[mid] = null;
    const lastRow = p.c === 'red' ? 0 : 7;
    if (!p.king && (m.to >> 3) === lastRow) p.king = true;
    let jumpFrom = -1;
    if (m.cap && jumpsFrom(b, m.to, p).length > 0) jumpFrom = m.to;
    return { board: b, turn: jumpFrom >= 0 ? st.turn : enemy(st.turn), jumpFrom: jumpFrom, last: null };
  }

  function ab(st, color, depth, alpha, beta) {
    const moves = legalMoves(st, color);
    if (moves.length === 0) return -(BIG + depth);
    if (depth === 0) return scoreBoard(st.board, color);
    moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
    let best = -Infinity;
    for (const m of moves) {
      const s = -ab(simApply(st, m), enemy(color), depth - 1, -beta, -alpha);
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function aiMove(state, side) {
    const moves = legalMoves(state, side);
    if (!moves.length) return null;
    moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
    let best = moves[0], bestScore = -Infinity;
    for (const m of moves) {
      const s = -ab(simApply(state, m), enemy(side), 5, -Infinity, Infinity);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* ---------- render ---------- */

  function render(view, el, opts) {
    const mySide = opts.mySide;
    const interactive = !!opts.interactive;
    const onMove = opts.onMove;
    const b = view.board;

    if (!interactive) el.__sel = -1;
    const getSel = () => (typeof el.__sel === 'number' ? el.__sel : -1);
    const sel = getSel();

    el.innerHTML = '';
    const boardEl = document.createElement('div');
    boardEl.className = 'chk-board';

    const targets = {};
    if (interactive) {
      const moves = legalMoves(view, mySide);
      for (const m of moves) (targets[m.from] = targets[m.from] || []).push(m);
    }

    for (let i = 0; i < 64; i++) {
      const r = i >> 3, c = i & 7;
      const dark = ((r + c) & 1) === 1;
      const sq = document.createElement('div');
      sq.className = 'chk-sq ' + (dark ? 'dark' : 'light');
      sq.dataset.i = String(i);
      if (view.last && (view.last.from === i || view.last.to === i)) sq.classList.add('lm');
      const p = b[i];
      if (p) {
        const pc = document.createElement('div');
        pc.className = 'chk-pc ' + p.c;
        if (p.king) {
          const cr = document.createElement('span');
          cr.className = 'crown';
          cr.textContent = '♛';
          pc.appendChild(cr);
        }
        sq.appendChild(pc);
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

  const css = [
    '.chk-board{display:grid;grid-template-columns:repeat(8,1fr);width:min(92vw,520px);margin:0 auto;border:3px solid #232936;border-radius:8px;overflow:hidden}',
    '.chk-sq{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center}',
    '.chk-sq.light{background:#252b3a}',
    '.chk-sq.dark{background:#7a5a40}',
    '.chk-pc{width:72%;height:72%;border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,.55), inset 0 -4px 8px rgba(0,0,0,.35);pointer-events:none}',
    '.chk-pc.red{background:radial-gradient(circle at 35% 30%, #f08074, #c0392b 72%)}',
    '.chk-pc.black{background:radial-gradient(circle at 35% 30%, #4d5a70, #10141c 72%)}',
    '.chk-pc .crown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ffd75e;font-size:clamp(12px,3.2vw,22px);text-shadow:0 1px 2px #000}',
    '.chk-sq.own{cursor:pointer}',
    '.chk-sq.sel{outline:3px solid #f5c518;outline-offset:-3px}',
    '.chk-sq.tgt{cursor:pointer}',
    '.chk-sq.tgt::after{content:"";position:absolute;width:26%;height:26%;border-radius:50%;background:rgba(245,197,24,.85);pointer-events:none}',
    '.chk-sq.lm{box-shadow:inset 0 0 0 3px rgba(96,165,250,.6)}'
  ].join('\n');

  const game = {
    id: 'checkers',
    title: 'Checkers',
    blurb: 'Mandatory captures, multi-jumps, crowning. Red moves first.',
    sideList: ['red', 'black'],
    pickSide: true,
    sideName(side) { return side === 'red' ? 'Red' : 'Black'; },
    css,
    newState,
    currentSide,
    legalMoves,
    applyMove,
    outcome,
    viewFor,
    aiMove,
    describeMove,
    render,
    renderInfo
  };

  global.Games = global.Games || {};
  global.Games['checkers'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);

/* games/checkers/logic.js — Checkers: pure game logic (no DOM; runs in Node). Split from games/checkers.js. */
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

  function lastChip(last) {
    if (!last) return '';
    return (last.side === 'red' ? 'Red' : 'Black') + ' ' + nm(last.from) + (last.cap ? '×' : '–') + nm(last.to);
  }

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
    const v = JSON.parse(JSON.stringify(state));
    const o = outcome(state);
    if (o.over) v.over = o.text; // additive public field: both peers see the same view
    return v;
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
    // CONTRACT: null when the side is out of turn or has no legal move; callers null-check.
    if (!moves.length) return null;
    moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
    let best = moves[0], bestScore = -Infinity;
    for (const m of moves) {
      const s = -ab(simApply(state, m), enemy(side), 5, -Infinity, Infinity);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  const logic = {
    FILES,
    DIRS,
    CENTER,
    BIG,
    inb,
    enemy,
    nm,
    lastChip,
    startBoard,
    newState,
    movesFrom,
    jumpsFrom,
    legalMoves,
    applyMove,
    describeMove,
    outcome,
    currentSide,
    viewFor,
    scoreBoard,
    simApply,
    ab,
    aiMove,
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['checkers'] = global.PARLOR['checkers'] || {};
  global.PARLOR['checkers'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);

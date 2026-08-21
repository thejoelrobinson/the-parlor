/* games/chess/logic.js — Chess: pure game logic (no DOM; runs in Node). Split from games/chess.js. */
(function (global) {
  'use strict';

  /* Chess — pure logic (Node-testable) + DOM render.
   * Board: 64-array, index 0 = a8 ... 63 = h1. Piece {p, c} or null.
   * Move: {from, to, promo} — promo is null unless a pawn promotes.
   */

  const FILES = 'abcdefgh';
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KINGD = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ROOKD = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const BISHD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const CENTER = [19, 20, 27, 28]; // d5 e5 d4 e4
  const MATE = 100000;

  function startBoard() {
    const b = new Array(64).fill(null);
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let c = 0; c < 8; c++) {
      b[c] = { p: back[c], c: 'black' };
      b[8 + c] = { p: 'p', c: 'black' };
      b[48 + c] = { p: 'p', c: 'white' };
      b[56 + c] = { p: back[c], c: 'white' };
    }
    return b;
  }

  function newState() {
    const s = {
      board: startBoard(),
      turn: 'white',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      ep: -1,
      halfmove: 0,
      last: null,
      history: []
    };
    s.history.push(posKey(s));
    return s;
  }

  /* Position key for threefold repetition: piece placement, side to move,
   * en-passant target, and castling rights. (Rights — not the rooks' squares —
   * define the position, so a rook that leaves and returns does not count.) */
  function posKey(state) {
    const cr = state.castling;
    return state.board.map((p) => (p ? p.p + p.c : '.')).join('') +
      '|' + state.turn + '|' + state.ep + '|' +
      (cr ? (cr.wK ? 'K' : '') + (cr.wQ ? 'Q' : '') + (cr.bK ? 'k' : '') + (cr.bQ ? 'q' : '') : '');
  }

  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const enemy = (c) => (c === 'white' ? 'black' : 'white');

  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    // pawns
    const pr = by === 'white' ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc >= 0 && cc < 8) {
          const p = b[pr * 8 + cc];
          if (p && p.c === by && p.p === 'p') return true;
        }
      }
    }
    // knights
    for (const [dr, dc] of KNIGHT) {
      const rr = r + dr, cc = c + dc;
      if (!inb(rr, cc)) continue;
      const p = b[rr * 8 + cc];
      if (p && p.c === by && p.p === 'n') return true;
    }
    // king
    for (const [dr, dc] of KINGD) {
      const rr = r + dr, cc = c + dc;
      if (!inb(rr, cc)) continue;
      const p = b[rr * 8 + cc];
      if (p && p.c === by && p.p === 'k') return true;
    }
    // rook / queen lines
    for (const [dr, dc] of ROOKD) {
      let rr = r + dr, cc = c + dc;
      while (inb(rr, cc)) {
        const p = b[rr * 8 + cc];
        if (p) {
          if (p.c === by && (p.p === 'r' || p.p === 'q')) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
    // bishop / queen lines
    for (const [dr, dc] of BISHD) {
      let rr = r + dr, cc = c + dc;
      while (inb(rr, cc)) {
        const p = b[rr * 8 + cc];
        if (p) {
          if (p.c === by && (p.p === 'b' || p.p === 'q')) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
    return false;
  }

  function kingSq(b, color) {
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p && p.p === 'k' && p.c === color) return i;
    }
    return -1;
  }

  function inCheck(b, color) {
    const k = kingSq(b, color);
    return k >= 0 && attacked(b, k, enemy(color));
  }

  /* Apply a move onto a board copy. ep = en-passant target square or -1. */
  function applyBoard(b, m, ep) {
    const nb = b.slice();
    const piece = nb[m.from];
    const isEP = piece.p === 'p' && ep >= 0 && m.to === ep && nb[m.to] === null;
    nb[m.to] =
      piece.p === 'p' && ((piece.c === 'white' && (m.to >> 3) === 0) || (piece.c === 'black' && (m.to >> 3) === 7))
        ? { p: m.promo || 'q', c: piece.c }
        : piece;
    nb[m.from] = null;
    if (isEP) nb[piece.c === 'white' ? m.to + 8 : m.to - 8] = null;
    if (piece.p === 'k' && Math.abs((m.to & 7) - (m.from & 7)) === 2) {
      const row = m.from >> 3;
      if ((m.to & 7) === 6) { nb[row * 8 + 5] = nb[row * 8 + 7]; nb[row * 8 + 7] = null; }
      else { nb[row * 8 + 3] = nb[row * 8]; nb[row * 8] = null; }
    }
    return nb;
  }

  function genPseudo(b, side, ep, full, cr) {
    const out = [];
    const dir = side === 'white' ? -1 : 1;
    const startRow = side === 'white' ? 6 : 1;
    const lastRow = side === 'white' ? 0 : 7;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p.c !== side) continue;
      const r = i >> 3, c = i & 7;
      if (p.p === 'p') {
        const f = i + dir * 8;
        if (f >= 0 && f < 64 && !b[f]) {
          if ((f >> 3) === lastRow) {
            for (const q of ['q', 'r', 'b', 'n']) out.push({ from: i, to: f, promo: q });
          } else out.push({ from: i, to: f, promo: null });
          if (r === startRow) {
            const s2 = i + dir * 16;
            if (!b[s2]) out.push({ from: i, to: s2, promo: null });
          }
        }
        if (f >= 0 && f < 64) {
          for (const dc of [-1, 1]) {
            const cc = c + dc;
            if (cc < 0 || cc > 7) continue;
            const t = f + dc; // diagonal capture square = forward square ±1 file
            const tp = b[t];
            if (tp && tp.c !== side) {
              if ((t >> 3) === lastRow) {
                for (const q of ['q', 'r', 'b', 'n']) out.push({ from: i, to: t, promo: q });
              } else out.push({ from: i, to: t, promo: null });
            } else if (full && !tp && t === ep) {
              out.push({ from: i, to: t, promo: null });
            }
          }
        }
        continue;
      }
      if (p.p === 'n' || p.p === 'k') {
        const dirs = p.p === 'n' ? KNIGHT : KINGD;
        for (const [dr, dc] of dirs) {
          const rr = r + dr, cc = c + dc;
          if (!inb(rr, cc)) continue;
          const t = rr * 8 + cc;
          const tp = b[t];
          if (!tp || tp.c !== side) out.push({ from: i, to: t, promo: null });
        }
        if (p.p === 'k' && full) {
          const row = side === 'white' ? 7 : 0;
          const home = row * 8 + 4;
          if (i === home && !attacked(b, home, enemy(side))) {
            // The right is tracked in state (a rook that leaves its home square
            // forfeits it even if it returns); the rook must still be there.
            const kRight = !cr || cr[side === 'white' ? 'wK' : 'bK'];
            const rookK = side === 'white' ? (b[63] && b[63].p === 'r' && b[63].c === 'white') : (b[7] && b[7].p === 'r' && b[7].c === 'black');
            if (kRight && rookK && !b[row * 8 + 5] && !b[row * 8 + 6] && !attacked(b, row * 8 + 5, enemy(side)) && !attacked(b, row * 8 + 6, enemy(side))) {
              out.push({ from: home, to: row * 8 + 6, promo: null });
            }
            const qRight = !cr || cr[side === 'white' ? 'wQ' : 'bQ'];
            const rookQ = side === 'white' ? (b[56] && b[56].p === 'r' && b[56].c === 'white') : (b[0] && b[0].p === 'r' && b[0].c === 'black');
            // FIDE: only the king's path squares (c, d, e) must be unattacked;
            // the rook's path square (b) may be attacked.
            if (qRight && rookQ && !b[row * 8 + 1] && !b[row * 8 + 2] && !b[row * 8 + 3] && !attacked(b, row * 8 + 3, enemy(side)) && !attacked(b, row * 8 + 2, enemy(side))) {
              out.push({ from: home, to: row * 8 + 2, promo: null });
            }
          }
        }
        continue;
      }
      const dirs = p.p === 'b' ? BISHD : p.p === 'r' ? ROOKD : KINGD.concat(ROOKD, BISHD);
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inb(rr, cc)) {
          const t = rr * 8 + cc;
          const tp = b[t];
          if (!tp) out.push({ from: i, to: t, promo: null });
          else {
            if (tp.c !== side) out.push({ from: i, to: t, promo: null });
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }

  function genLegal(b, side, ep, full, cr) {
    const out = [];
    for (const m of genPseudo(b, side, ep, full, cr)) {
      const nb = applyBoard(b, m, ep);
      if (!inCheck(nb, side)) out.push(m);
    }
    return out;
  }

  function legalMoves(state, side) {
    if (side !== state.turn) return [];
    return genLegal(state.board, side, state.ep, true, state.castling);
  }

  function nm(i) { return FILES[i & 7] + (8 - (i >> 3)); }

  function lastChip(last) {
    if (!last) return '';
    if (last.castle) return last.castle === 'K' ? 'O-O' : 'O-O-O';
    let t = GLYPH[last.piece.c][last.piece.p] + ' ' + nm(last.from) +
      ((last.captured || last.ep) ? '×' : '–') + nm(last.to);
    if (last.promo) t += '=' + GLYPH[last.piece.c][last.promo];
    return t;
  }

  function applyMove(state, m) {
    const b = state.board;
    const side = state.turn;
    const piece = b[m.from];
    const isEP = piece.p === 'p' && state.ep >= 0 && m.to === state.ep && b[m.to] === null;
    const captured = isEP ? (side === 'white' ? b[m.to + 8] : b[m.to - 8]) : b[m.to];
    const castle = piece.p === 'k' && Math.abs((m.to & 7) - (m.from & 7)) === 2
      ? ((m.to & 7) === 6 ? 'K' : 'Q') : null;

    state.board = applyBoard(b, m, state.ep);

    const cr = state.castling;
    if (piece.p === 'k') {
      if (side === 'white') { cr.wK = false; cr.wQ = false; }
      else { cr.bK = false; cr.bQ = false; }
    }
    if (m.from === 63 || m.to === 63) cr.wK = false;
    if (m.from === 56 || m.to === 56) cr.wQ = false;
    if (m.from === 7 || m.to === 7) cr.bK = false;
    if (m.from === 0 || m.to === 0) cr.bQ = false;

    state.ep = piece.p === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) >> 1 : -1;
    state.halfmove = piece.p === 'p' || captured ? 0 : state.halfmove + 1;
    state.turn = enemy(side);

    let text = (side === 'white' ? 'White ' : 'Black ') + NAME[piece.p] + ' ' + nm(m.from) +
      (captured || castle || isEP ? '×' : '–') + nm(m.to);
    if (captured) text += ' (takes ' + NAME[captured.p] + ')';
    if (m.promo) text += ' → ' + NAME[m.promo];
    if (castle) text += ', castles ' + (castle === 'K' ? 'king' : 'queen') + 'side';
    if (isEP) text += ', en passant';

    state.last = {
      from: m.from, to: m.to,
      piece: { p: piece.p, c: side },
      captured: captured ? { p: captured.p, c: captured.c } : null,
      promo: m.promo, castle: castle, ep: isEP,
      text: text
    };
    state.history.push(posKey(state));
  }

  function describeMove(state, m) {
    if (state.last && state.last.from === m.from && state.last.to === m.to && state.last.promo === m.promo) {
      return state.last.text;
    }
    return 'move';
  }

  function insufficientMaterial(b) {
    const minor = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p.p === 'k') continue;
      minor.push({ p: p.p, sq: i });
      if (p.p === 'r' || p.p === 'q' || (p.p === 'p')) return false;
    }
    if (minor.length === 0) return true;
    if (minor.length === 1) return true; // lone knight or bishop
    if (minor.length === 2 && minor.every((x) => x.p === 'b')) {
      const col = (sq) => ((sq >> 3) + (sq & 7)) & 1;
      if (col(minor[0].sq) === col(minor[1].sq)) return true;
    }
    return false;
  }

  function outcome(state) {
    const side = state.turn;
    const moves = legalMoves(state, side);
    if (moves.length === 0) {
      return inCheck(state.board, side)
        ? { over: true, text: 'Checkmate — ' + (side === 'white' ? 'Black' : 'White') + ' wins!' }
        : { over: true, text: 'Stalemate — draw.' };
    }
    if (state.halfmove >= 100) return { over: true, text: 'Draw — 50-move rule.' };
    if (state.history) {
      const key = posKey(state);
      let n = 0;
      for (let i = state.history.length - 1; i >= 0 && n < 3; i--) {
        if (state.history[i] === key) n++;
      }
      if (n >= 3) return { over: true, text: 'Draw — threefold repetition.' };
    }
    if (insufficientMaterial(state.board)) return { over: true, text: 'Draw — insufficient material.' };
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

  /* ---------- AI: minimax + alpha-beta, depth 3, MVV-LVA ordering ---------- */

  function evalBoard(b) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const v = VAL[p.p];
      s += p.c === 'white' ? v : -v;
      if (CENTER.indexOf(i) >= 0 && p.p !== 'k') {
        const bonus = p.p === 'p' ? 4 : 8;
        s += p.c === 'white' ? bonus : -bonus;
      }
    }
    return s;
  }

  function orderMoves(moves, b) {
    for (const m of moves) {
      const tgt = b[m.to];
      const atk = b[m.from];
      m.__s = (tgt ? VAL[tgt.p] * 10 : 0) - (atk ? VAL[atk.p] : 0) + (m.promo ? 800 : 0);
    }
    moves.sort((a, b2) => b2.__s - a.__s);
  }

  /* Per-child ep target and castling rights, mirroring applyMove's rules so
   * the search tree sees the same positions the game would actually reach. */
  function childEp(m, piece) {
    return piece.p === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) >> 1 : -1;
  }

  function childCr(cr, m, piece) {
    if (!cr) return null;
    const n = { wK: cr.wK, wQ: cr.wQ, bK: cr.bK, bQ: cr.bQ };
    if (piece.p === 'k') {
      if (piece.c === 'white') { n.wK = false; n.wQ = false; }
      else { n.bK = false; n.bQ = false; }
    }
    if (m.from === 63 || m.to === 63) n.wK = false;
    if (m.from === 56 || m.to === 56) n.wQ = false;
    if (m.from === 7 || m.to === 7) n.bK = false;
    if (m.from === 0 || m.to === 0) n.bQ = false;
    return n;
  }

  function negamax(b, color, depth, alpha, beta, ep, cr) {
    if (depth === 0) {
      if (inCheck(b, color) && genLegal(b, color, ep, true, cr).length === 0) return -MATE;
      return color === 'white' ? evalBoard(b) : -evalBoard(b);
    }
    const moves = genLegal(b, color, ep, true, cr);
    if (moves.length === 0) return inCheck(b, color) ? -MATE - depth : 0;
    orderMoves(moves, b);
    let best = -Infinity;
    const next = enemy(color);
    for (const m of moves) {
      const piece = b[m.from];
      const s = -negamax(applyBoard(b, m, ep), next, depth - 1, -beta, -alpha, childEp(m, piece), childCr(cr, m, piece));
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function aiMove(state, side) {
    const moves = legalMoves(state, side);
    if (!moves.length) return null;
    orderMoves(moves, state.board);
    let best = moves[0], bestScore = -Infinity;
    const next = enemy(side);
    for (const m of moves) {
      const piece = state.board[m.from];
      const s = -negamax(applyBoard(state.board, m, state.ep), next, 2, -Infinity, Infinity, childEp(m, piece), childCr(state.castling, m, piece));
      if (s > bestScore) { bestScore = s; best = m; }
    }
    delete best.__s; // keep returned moves canonical JSON
    return best;
  }

  /* Per-color glyph sets: white = hollow set U+2654-U+2659, black = filled set
   * U+265A-U+265F. Tinting a single filled set via CSS color to fake the white
   * side is unreliable: on some systems a code point (notably the pawn) resolves
   * to an emoji/color font that paints it a fixed black. The hollow set has a
   * genuine white pawn (U+2659), so each side uses its own glyphs and the CSS
   * color only refines the tint. */
  const GLYPH = {
    white: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
    black: { k: '\u265a', q: '\u265b', r: '\u265c', b: '\u265d', n: '\u265e', p: '\u265f' }
  };

  const logic = {
    FILES,
    VAL,
    NAME,
    KNIGHT,
    KINGD,
    ROOKD,
    BISHD,
    CENTER,
    MATE,
    startBoard,
    newState,
    posKey,
    inb,
    enemy,
    attacked,
    kingSq,
    inCheck,
    applyBoard,
    genPseudo,
    genLegal,
    legalMoves,
    nm,
    lastChip,
    applyMove,
    describeMove,
    insufficientMaterial,
    outcome,
    currentSide,
    viewFor,
    evalBoard,
    orderMoves,
    childEp,
    childCr,
    negamax,
    aiMove,
    GLYPH,
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['chess'] = global.PARLOR['chess'] || {};
  global.PARLOR['chess'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);

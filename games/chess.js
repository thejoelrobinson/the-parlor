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

  /* ---------- render ---------- */

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

  function motionOff() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function canFlip() {
    if (typeof window.requestAnimationFrame !== 'function') return false;
    if (motionOff()) return false;
    return typeof document.createElement('div').getBoundingClientRect === 'function';
  }

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
    const flip = canFlip();
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
    const oldRects = {};
    if (flip && (glides.length || ghosts.length)) {
      const oldBoard = el.querySelector('.chess-board');
      if (oldBoard) {
        for (const g of glides) {
          const s = oldBoard.querySelector('[data-i="' + g.from + '"]');
          if (s) oldRects['f' + g.from] = s.getBoundingClientRect();
        }
        for (const g of ghosts) {
          const s = oldBoard.querySelector('[data-i="' + g.i + '"]');
          if (s) oldRects['g' + g.i] = s.getBoundingClientRect();
        }
      }
    }

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
    if (flip && (glides.length || ghosts.length)) {
      const boardRect = boardEl.getBoundingClientRect();
      for (const g of glides) {
        const r0 = oldRects['f' + g.from];
        const fromSq = boardEl.querySelector('[data-i="' + g.from + '"]');
        const toSq = boardEl.querySelector('[data-i="' + g.to + '"]');
        const pc = toSq ? toSq.querySelector('.chess-pc') : null;
        if (!r0 || !fromSq || !pc) continue;
        const r1 = fromSq.getBoundingClientRect();
        const dx = r1.left - r0.left, dy = r1.top - r0.top;
        if (!dx && !dy) continue;
        pc.style.zIndex = '30';
        pc.style.transition = 'none';
        pc.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        void pc.offsetWidth; // commit the inverted position before animating
        pc.style.transition = 'transform .18s cubic-bezier(.2,.75,.3,1.08)';
        pc.style.transform = 'translate(0,0)';
        pc.addEventListener('transitionend', function done() {
          pc.style.transition = ''; pc.style.transform = ''; pc.style.zIndex = '';
          pc.removeEventListener('transitionend', done);
        });
      }
      for (const g of ghosts) {
        const r0 = oldRects['g' + g.i];
        const sq = boardEl.querySelector('[data-i="' + g.i + '"]');
        if (!r0 || !sq) continue;
        const r1 = sq.getBoundingClientRect();
        const gh = document.createElement('span');
        gh.className = 'chess-pc ' + g.piece.c + ' ghost';
        const gl = document.createElement('span');
        gl.className = 'pc-glyph';
        gl.textContent = GLYPH[g.piece.c][g.piece.p];
        gh.appendChild(gl);
        gh.style.left = (r1.left - boardRect.left) + 'px';
        gh.style.top = (r1.top - boardRect.top) + 'px';
        gh.style.width = r1.width + 'px';
        gh.style.height = r1.height + 'px';
        gh.style.zIndex = '20';
        boardEl.appendChild(gh);
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            gh.style.transition = 'opacity .22s ease .08s, transform .22s ease .08s';
            gh.style.opacity = '0';
            gh.style.transform = 'scale(.55)';
            gh.addEventListener('transitionend', function () {
              if (gh.parentNode) gh.parentNode.removeChild(gh);
            }, { once: true });
          });
        });
        window.setTimeout(function () { if (gh.parentNode) gh.parentNode.removeChild(gh); }, 900);
      }
    }

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

  const css = [
    '.chess-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);width:min(100%,540px);margin:0 auto;border:1px solid #d9d2c0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(28,33,30,.14), 0 10px 30px rgba(28,33,30,.10)}',
    '.chess-sq{position:relative;aspect-ratio:1;touch-action:manipulation;display:flex;align-items:center;justify-content:center}',
    '.chess-sq.light{background:#f0e9d8}',
    '.chess-sq.dark{background:#5c7263}',
    '.chess-pc{font-size:clamp(20px,8.5vw,42px);line-height:1;user-select:none;pointer-events:none;transition:transform .14s var(--ease-spring)}',
    '.chess-pc .pc-glyph{display:inline-block;line-height:1}',
    '.chess-pc.white{color:#f7f2e5;text-shadow:-1px 0 0 rgba(28,33,30,.7),1px 0 0 rgba(28,33,30,.7),0 -1px 0 rgba(28,33,30,.7),0 1px 0 rgba(28,33,30,.7),0 2px 4px rgba(28,33,30,.4)}',
    '.chess-pc.black{color:#23282b;text-shadow:0 1px 2px rgba(255,255,255,.35)}',
    '.chess-pc.deal{animation:pc-deal .3s var(--ease-out) both}',
    '.chess-pc.land .pc-glyph{animation:pc-land .34s var(--ease-spring) .1s both}',
    '.chess-pc.ghost{position:absolute;display:flex;align-items:center;justify-content:center;opacity:.95}',
    '.chess-sq.own{cursor:pointer}',
    '.chess-sq.own:hover{box-shadow:inset 0 0 0 3px rgba(22,104,63,.45)}',
    '.chess-sq.own:hover .chess-pc{transform:translateY(-3px) scale(1.06)}',
    '.chess-sq.sel{outline:3px solid #16683f;outline-offset:-3px}',
    '.chess-sq.sel .chess-pc{transform:scale(1.12)}',
    '.chess-sq.check{animation:check-pulse 1.1s ease-in-out infinite}',
    '.chess-sq.tgt{cursor:pointer}',
    '.chess-sq.tgt::after{content:"";position:absolute;width:28%;height:28%;border-radius:50%;background:rgba(22,104,63,.9);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;animation:dot-in .16s var(--ease-spring) both}',
    '.chess-sq.tgt.occ::after{width:86%;height:86%;background:transparent;border:4px solid rgba(22,104,63,.9)}',
    '.chess-sq.lm{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}',
    '.chess-sq.lm.lm-new{animation:chess-lm-flash .5s var(--ease-out) both}',
    '@keyframes chess-lm-flash{0%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}45%{box-shadow:inset 0 0 0 4px rgba(194,147,48,1)}100%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}}',
    '.chess-promo{display:flex;justify-content:center;gap:10px;margin-top:14px;animation:entry-in .24s var(--ease-out) both}',
    '.chess-promo .btn{width:52px;height:58px;padding:0;display:flex;align-items:center;justify-content:center;font-size:30px;line-height:1}',
    '.chess-promo .btn:last-child{width:auto;padding:0 16px;font-size:14px;font-weight:700;letter-spacing:.04em}',
    '.chess-last{width:min(100%,540px);margin:0 auto 8px;display:flex;align-items:center;justify-content:center;min-height:27px;padding:0 12px;font-size:15px;font-weight:700;letter-spacing:.04em;color:var(--ink);background:var(--surface);border:1px solid var(--hair-strong);border-radius:9px;box-shadow:var(--shadow-sm);animation:chess-last-in .3s var(--ease-out) both}',
    '.chess-last.still{animation:none}',
    '@keyframes chess-last-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}',
    '.chess-over{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(245,243,237,.45)}',
    '.chess-overword{font-family:var(--font-display);font-weight:700;font-size:clamp(26px,7vw,44px);letter-spacing:.04em;color:var(--gold);text-shadow:0 2px 12px rgba(28,33,30,.28);animation:chess-stamp .55s var(--ease-spring) both}',
    '.chess-over.mate .chess-overword{color:var(--brick)}',
    '@keyframes chess-stamp{0%{opacity:0;transform:scale(1.7) rotate(-14deg)}60%{opacity:1;transform:scale(.96) rotate(-5deg)}100%{opacity:1;transform:scale(1) rotate(-7deg)}}'
  ].join('\n');

  const game = {
    id: 'chess',
    title: 'Chess',
    blurb: 'The classic. Full rules: castling, en passant, promotions, and every standard draw.',
    hint: 'Select a piece to see its legal moves, then click a highlighted square.',
    sideList: ['white', 'black'],
    pickSide: true,
    sideName(side) { return side === 'white' ? 'White' : 'Black'; },
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
  global.Games['chess'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);

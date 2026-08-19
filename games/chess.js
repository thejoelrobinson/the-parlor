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
    return {
      board: startBoard(),
      turn: 'white',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      ep: -1,
      halfmove: 0,
      fullmove: 1,
      last: null
    };
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

  function genPseudo(b, side, ep, full) {
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
            const cr = side === 'white' ? (b[63] && b[63].p === 'r' && b[63].c === 'white') : (b[7] && b[7].p === 'r' && b[7].c === 'black');
            if (cr && !b[row * 8 + 5] && !b[row * 8 + 6] && !attacked(b, row * 8 + 5, enemy(side)) && !attacked(b, row * 8 + 6, enemy(side))) {
              out.push({ from: home, to: row * 8 + 6, promo: null });
            }
            const cq = side === 'white' ? (b[56] && b[56].p === 'r' && b[56].c === 'white') : (b[0] && b[0].p === 'r' && b[0].c === 'black');
            if (cq && !b[row * 8 + 1] && !b[row * 8 + 2] && !b[row * 8 + 3] && !attacked(b, row * 8 + 3, enemy(side)) && !attacked(b, row * 8 + 2, enemy(side)) && !attacked(b, row * 8 + 1, enemy(side))) {
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

  function genLegal(b, side, ep, full) {
    const out = [];
    for (const m of genPseudo(b, side, ep, full)) {
      const nb = applyBoard(b, m, ep);
      if (!inCheck(nb, side)) out.push(m);
    }
    return out;
  }

  function legalMoves(state, side) {
    if (side !== state.turn) return [];
    return genLegal(state.board, side, state.ep, true);
  }

  function nm(i) { return FILES[i & 7] + (8 - (i >> 3)); }

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
    if (side === 'black') state.fullmove++;
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
    if (insufficientMaterial(state.board)) return { over: true, text: 'Draw — insufficient material.' };
    return { over: false };
  }

  function currentSide(state) {
    return outcome(state).over ? null : state.turn;
  }

  function viewFor(state, side) {
    return JSON.parse(JSON.stringify(state));
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

  function negamax(b, color, depth, alpha, beta) {
    if (depth === 0) {
      if (inCheck(b, color) && genLegal(b, color, -1, false).length === 0) return -MATE;
      return color === 'white' ? evalBoard(b) : -evalBoard(b);
    }
    const moves = genLegal(b, color, -1, false);
    if (moves.length === 0) return inCheck(b, color) ? -MATE - depth : 0;
    orderMoves(moves, b);
    let best = -Infinity;
    const next = enemy(color);
    for (const m of moves) {
      const s = -negamax(applyBoard(b, m, -1), next, depth - 1, -beta, -alpha);
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
      const s = -negamax(applyBoard(state.board, m, state.ep), next, 2, -Infinity, Infinity);
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
    boardEl.className = 'chess-board';

    const targets = {};
    if (interactive) {
      const moves = legalMoves(view, mySide);
      for (const m of moves) (targets[m.from] = targets[m.from] || []).push(m);
    }

    for (let i = 0; i < 64; i++) {
      const r = i >> 3, c = i & 7;
      const sq = document.createElement('div');
      sq.className = 'chess-sq ' + (((r + c) & 1) ? 'dark' : 'light');
      sq.dataset.i = String(i);
      if (view.last && (view.last.from === i || view.last.to === i)) sq.classList.add('lm');
      const p = b[i];
      if (p) {
        const sp = document.createElement('span');
        sp.className = 'chess-pc ' + p.c;
        sp.textContent = GLYPH[p.c][p.p];
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
    el.appendChild(boardEl);

    function paint() {
      const s0 = getSel();
      boardEl.querySelectorAll('.sel,.tgt').forEach((x) => x.classList.remove('sel', 'tgt'));
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
      const s0 = getSel();
      const p = b[i];
      const own = !!p && p.c === mySide;
      if (s0 === i) { el.__sel = -1; paint(); return; }
      if (own) { el.__sel = i; paint(); return; }
      if (s0 >= 0 && targets[s0]) {
        const cands = targets[s0].filter((m) => m.to === i);
        if (cands.length) {
          el.__sel = -1;
          onMove(cands.find((m) => m.promo === 'q') || cands[0]);
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
      if (view.turn === side && inCheck(view.board, side)) t += ' · ⚠ check';
      det.textContent = t;
      row.appendChild(name);
      row.appendChild(det);
      el.appendChild(row);
    }
  }

  const css = [
    '.chess-board{display:grid;grid-template-columns:repeat(8,1fr);width:min(92vw,540px);margin:0 auto;border:1px solid #d9d2c0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(28,33,30,.14), 0 10px 30px rgba(28,33,30,.10)}',
    '.chess-sq{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center}',
    '.chess-sq.light{background:#f0e9d8}',
    '.chess-sq.dark{background:#5c7263}',
    '.chess-pc{font-size:clamp(20px,6.5vw,42px);line-height:1;user-select:none;pointer-events:none;animation:pc-settle .18s var(--ease-out) both}',
    '.chess-pc.white{color:#fdfdfb;text-shadow:-1px 0 0 rgba(28,33,30,.7),1px 0 0 rgba(28,33,30,.7),0 -1px 0 rgba(28,33,30,.7),0 1px 0 rgba(28,33,30,.7),0 2px 4px rgba(28,33,30,.4)}',
    '.chess-pc.black{color:#1f2528;text-shadow:0 1px 2px rgba(255,255,255,.35)}',
    '.chess-sq.own{cursor:pointer}',
    '.chess-sq.own:hover{box-shadow:inset 0 0 0 3px rgba(15,157,88,.45)}',
    '.chess-sq.sel{outline:3px solid #0f9d58;outline-offset:-3px}',
    '.chess-sq.tgt{cursor:pointer}',
    '.chess-sq.tgt::after{content:"";position:absolute;width:28%;height:28%;border-radius:50%;background:rgba(15,157,88,.9);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;animation:dot-in .16s var(--ease-spring) both}',
    '.chess-sq.tgt.occ::after{width:86%;height:86%;background:transparent;border:4px solid rgba(15,157,88,.9)}',
    '.chess-sq.lm{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}'
  ].join('\n');

  const game = {
    id: 'chess',
    title: 'Chess',
    blurb: 'The classic. Full rules: castling, en passant, promotions, draw detection.',
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

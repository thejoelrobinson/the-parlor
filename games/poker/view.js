/* games/poker/view.js — Poker: DOM render layer. Logic symbols via L = global.PARLOR['poker'].logic. */
(function (global) {
  'use strict';

  const L = global.PARLOR['poker'].logic;
  const { RANKS, SUITS, RANK, SYM, HAND_NAMES, SB, BB, START, buildDeck, dealHole, post, postBlinds, firstActor, nextActorFrom, newState, nextHand, currentSide, legalMoves, applyMove, endAction, showdown, outcome, sideName, eval5, bestHand, handStrength, aiMove, canonStr, viewFor, describeMove } = L;

  /* ---------- render ---------- */

  function cardEl(card) {
    const rank = card[0], suit = card[1];
    const e = document.createElement('div');
    e.className = 'card-face' + (suit === 'h' || suit === 'd' ? ' pkr-red' : '');
    const t1 = document.createElement('div');
    t1.className = 'cf-corner';
    t1.textContent = rank + SYM[suit];
    const t2 = document.createElement('div');
    t2.className = 'cf-mid';
    t2.textContent = SYM[suit];
    const t3 = document.createElement('div');
    t3.className = 'cf-corner br';
    t3.textContent = rank + SYM[suit];
    e.appendChild(t1); e.appendChild(t2); e.appendChild(t3);
    return e;
  }

  function actionBar(view, opts) {
    const side = String(opts.mySide);
    const bar = document.createElement('div');
    bar.className = 'pkr-actions';
    const moves = legalMoves(view, side);
    const addBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    const fold = moves.find((m) => m.type === 'fold');
    const check = moves.find((m) => m.type === 'check');
    const call = moves.find((m) => m.type === 'call');
    const raises = moves.filter((m) => m.type === 'raise');

    if (fold) addBtn('Fold', 'pkr-fold', () => opts.onMove(fold));
    if (check) addBtn('Check', '', () => opts.onMove(check));
    if (call) addBtn('Call ' + call.paid, 'pkr-call', () => opts.onMove(call));
    if (raises.length > 0) {
      const minR = raises[0];
      const maxR = raises[raises.length - 1];
      if (minR.amount === maxR.amount) {
        // Exactly one raise size exists (full-stack minimum, or a short
        // all-in): one button, no slider.
        addBtn('All-in ' + maxR.amount, 'pkr-call', () => opts.onMove(maxR));
      } else {
        const potR = raises.find((m) => m.amount >= view.pot);
        addBtn('Min ' + minR.amount, '', () => opts.onMove(minR));
        if (potR && potR.amount !== minR.amount && potR.amount !== maxR.amount) {
          addBtn('Pot ' + potR.amount, '', () => opts.onMove(potR));
        }
        addBtn('All-in ' + maxR.amount, 'pkr-call', () => opts.onMove(maxR));
        const range = document.createElement('input');
        range.type = 'range';
        range.className = 'pkr-raise-range';
        range.min = String(minR.amount);
        range.max = String(maxR.amount);
        range.step = '1';
        const defVal = Math.max(minR.amount, Math.min(view.pot, maxR.amount));
        range.value = String(defVal);
        bar.appendChild(range);
        const raiseBtn = document.createElement('button');
        raiseBtn.className = 'btn pkr-call pkr-raise-btn';
        raiseBtn.textContent = 'Raise to ' + defVal;
        range.addEventListener('input', () => {
          const v = parseInt(range.value, 10);
          if (!Number.isNaN(v)) raiseBtn.textContent = 'Raise to ' + v;
        });
        raiseBtn.addEventListener('click', () => {
          let v = parseInt(range.value, 10);
          if (Number.isNaN(v)) v = defVal;
          v = Math.max(minR.amount, Math.min(v, maxR.amount));
          const m = raises.find((r) => r.amount === v);
          if (m) opts.onMove(m);
        });
        bar.appendChild(raiseBtn);
      }
    }
    return bar;
  }

  /* One-shot deal animations: same closure-key guard as UNO — each area only
     re-animates when its contents actually changed (a new board card, the
     hole deal, the reveal, a bet chip, the pot). Everything else gets
     .pkr-still (animation:none), so re-renders never replay the stagger. */
  let lastBoardKey = '', lastHoleKey = '', lastRevealKey = '';
  let lastBoardLen = 0, lastPotKey = '', lastBets = null;
  let lastPhaseKey = '', lastFolded = null;
  let lastStackCnt = null; // per-seat chip count — piles re-drop only when the size changes
  let lastPotCnt = -1;     // pot chip count — pot pile re-drops when it grows/shrinks
  let lastAllIn = null;    // per-seat all-in flag — allin FX fires only on the rising edge

  function motionOff() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function canFly() {
    if (typeof window.requestAnimationFrame !== 'function') return false;
    if (motionOff()) return false;
    return typeof document.createElement('div').getBoundingClientRect === 'function';
  }

  /* Chip piles: deterministic count + color from stack size (no randomness in
     render paths). Same thresholds for count and color, so a color change
     always coincides with a count change. */
  function chipCount(n) {
    if (n <= 0) return 0;
    if (n >= 180) return 6;
    if (n >= 120) return 5;
    if (n >= 70) return 4;
    if (n >= 35) return 3;
    if (n >= 12) return 2;
    return 1;
  }

  function stackColor(n) {
    if (n >= 180) return '#c29330'; // gold
    if (n >= 120) return '#2e5f8a'; // blue
    if (n >= 70) return '#a34433';  // red
    if (n >= 35) return '#16683f';  // green
    return '#efece2';               // white
  }

  function chipEl(color, cls) {
    const c = document.createElement('span');
    c.className = 'pkr-chip' + (cls ? ' ' + cls : '');
    if (c.style && c.style.setProperty) c.style.setProperty('--chip', color);
    return c;
  }

  /* ghost card for in-flight cards — a small face that travels, then fades */
  function flyCardEl(card) {
    const rank = card[0], suit = card[1];
    const g = document.createElement('span');
    g.className = 'pkr-flycard' + (suit === 'h' || suit === 'd' ? ' pkr-red' : '');
    const t = document.createElement('span');
    t.className = 'fc-mid';
    t.textContent = rank + SYM[suit];
    g.appendChild(t);
    return g;
  }

  function blindTag(i, view) {
    if (view.phase !== 'preflop') return '';
    const sb = view.n === 2 ? view.dealer : (view.dealer + 1) % view.n;
    if (i === sb) return 'SB';
    if (i === (sb + 1) % view.n) return 'BB';
    return '';
  }

  function seatEl(view, i, opts, flags) {
    const mySeat = parseInt(opts.mySide, 10);
    const p = view.players[i];
    const isMe = i === mySeat;
    const winner = !!view.result && view.result.winners.some((w) => w.seat === i);
    const reveal = view.result && view.result.revealed
      ? view.result.revealed.find((r) => r.seat === i)
      : null;
    const s = document.createElement('div');
    const cls = ['pkr-seat'];
    if (isMe) cls.push('me');
    if (!view.result && String(view.turn) === String(i)) cls.push('active');
    if (p.folded) cls.push('folded');
    if (winner) cls.push('winner');
    if (winner && flags.revealChanged) cls.push('win-pop');
    s.className = cls.join(' ');

    const head = document.createElement('div');
    head.className = 'pkr-seat-head';
    const nm = document.createElement('span');
    nm.className = 'pkr-seat-name';
    nm.textContent = isMe ? 'You' : 'Player ' + (i + 1);
    head.appendChild(nm);
    if (view.dealer === i) {
      const d = document.createElement('span');
      d.className = 'pkr-dealer';
      d.textContent = 'D';
      head.appendChild(d);
    }
    const blind = blindTag(i, view);
    if (blind) {
      const bt = document.createElement('span');
      bt.className = 'pkr-blind';
      bt.textContent = blind;
      head.appendChild(bt);
    }
    s.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'pkr-seat-cards';
    if (isMe && p.hole && !p.folded) {
      p.hole.forEach((c, j) => {
        const ce = cardEl(c);
        if (!flags.holeChanged) ce.classList.add('pkr-still');
        if (j === 1 && ce.style && ce.style.setProperty) ce.style.setProperty('animation-delay', '.07s');
        cards.appendChild(ce);
      });
    } else if (reveal) {
      const rIdx = view.result.revealed.indexOf(reveal);
      reveal.hole.forEach((c, j) => {
        const ce = cardEl(c);
        ce.classList.add('small');
        if (flags.revealChanged) ce.classList.add('pkr-flip');
        else ce.classList.add('pkr-still');
        if (ce.style && ce.style.setProperty) {
          ce.style.setProperty('animation-delay', (rIdx * .09 + j * .05) + 's');
        }
        cards.appendChild(ce);
      });
    } else {
      const foldNew = !!(lastFolded && lastFolded[i] !== p.folded);
      for (let j = 0; j < 2; j++) {
        const b = document.createElement('div');
        b.className = 'card-back small' + (p.folded ? ' pkr-dim' : '') + (foldNew && p.folded ? ' pkr-foldbeat' : '');
        cards.appendChild(b);
      }
    }
    s.appendChild(cards);

    const meta = document.createElement('div');
    meta.className = 'pkr-seat-meta';
    const cnt = flags.stackCnt || 0;
    if (cnt > 0) {
      const pile = document.createElement('span');
      pile.className = 'pkr-pile' + (flags.stackChanged ? ' pkr-pile-in' : ' pkr-still');
      const col = stackColor(p.stack);
      for (let k = 0; k < cnt; k++) {
        const ch = chipEl(col);
        if (flags.stackChanged && ch.style && ch.style.setProperty) {
          ch.style.setProperty('animation-delay', ((cnt - 1 - k) * .045) + 's');
        }
        pile.appendChild(ch);
      }
      meta.appendChild(pile);
    }
    const stack = document.createElement('span');
    stack.className = 'pkr-stack';
    stack.textContent = p.stack;
    meta.appendChild(stack);
    if (p.bet > 0) {
      const betSame = !!(lastBets && lastBets[i] === p.bet);
      const chip = document.createElement('span');
      chip.className = 'pkr-bet' + (betSame ? ' pkr-still' : '');
      const bp = document.createElement('span');
      bp.className = 'pkr-pile pkr-pile-mini' + (betSame ? ' pkr-still' : ' pkr-pile-in');
      const bcnt = p.bet >= 90 ? 3 : p.bet >= 35 ? 2 : 1;
      for (let k = 0; k < bcnt; k++) {
        const ch = chipEl('#a34433', 'mini');
        if (!betSame && ch.style && ch.style.setProperty) {
          ch.style.setProperty('animation-delay', ((bcnt - 1 - k) * .04) + 's');
        }
        bp.appendChild(ch);
      }
      chip.appendChild(bp);
      chip.appendChild(document.createTextNode(String(p.bet)));
      meta.appendChild(chip);
    }
    if (p.folded) {
      const t = document.createElement('span');
      t.className = 'pkr-tag';
      t.textContent = 'folded';
      meta.appendChild(t);
    } else if (p.allIn) {
      const t = document.createElement('span');
      t.className = 'pkr-tag';
      t.textContent = 'all-in';
      meta.appendChild(t);
    }
    if (winner) {
      const t = document.createElement('span');
      t.className = 'pkr-tag pkr-win';
      t.textContent = 'wins';
      meta.appendChild(t);
    }
    s.appendChild(meta);
    return s;
  }

  function render(view, el, opts) {
    const mySeat = parseInt(opts.mySide, 10);
    const over = !!view.result;

    /* FX event diff — computed unconditionally (independent of the canFly()
       flight gates below) so the pump still gets fresh events under the
       click-test stub and reduced motion. */
    const fx = [];
    const handStart = view.phase === 'preflop' && (lastPhaseKey === '' || lastPhaseKey !== 'preflop');
    const betPaidArr = lastBets ? view.players.map((p, i) => p.bet - lastBets[i]) : null;

    const ckey = (c) => c[0] + c[1];
    const me = view.players[mySeat];
    const boardKey = view.board.map(ckey).join(',');
    const holeKey = (me && me.hole && !me.folded) ? me.hole.map(ckey).join(',') : '';
    const revealKey = (over && view.result.revealed)
      ? view.result.revealed.map((r) => String(r.seat) + r.hole.map(ckey).join('')).join('|')
      : '';
    const boardChanged = boardKey !== lastBoardKey;
    const holeChanged = holeKey !== lastHoleKey;
    const revealChanged = revealKey !== lastRevealKey;
    const potKey = String(view.pot);
    const betsArr = view.players.map((p) => p.bet);
    const foldedArr = view.players.map((p) => p.folded);
    const stackCntArr = view.players.map((p) => chipCount(p.stack));
    const potCnt = chipCount(view.pot);
    const flights = canFly()
      ? view.players.map((p, i) => ({ i: i, paid: p.bet - (lastBets ? lastBets[i] : 0) })).filter((f) => f.paid > 0)
      : [];

    el.innerHTML = '';

    const table = document.createElement('div');
    table.className = 'pkr-table';
    const seatEls = new Array(view.n);

    const felt = document.createElement('div');
    felt.className = 'pkr-felt';
    table.appendChild(felt);
    if (handStart) fx.push({ t: 'deal', el: felt }); // new hand: blinds posted, hole cards dealt

    const mid = document.createElement('div');
    mid.className = 'pkr-mid';

    const phaseEl = document.createElement('div');
    phaseEl.className = 'pkr-phase' + (view.phase !== lastPhaseKey ? '' : ' pkr-still');
    phaseEl.textContent = view.phase === 'preflop' ? 'Preflop'
      : view.phase === 'over' ? 'Result'
        : view.phase.charAt(0).toUpperCase() + view.phase.slice(1);
    mid.appendChild(phaseEl);

    if (over) {
      const res = document.createElement('div');
      res.className = 'pkr-result' + (revealChanged ? '' : ' pkr-still');
      res.textContent = outcome(view).text;
      mid.appendChild(res);
    }

    const board = document.createElement('div');
    board.className = 'pkr-board';
    const newLen = view.board.length;
    const dealAll = !boardChanged || newLen <= lastBoardLen;
    for (let i = 0; i < 5; i++) {
      if (i < newLen) {
        const ce = cardEl(view.board[i]);
        if (boardChanged && !dealAll && i >= lastBoardLen) {
          ce.classList.add('pkr-flip');
          if (ce.style && ce.style.setProperty) {
            ce.style.setProperty('animation-delay', ((i - lastBoardLen) * .07) + 's');
          }
        } else if (!boardChanged) {
          ce.classList.add('pkr-still');
        }
        board.appendChild(ce);
      } else {
        const e = document.createElement('div');
        e.className = 'card-face pkr-empty';
        board.appendChild(e);
      }
    }
    mid.appendChild(board);
    if (!handStart && lastPhaseKey !== '' && view.phase !== lastPhaseKey && view.phase !== 'over') {
      fx.push({ t: 'phase', el: board }); // street change: flop / turn / river cards land
    }
    if (view.phase === 'over' && lastPhaseKey !== 'over') {
      fx.push({ t: 'showdown', el: board }); // silent sweep over the revealed table
    }
    const pot = document.createElement('div');
    pot.className = 'pkr-pot';
    const potPile = document.createElement('div');
    potPile.className = 'pkr-potpile pkr-pile'
      + (potKey !== lastPotKey ? ' pkr-pot-pop' : '')
      + (potCnt !== lastPotCnt ? ' pkr-pile-in' : ' pkr-still');
    if (view.pot > 0) {
      for (let k = 0; k < potCnt; k++) {
        const ch = chipEl('#c29330', 'big');
        if (potCnt !== lastPotCnt && ch.style && ch.style.setProperty) {
          ch.style.setProperty('animation-delay', ((potCnt - 1 - k) * .045) + 's');
        }
        potPile.appendChild(ch);
      }
    } else {
      const ring = document.createElement('span');
      ring.className = 'pkr-pot-empty';
      potPile.appendChild(ring);
    }
    pot.appendChild(potPile);
    const num = document.createElement('span');
    num.className = 'pkr-pot-num';
    num.textContent = view.pot;
    pot.appendChild(num);
    const plbl = document.createElement('span');
    plbl.className = 'pkr-pot-lbl';
    plbl.textContent = 'pot';
    pot.appendChild(plbl);
    mid.appendChild(pot);

    /* the deck sits on the felt's lower-left — board cards fly from it */
    const deck = document.createElement('div');
    deck.className = 'pkr-deck';
    for (let k = 0; k < 3; k++) {
      const b = document.createElement('div');
      b.className = 'card-back pkr-deckcard';
      deck.appendChild(b);
    }
    felt.appendChild(deck);
    table.appendChild(mid);

    /* seats ring the table, keyed by offset from my seat so the layout stays
       stable whatever seat I sit in: 0 = me (bottom), then clockwise
       1 = left, 2 = top, 3 = right. */
    for (let i = 0; i < view.n; i++) {
      const off = (i - mySeat + view.n * 4) % view.n;
      const pos = document.createElement('div');
      pos.className = 'pkr-pos pkr-pos' + off;
      const se = seatEl(view, i, opts, { holeChanged, revealChanged, stackCnt: stackCntArr[i], stackChanged: !(lastStackCnt && lastStackCnt[i] === stackCntArr[i]) });
      seatEls[i] = pos;
      if (lastFolded && foldedArr[i] && !lastFolded[i]) fx.push({ t: 'fold', el: pos }); // fold just happened
      if (!handStart && betPaidArr && betPaidArr[i] > 0) fx.push({ t: 'bet', el: pos }); // chips left the stack
      if (!handStart && view.players[i].allIn && !(lastAllIn && lastAllIn[i])) fx.push({ t: 'allin', el: pos });
      pos.appendChild(se);
      table.appendChild(pos);
    }
    el.appendChild(table);

    /* --- chip flight: chips paid this render fly from the paying seat into the pot --- */
    if (flights.length) {
      const tr = table.getBoundingClientRect();
      const dr = potPile.getBoundingClientRect();
      for (const f of flights) {
        const sr = seatEls[f.i].getBoundingClientRect();
        const ch = document.createElement('span');
        ch.className = 'pkr-fly';
        ch.textContent = String(f.paid);
        ch.style.left = (sr.left + sr.width / 2 - tr.left) + 'px';
        ch.style.top = (sr.top + sr.height / 2 - tr.top) + 'px';
        table.appendChild(ch);
        const dx = dr.left + dr.width / 2 - (sr.left + sr.width / 2);
        const dy = dr.top + dr.height / 2 - (sr.top + sr.height / 2);
        requestAnimationFrame(() => {
          ch.style.transition = 'transform .45s var(--ease-out), opacity .4s ease-out .12s';
          ch.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.45)';
          ch.style.opacity = '0';
          setTimeout(() => { if (ch.parentNode) ch.parentNode.removeChild(ch); }, 560);
        });
      }
    }

    /* --- card flights: board cards fly deck -> slot; on the reveal, exposed
       hole cards fly from their seats into the middle. Same feature gate as
       the chip flight; the ghosts ride above the felt and fade out on land. --- */
    function flyCard(src, dst, node, delay, dur) {
      const tr = table.getBoundingClientRect();
      node.style.left = (src.left + src.width / 2 - tr.left) + 'px';
      node.style.top = (src.top + src.height / 2 - tr.top) + 'px';
      table.appendChild(node);
      const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
      const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
      setTimeout(() => {
        requestAnimationFrame(() => {
          node.style.transition = 'transform ' + dur + 's var(--ease-out), opacity .18s ease-out ' + (dur - .2) + 's';
          node.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.8)';
          node.style.opacity = '0';
        });
      }, delay * 1000);
      setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, (delay + dur + .35) * 1000);
    }
    if (canFly() && boardChanged && !dealAll) {
      const deckRect = deck.getBoundingClientRect();
      for (let i = lastBoardLen; i < newLen; i++) {
        flyCard(deckRect, board.children[i].getBoundingClientRect(), flyCardEl(view.board[i]), (i - lastBoardLen) * .07, .36);
      }
    }
    if (canFly() && revealChanged && over && view.result.revealed.length) {
      const dstRect = board.getBoundingClientRect();
      view.result.revealed.forEach((r, rIdx) => {
        const srcRect = seatEls[r.seat].getBoundingClientRect();
        r.hole.forEach((c, j) => {
          flyCard(srcRect, dstRect, flyCardEl(c), rIdx * .09 + j * .05, .42);
        });
      });
    }

    if (opts.interactive && !over && String(view.turn) === String(mySeat)) {
      el.appendChild(actionBar(view, opts));
    }

    el.__events = fx; // fresh array every render, even empty (pumpEvents contract)
    lastBoardKey = boardKey; lastHoleKey = holeKey; lastRevealKey = revealKey;
    lastBoardLen = newLen; lastPotKey = potKey; lastBets = betsArr;
    lastPhaseKey = view.phase; lastFolded = foldedArr;
    lastStackCnt = stackCntArr; lastPotCnt = potCnt;
    lastAllIn = view.players.map((p) => p.allIn);
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    for (let i = 0; i < view.n; i++) {
      const p = view.players[i];
      const row = document.createElement('div');
      row.className = 'player-row' + (!view.result && String(view.turn) === String(i) ? ' active' : '');
      const name = document.createElement('div');
      name.className = 'pr-name';
      let label = String(i) === String(opts.mySide) ? 'You — Player ' + (i + 1) : 'Player ' + (i + 1);
      if (view.dealer === i) label += ' (D)';
      name.textContent = label;
      const meta = document.createElement('div');
      meta.className = 'pr-meta';
      const parts = [p.stack + ' chips'];
      if (p.folded) parts.push('folded');
      else {
        if (p.allIn) parts.push('all-in');
        if (p.bet > 0) parts.push('bet ' + p.bet);
      }
      meta.textContent = parts.join(' · ');
      row.appendChild(name);
      row.appendChild(meta);
      el.appendChild(row);
    }
  }

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['poker'] = global.PARLOR['poker'] || {};
  global.PARLOR['poker'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);

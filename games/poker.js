(function (global) {
  'use strict';
  /* Texas Hold'em — pure logic (Node-testable) + DOM render.
   * Card: [rank, suit] — rank '2'..'10','J','Q','K','A'; suit 's','h','d','c'.
   * Move: {type:'fold',actor} | {type:'check',actor} | {type:'call',actor,paid}
   *       | {type:'raise',actor,amount,paid,firstBet}
   * actor = seat string '0'..'3'; amount = new total bet; paid = chips added this action.
   * Host-authoritative: applyMove mutates state; viewFor hides other hole cards and the deck.
   * 2 configs -> heads-up (dealer posts SB); 4 configs -> table of four.
   */

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['s', 'h', 'd', 'c'];
  const RANK = {};
  RANKS.forEach((r, i) => { RANK[r] = i + 2; });
  const SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const HAND_NAMES = ['high card', 'one pair', 'two pair', 'three of a kind', 'straight',
    'flush', 'full house', 'four of a kind', 'straight flush'];
  const SB = 10, BB = 20, START = 200;

  /* ---------- deck / state ---------- */

  function buildDeck() {
    const d = [];
    for (const r of RANKS) for (const s of SUITS) d.push([r, s]);
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  function dealHole(st) {
    for (let i = 0; i < st.n; i++) st.players[i].hole = [st.deck.shift(), st.deck.shift()];
  }

  function post(st, seat, amt) {
    const p = st.players[seat];
    const pay = Math.min(amt, p.stack);
    p.stack -= pay; p.bet += pay; p.totalBet += pay; st.pot += pay;
    if (p.stack === 0) p.allIn = true;
  }

  function postBlinds(st) {
    const sbSeat = st.n === 2 ? st.dealer : (st.dealer + 1) % st.n;
    const bbSeat = (sbSeat + 1) % st.n;
    post(st, sbSeat, SB);
    post(st, bbSeat, BB);
    st.lastBet = BB;
    st.minRaise = BB;
    st.players[sbSeat].acted = false;
    st.players[bbSeat].acted = false;
  }

  function firstActor(st) {
    // Heads-up the dealer (button) acts first on every street.
    // Table of four: preflop UTG = (dealer+3)%n, postflop (dealer+1)%n.
    let seat;
    if (st.n === 2) seat = st.dealer;
    else if (st.phase === 'preflop') seat = (st.dealer + 3) % st.n;
    else seat = (st.dealer + 1) % st.n;
    return nextActorFrom(st, seat);
  }

  function nextActorFrom(st, from) {
    for (let k = 0; k < st.n; k++) {
      const i = (from + k) % st.n;
      const p = st.players[i];
      if (!p.folded && !p.allIn) return i;
    }
    return null;
  }

  function newState(configs) {
    const n = (configs && configs.length === 4) ? 4 : 2;
    const st = {
      n: n, dealer: 0, turn: null, phase: 'preflop',
      board: [], deck: buildDeck(), pot: 0,
      lastBet: BB, minRaise: BB,
      acted: new Array(n).fill(false),
      players: [], result: null
    };
    for (let i = 0; i < n; i++) {
      st.players.push({ stack: START, bet: 0, totalBet: 0, folded: false, allIn: false, hole: [] });
    }
    dealHole(st);
    postBlinds(st);
    st.turn = firstActor(st);
    return st;
  }

  function nextHand(st) {
    st.dealer = (st.dealer + 1) % st.n;
    for (const p of st.players) {
      if (p.stack < BB) p.stack = START; // broke players re-buy
      p.bet = 0; p.totalBet = 0; p.folded = false; p.allIn = false;
    }
    st.board = [];
    st.deck = buildDeck();
    st.pot = 0;
    st.lastBet = BB;
    st.minRaise = BB;
    st.acted = new Array(st.n).fill(false);
    st.result = null;
    st.phase = 'preflop';
    dealHole(st);
    postBlinds(st);
    st.turn = firstActor(st);
  }

  /* ---------- rules ---------- */

  function currentSide(st) {
    if (!st || st.result || st.phase === 'over' || st.turn == null) return null;
    return String(st.turn);
  }

  function legalMoves(st, side) {
    const seat = parseInt(side, 10);
    if (!st || st.result || st.phase === 'over' || st.turn !== seat) return [];
    const p = st.players[seat];
    if (!p || p.folded || p.allIn) return [];
    const moves = [{ type: 'fold', actor: side }];
    const toCall = st.lastBet - p.bet;
    if (toCall <= 0) {
      moves.push({ type: 'check', actor: side });
    } else {
      moves.push({ type: 'call', actor: side, paid: Math.min(toCall, p.stack) });
    }
    const maxTotal = p.bet + p.stack;
    const minTotal = Math.max(toCall + st.minRaise, st.lastBet + st.minRaise);
    if (maxTotal >= minTotal) {
      for (let amount = minTotal; amount <= maxTotal; amount++) {
        moves.push({ type: 'raise', actor: side, amount: amount, paid: amount - p.bet, firstBet: st.lastBet === 0 });
      }
    }
    return moves;
  }

  function applyMove(st, move) {
    const seat = parseInt(move.actor, 10);
    const p = st.players[seat];
    if (move.type === 'fold') {
      p.folded = true;
    } else if (move.type === 'check') {
      p.acted = true;
    } else if (move.type === 'call') {
      const pay = Math.min(move.paid, p.stack);
      p.stack -= pay; p.bet += pay; p.totalBet += pay; st.pot += pay;
      if (p.stack === 0) p.allIn = true;
      p.acted = true;
    } else if (move.type === 'raise') {
      const pay = Math.min(move.paid, p.stack);
      p.stack -= pay; p.bet += pay; p.totalBet += pay; st.pot += pay;
      if (p.stack === 0) p.allIn = true;
      st.minRaise = Math.max(st.minRaise, move.amount - st.lastBet);
      st.lastBet = Math.max(st.lastBet, move.amount);
      p.acted = true;
      for (let i = 0; i < st.n; i++) {
        if (i !== seat && !st.players[i].folded && !st.players[i].allIn) st.players[i].acted = false;
      }
    }
    endAction(st);
  }

  // Called after each action: advance the turn, or settle the betting round.
  function endAction(st) {
    const remaining = [];
    for (let i = 0; i < st.n; i++) if (!st.players[i].folded) remaining.push(i);

    const done = remaining.every((i) => {
      const q = st.players[i];
      return q.allIn || (q.acted && q.bet === st.lastBet);
    });

    if (!done) {
      st.turn = nextActorFrom(st, st.turn + 1);
      return;
    }

    // street bets are already in the pot; reset for the next street
    for (const p of st.players) p.bet = 0;

    if (remaining.length === 1) {
      const w = st.players[remaining[0]];
      w.stack += st.pot;
      st.result = { winners: [{ seat: remaining[0], amount: st.pot }], handName: null, revealed: [] };
      st.pot = 0;
      st.phase = 'over';
      st.turn = null;
      return;
    }

    if (remaining.every((i) => st.players[i].allIn) || st.phase === 'river') {
      showdown(st);
      return;
    }

    if (st.phase === 'preflop') { st.phase = 'flop'; st.board.push(st.deck.shift(), st.deck.shift(), st.deck.shift()); }
    else if (st.phase === 'flop') { st.phase = 'turn'; st.board.push(st.deck.shift()); }
    else if (st.phase === 'turn') { st.phase = 'river'; st.board.push(st.deck.shift()); }
    st.lastBet = 0;
    st.minRaise = BB;
    st.acted = new Array(st.n).fill(false);
    st.turn = firstActor(st);
  }

  function showdown(st) {
    while (st.board.length < 5) st.board.push(st.deck.shift()); // run the board out

    const hands = [];
    const nonFold = [];
    for (let i = 0; i < st.n; i++) {
      const p = st.players[i];
      if (p.folded) { hands.push(null); continue; }
      nonFold.push(i);
      hands.push(bestHand(p.hole.concat(st.board)));
    }

    // side pots: one per distinct total-bet level among non-folders
    const levels = [];
    nonFold.forEach((i) => {
      const tb = st.players[i].totalBet;
      if (levels.indexOf(tb) === -1) levels.push(tb);
    });
    levels.sort((a, b) => a - b);

    const amounts = new Array(st.n).fill(0);
    let prev = 0;
    for (const level of levels) {
      let amt = 0;
      for (let i = 0; i < st.n; i++) {
        amt += Math.min(st.players[i].totalBet, level) - Math.min(st.players[i].totalBet, prev);
      }
      const eligible = nonFold.filter((i) => st.players[i].totalBet >= level);
      let best = -1;
      eligible.forEach((i) => { if (hands[i].score > best) best = hands[i].score; });
      const winners = eligible.filter((i) => hands[i].score === best);
      const share = Math.floor(amt / winners.length);
      let rem = amt - share * winners.length;
      for (const i of winners) {
        amounts[i] += share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
      prev = level;
    }

    const winnersOut = [];
    for (let i = 0; i < st.n; i++) {
      if (amounts[i] > 0) {
        st.players[i].stack += amounts[i];
        winnersOut.push({ seat: i, amount: amounts[i] });
      }
    }

    let bestScore = -1, bestCat = 0;
    for (const i of nonFold) {
      if (hands[i].score > bestScore) { bestScore = hands[i].score; bestCat = hands[i].cat; }
    }

    st.result = {
      winners: winnersOut,
      handName: HAND_NAMES[bestCat],
      revealed: nonFold.map((i) => ({ seat: i, hole: st.players[i].hole }))
    };
    st.pot = 0;
    st.phase = 'over';
    st.turn = null;
  }

  function outcome(st) {
    if (!st || !st.result) return { over: false };
    const parts = st.result.winners.map((w) => sideName(String(w.seat)) + ' wins ' + w.amount + ' chips');
    let text = parts.join('; ');
    if (st.result.handName) text += ' — ' + st.result.handName + (parts.length > 1 ? ' (split pot)' : '');
    return { over: true, text: text };
  }

  function sideName(side) { return 'Player ' + (parseInt(side, 10) + 1); }

  /* ---------- hand evaluation ---------- */

  function eval5(cards) {
    const vals = [];
    const suit = cards[0][1];
    let flush = true;
    for (const c of cards) {
      vals.push(RANK[c[0]]);
      if (c[1] !== suit) flush = false;
    }
    vals.sort((a, b) => b - a);
    let straightHigh = 0;
    const uniq = vals.filter((v, i) => i === 0 || vals[i - 1] !== v);
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) straightHigh = 5; // wheel
    }
    const freq = {};
    for (const v of vals) freq[v] = (freq[v] || 0) + 1;
    const groups = Object.keys(freq).map((v) => ({ v: Number(v), n: freq[v] }))
      .sort((a, b) => b.n - a.n || b.v - a.v);
    let cat, tie;
    if (flush && straightHigh) { cat = 8; tie = [straightHigh]; }
    else if (groups[0].n === 4) { cat = 7; tie = [groups[0].v, groups[1].v]; }
    else if (groups[0].n === 3 && groups[1].n === 2) { cat = 6; tie = [groups[0].v, groups[1].v]; }
    else if (flush) { cat = 5; tie = vals; }
    else if (straightHigh) { cat = 4; tie = [straightHigh]; }
    else if (groups[0].n === 3) { cat = 3; tie = [groups[0].v, groups[1].v, groups[2].v]; }
    else if (groups[0].n === 2 && groups[1].n === 2) { cat = 2; tie = [groups[0].v, groups[1].v, groups[2].v]; }
    else if (groups[0].n === 2) { cat = 1; tie = [groups[0].v, groups[1].v, groups[2].v, groups[3].v]; }
    else { cat = 0; tie = vals; }
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (tie[i] || 0);
    return { score: score, cat: cat };
  }

  function bestHand(cards) {
    let best = { score: -1, cat: 0 };
    const n = cards.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) {
              const r = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (r.score > best.score) best = r;
            }
    return best;
  }

  /* ---------- AI ---------- */

  function handStrength(st, seat) {
    const p = st.players[seat];
    if (st.board.length === 0) {
      const a = RANK[p.hole[0][0]], b = RANK[p.hole[1][0]];
      const hi = Math.max(a, b), lo = Math.min(a, b);
      const suited = p.hole[0][1] === p.hole[1][1];
      let s;
      if (a === b) s = 0.5 + 0.028 * a; // 22 ~ 0.56 … AA ~ 0.89
      else {
        s = 0.22 + 0.022 * hi + 0.012 * lo + (suited ? 0.07 : 0);
        if (hi === 14 && lo >= 10) s += 0.04;
        if (hi - lo > 3 && !suited) s -= 0.05;
      }
      return Math.max(0.05, Math.min(0.92, s));
    }
    const best = bestHand(p.hole.concat(st.board));
    return [0.08, 0.34, 0.46, 0.58, 0.68, 0.78, 0.88, 0.95, 0.99][best.cat];
  }

  function aiMove(st, side) {
    const seat = parseInt(side, 10);
    const p = st.players[seat];
    const moves = legalMoves(st, side);
    const toCall = st.lastBet - p.bet;
    const strength = handStrength(st, seat);
    const raises = moves.filter((m) => m.type === 'raise');

    let choice = null;
    if (toCall > 0) {
      const potOdds = toCall / (st.pot + toCall);
      if (strength >= 0.62 && raises.length > 0 && (toCall < p.stack * 0.5 || strength >= 0.8) && Math.random() < 0.75) {
        const want = Math.min(toCall + st.pot, raises[raises.length - 1].amount);
        choice = raises[0];
        for (const m of raises) if (Math.abs(m.amount - want) < Math.abs(choice.amount - want)) choice = m;
      } else if (strength > potOdds + 0.12 || (toCall <= BB && (strength >= 0.28 || Math.random() < 0.15))) {
        choice = moves.find((m) => m.type === 'call');
      } else {
        choice = moves.find((m) => m.type === 'fold');
      }
    } else {
      if (strength >= 0.58 && raises.length > 0 && Math.random() < 0.8) {
        const want = Math.min(st.pot, raises[raises.length - 1].amount);
        choice = raises[0];
        for (const m of raises) if (Math.abs(m.amount - want) < Math.abs(choice.amount - want)) choice = m;
      } else if (raises.length > 0 && Math.random() < 0.07) {
        choice = raises[0]; // occasional bluff
      } else {
        choice = moves.find((m) => m.type === 'check');
      }
    }

    // guarantee a legal move no matter what
    const ok = choice && moves.some((m) => canonStr(m) === canonStr(choice));
    return ok ? choice : (moves.find((m) => m.type === 'check') || moves[0]);
  }

  function canonStr(x) {
    return JSON.stringify(Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {}));
  }

  /* ---------- views / description ---------- */

  function viewFor(st, side) {
    const v = JSON.parse(JSON.stringify(st));
    v.deck = [];
    for (let i = 0; i < v.n; i++) {
      if (String(i) !== String(side)) v.players[i].hole = null;
    }
    return v;
  }

  function describeMove(st, move) {
    const name = sideName(move.actor);
    const p = st.players[parseInt(move.actor, 10)];
    const allIn = (p && p.stack === 0 && move.type !== 'fold') ? ' (all-in)' : '';
    if (move.type === 'fold') return name + ' folds';
    if (move.type === 'check') return name + ' checks';
    if (move.type === 'call') return name + ' calls ' + move.paid + allIn;
    if (move.firstBet) return name + ' bets ' + move.amount + allIn;
    return name + ' raises to ' + move.amount + allIn;
  }

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

    addBtn('Fold', 'pkr-fold', () => opts.onMove(fold));
    if (check) addBtn('Check', '', () => opts.onMove(check));
    if (call) addBtn('Call ' + call.paid, 'pkr-call', () => opts.onMove(call));
    if (raises.length > 0) {
      const minR = raises[0];
      const maxR = raises[raises.length - 1];
      const potR = raises.find((m) => m.amount >= view.pot);
      addBtn('Min ' + minR.amount, '', () => opts.onMove(minR));
      if (potR && potR.amount !== minR.amount && potR.amount !== maxR.amount) {
        addBtn('Pot ' + potR.amount, '', () => opts.onMove(potR));
      }
      addBtn('All-in ' + maxR.amount, 'pkr-call', () => opts.onMove(maxR));
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'pkr-raise-input';
      input.min = String(minR.amount);
      input.max = String(maxR.amount);
      input.value = String(Math.min(view.pot, maxR.amount));
      bar.appendChild(input);
      addBtn('Raise', 'pkr-call', () => {
        const v = parseInt(input.value, 10);
        const m = raises.find((r) => r.amount === v);
        if (m) opts.onMove(m);
      });
    }
    return bar;
  }

  /* One-shot deal animations: same closure-key guard as UNO — each area only
     re-animates when its contents actually changed (a new board card, the
     hole deal, the reveal). Everything else gets .still (animation:none),
     so re-renders never replay the card-deal stagger. */
  let lastBoardKey = '', lastHoleKey = '', lastRevealKey = '';

  function render(view, el, opts) {
    const mySeat = parseInt(opts.mySide, 10);
    const over = !!view.result;

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

    el.innerHTML = '';

    const board = document.createElement('div');
    board.className = 'pkr-board' + (boardChanged ? '' : ' still');
    for (let i = 0; i < 5; i++) {
      if (i < view.board.length) board.appendChild(cardEl(view.board[i]));
      else {
        const e = document.createElement('div');
        e.className = 'card-face pkr-empty';
        board.appendChild(e);
      }
    }
    el.appendChild(board);

    const pot = document.createElement('div');
    pot.className = 'pkr-pot';
    pot.textContent = 'Pot: ' + view.pot;
    el.appendChild(pot);

    if (me && me.hole && !me.folded) {
      const row = document.createElement('div');
      row.className = 'pkr-hole' + (holeChanged ? '' : ' still');
      me.hole.forEach((c) => row.appendChild(cardEl(c)));
      el.appendChild(row);
    }

    if (over && view.result.revealed) {
      const row = document.createElement('div');
      row.className = 'pkr-reveal' + (revealChanged ? '' : ' still');
      for (const r of view.result.revealed) {
        const lbl = document.createElement('span');
        lbl.className = 'pkr-reveal-lbl';
        lbl.textContent = sideName(String(r.seat)) + ': ';
        row.appendChild(lbl);
        r.hole.forEach((c) => row.appendChild(cardEl(c)));
      }
      el.appendChild(row);
    }

    if (opts.interactive && !over && String(view.turn) === String(mySeat)) {
      el.appendChild(actionBar(view, opts));
    }

    lastBoardKey = boardKey; lastHoleKey = holeKey; lastRevealKey = revealKey;
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

  /* ---------- css (pkr- prefix) ---------- */

  const css = [
    '.pkr-board{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:8px 0 14px}',
    '.pkr-empty{opacity:.3;border-style:dashed;background:#fbfaf7}',
    '.pkr-red .cf-corner,.pkr-red .cf-mid{color:#c0392b}',
    '.pkr-pot{text-align:center;font-weight:800;letter-spacing:.05em;margin-bottom:12px;color:#1c211e;font-size:15px}',
    '.pkr-hole{display:flex;gap:10px;justify-content:center;margin-bottom:14px}',
    '.pkr-reveal{display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap;margin:12px 0}',
    '.pkr-reveal-lbl{margin-left:14px;font-size:13px;font-weight:600;color:#79817a}',
    '.pkr-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;margin-top:16px;padding-top:14px;border-top:1px dashed #d3cdbd}',
    '.pkr-actions .btn{border-radius:10px}',
    '.pkr-fold{color:#c7513f;border-color:#e3c2ba}',
    '.pkr-call{color:#0a7a44;font-weight:800;border-color:#bfe3cf}',
    '.pkr-raise-input{width:78px;padding:8px 10px;border-radius:10px;border:1px solid #d3cdbd;background:#fbfaf7;color:inherit;font:inherit;text-align:center}',
    '.pkr-board .card-face:nth-child(2){animation-delay:.05s}',
    '.pkr-board .card-face:nth-child(3){animation-delay:.1s}',
    '.pkr-board .card-face:nth-child(4){animation-delay:.15s}',
    '.pkr-board .card-face:nth-child(5){animation-delay:.2s}',
    '.pkr-hole .card-face:nth-child(2){animation-delay:.06s}',
    '.pkr-board.still .card-face{animation:none}',
    '.pkr-hole.still .card-face{animation:none}',
    '.pkr-reveal.still .card-face{animation:none}'
  ].join('\n');

  const game = {
    id: 'poker',
    title: 'Poker',
    blurb: 'Texas Hold\'em: blinds, betting rounds, side pots, and showdown. Bluff if you dare.',
    sideList: ['0', '1', '2', '3'],
    pickSide: false,
    sideName,
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
    renderInfo,
    nextHand
  };

  global.Games = global.Games || {};
  global.Games['poker'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);

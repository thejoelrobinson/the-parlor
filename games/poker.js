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
    return bar;
  }

  /* One-shot deal animations: same closure-key guard as UNO — each area only
     re-animates when its contents actually changed (a new board card, the
     hole deal, the reveal, a bet chip, the pot). Everything else gets
     .pkr-still (animation:none), so re-renders never replay the stagger. */
  let lastBoardKey = '', lastHoleKey = '', lastRevealKey = '';
  let lastBoardLen = 0, lastPotKey = '', lastBets = null;

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
      for (let j = 0; j < 2; j++) {
        const b = document.createElement('div');
        b.className = 'card-back small' + (p.folded ? ' pkr-dim' : '');
        cards.appendChild(b);
      }
    }
    s.appendChild(cards);

    const meta = document.createElement('div');
    meta.className = 'pkr-seat-meta';
    const stack = document.createElement('span');
    stack.className = 'pkr-stack';
    stack.textContent = p.stack;
    meta.appendChild(stack);
    if (p.bet > 0) {
      const chip = document.createElement('span');
      chip.className = 'pkr-bet' + (lastBets && lastBets[i] === p.bet ? ' pkr-still' : '');
      chip.textContent = p.bet;
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

    el.innerHTML = '';

    const table = document.createElement('div');
    table.className = 'pkr-table';

    const oppRow = document.createElement('div');
    oppRow.className = 'pkr-seat-row';
    for (let i = 0; i < view.n; i++) {
      if (i !== mySeat) oppRow.appendChild(seatEl(view, i, opts, { holeChanged, revealChanged }));
    }
    table.appendChild(oppRow);

    const mid = document.createElement('div');
    mid.className = 'pkr-mid';

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

    const pot = document.createElement('div');
    pot.className = 'pkr-pot';
    const disc = document.createElement('span');
    disc.className = 'pkr-pot-disc' + (potKey !== lastPotKey ? ' pkr-pot-pop' : '');
    const num = document.createElement('span');
    num.className = 'pkr-pot-num';
    num.textContent = view.pot;
    disc.appendChild(num);
    pot.appendChild(disc);
    const plbl = document.createElement('span');
    plbl.className = 'pkr-pot-lbl';
    plbl.textContent = 'pot';
    pot.appendChild(plbl);
    mid.appendChild(pot);

    table.appendChild(mid);
    table.appendChild(seatEl(view, mySeat, opts, { holeChanged, revealChanged }));
    el.appendChild(table);

    if (opts.interactive && !over && String(view.turn) === String(mySeat)) {
      el.appendChild(actionBar(view, opts));
    }

    lastBoardKey = boardKey; lastHoleKey = holeKey; lastRevealKey = revealKey;
    lastBoardLen = newLen; lastPotKey = potKey; lastBets = betsArr;
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
    '.pkr-table{width:min(100%,660px);margin:0 auto;border-radius:26px;padding:16px 14px 18px;',
    'background:radial-gradient(130% 150% at 50% -10%, #1e6b43 0%, #16683f 48%, var(--green-deep) 100%);',
    'border:1px solid #c9c2ae;box-shadow:var(--shadow-md), inset 0 2px 14px rgba(0,0,0,.3)}',
    '.pkr-seat-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}',
    '.pkr-seat{background:var(--surface-soft);border:1px solid var(--hair-strong);border-radius:14px;',
    'padding:8px 10px;min-width:112px;text-align:center;box-shadow:var(--shadow-sm)}',
    '.pkr-seat.me{margin:0 auto}',
    '.pkr-seat.active{outline:2px solid #7fd6a4;outline-offset:1px;animation:turn-glow 1.6s ease-in-out infinite}',
    '.pkr-seat.folded{opacity:.55}',
    '.pkr-seat.winner{outline:2px solid var(--gold);outline-offset:1px}',
    '.pkr-seat-head{display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:6px;min-height:18px}',
    '.pkr-seat-name{font-size:12px;font-weight:700;color:var(--ink-soft);letter-spacing:.02em}',
    '.pkr-dealer{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;',
    'background:var(--gold);color:#fff;font-family:var(--font-display);font-size:11px;font-weight:700;',
    'box-shadow:0 1px 3px rgba(28,33,30,.25)}',
    '.pkr-blind{font-size:9px;font-weight:800;letter-spacing:.1em;color:#fff;background:rgba(0,0,0,.28);border-radius:6px;padding:1px 5px}',
    '.pkr-seat-cards{display:flex;gap:6px;justify-content:center;align-items:center;min-height:52px;perspective:600px}',
    '.pkr-seat.me .pkr-seat-cards{min-height:80px}',
    '.pkr-dim{opacity:.4}',
    '.pkr-seat-meta{display:flex;gap:6px;justify-content:center;align-items:center;margin-top:6px;min-height:18px}',
    '.pkr-stack{font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--ink)}',
    '.pkr-bet{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:18px;padding:0 6px;border-radius:9px;',
    'background:radial-gradient(120% 140% at 30% 20%, #d4a83f, #a87c15 78%);color:#fff;font-size:11px;font-weight:800;',
    'box-shadow:0 1px 3px rgba(28,33,30,.3), inset 0 0 0 1px rgba(255,255,255,.28);animation:chip-in .28s var(--ease-out) both}',
    '.pkr-tag{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}',
    '.pkr-tag.pkr-win{color:var(--gold);font-weight:800}',
    '.pkr-mid{display:flex;flex-direction:column;align-items:center;gap:10px;margin:14px 0}',
    '.pkr-board{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;perspective:600px}',
    '.pkr-empty{opacity:.25;border-style:dashed;background:rgba(255,255,255,.5)}',
    '.pkr-flip{animation:card-flip .42s var(--ease-spring) both;backface-visibility:hidden}',
    '.pkr-still{animation:none !important}',
    '.pkr-pot{display:flex;flex-direction:column;align-items:center;gap:3px}',
    '.pkr-pot-disc{display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;',
    'background:radial-gradient(120% 140% at 32% 22%, #d8ad4b, #a87c15 78%);',
    'box-shadow:0 2px 6px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.3), inset 0 0 0 5px rgba(120,85,15,.55)}',
    '.pkr-pot-num{color:#fff;font-family:var(--font-display);font-weight:700;font-size:14px;text-shadow:0 1px 2px rgba(90,60,5,.5)}',
    '.pkr-pot-lbl{font-size:9px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.75)}',
    '.pkr-pot-disc.pkr-pot-pop{animation:pot-pop .32s var(--ease-spring) both}',
    '.pkr-board .card-face:nth-child(2){animation-delay:.05s}',
    '.pkr-board .card-face:nth-child(3){animation-delay:.1s}',
    '.pkr-board .card-face:nth-child(4){animation-delay:.15s}',
    '.pkr-board .card-face:nth-child(5){animation-delay:.2s}',
    '.pkr-red .cf-corner,.pkr-red .cf-mid{color:#8e2f23}',
    '.pkr-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;margin-top:16px;',
    'padding-top:14px;border-top:1px dashed var(--hair-strong)}',
    '.pkr-actions .btn{border-radius:10px}',
    '.pkr-fold{color:var(--brick);border-color:#e3d0c9}',
    '.pkr-call{color:var(--green-deep);font-weight:700;border-color:#cfe0d3}',
    '.pkr-raise-range{width:130px;accent-color:var(--green);cursor:pointer}',
    '.pkr-raise-btn{min-width:104px}'
  ].join('\n');

  const game = {
    id: 'poker',
    title: 'Poker',
    blurb: 'Texas Hold\'em: blinds, betting rounds, side pots, and showdown. Bluff if you dare.',
    hint: 'Act when your seat glows: fold, check, call, or raise.',
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

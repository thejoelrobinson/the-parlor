/* games/poker/logic.js — Poker: pure game logic (no DOM; runs in Node). Split from games/poker.js. */
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
      p.bet = 0; p.totalBet = 0; p.folded = false; p.allIn = false; p.acted = false;
    }
    st.board = [];
    st.deck = buildDeck();
    st.pot = 0;
    st.lastBet = BB;
    st.minRaise = BB;
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
    const toCall = st.lastBet - p.bet;
    const moves = [];
    if (toCall > 0) moves.push({ type: 'fold', actor: side }); // fold only when facing a bet
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
    } else if (maxTotal > st.lastBet) {
      // Short all-in: the whole stack is below the minimum raise but above
      // the current bet. It is a legal all-in bet; applyMove's Math.max keeps
      // minRaise unchanged, so it does not open re-raises (standard rules).
      moves.push({ type: 'raise', actor: side, amount: maxTotal, paid: p.stack, firstBet: st.lastBet === 0 });
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

    // Everyone all-in, or only one player can still act (no one left to bet
    // against): the betting round cannot proceed — run the board out.
    const canAct = remaining.filter((i) => !st.players[i].allIn);
    if (canAct.length <= 1 || st.phase === 'river') {
      showdown(st);
      return;
    }

    if (st.phase === 'preflop') { st.phase = 'flop'; st.board.push(st.deck.shift(), st.deck.shift(), st.deck.shift()); }
    else if (st.phase === 'flop') { st.phase = 'turn'; st.board.push(st.deck.shift()); }
    else if (st.phase === 'turn') { st.phase = 'river'; st.board.push(st.deck.shift()); }
    st.lastBet = 0;
    st.minRaise = BB;
    for (const p of st.players) p.acted = false; // street changed: nobody has acted yet
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
    // Per the contract: null when the side has no legal move, which includes
    // being out of turn (legalMoves returns [] then). Callers must null-check.
    if (!st || st.result || st.phase === 'over' || st.turn !== seat) return null;
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

  const logic = {
    RANKS,
    SUITS,
    RANK,
    SYM,
    HAND_NAMES,
    SB,
    BB,
    START,
    buildDeck,
    dealHole,
    post,
    postBlinds,
    firstActor,
    nextActorFrom,
    newState,
    nextHand,
    currentSide,
    legalMoves,
    applyMove,
    endAction,
    showdown,
    outcome,
    sideName,
    eval5,
    bestHand,
    handStrength,
    aiMove,
    canonStr,
    viewFor,
    describeMove,
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['poker'] = global.PARLOR['poker'] || {};
  global.PARLOR['poker'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);

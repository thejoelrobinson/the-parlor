/* games/uno/logic.js — UNO: pure game logic (no DOM; runs in Node). Split from games/uno.js. */
(function (global) {
  'use strict';

  const SUITS = ['r', 'y', 'g', 'b'];
  const SUITNAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue', w: 'Wild' };
  const DIRNAME = { 1: '↻', '-1': '↺' };

  function label(c) {
    if (typeof c.v === 'number') return String(c.v);
    if (c.v === 'skip') return '⊘';
    if (c.v === 'rev') return '⇄';
    if (c.v === 'draw2') return '+2';
    if (c.v === 'wild') return 'W';
    if (c.v === 'wild4') return '+4';
    return '?';
  }
  const cardText = (c) => label(c) + (c.suit === 'w' ? '' : ' ' + SUITNAME[c.suit]);

  function buildDeck() {
    const d = [];
    for (const s of SUITS) {
      d.push({ suit: s, v: 0 });
      for (let v = 1; v <= 9; v++) { d.push({ suit: s, v: v }); d.push({ suit: s, v: v }); }
      d.push({ suit: s, v: 'skip' }, { suit: s, v: 'skip' });
      d.push({ suit: s, v: 'rev' }, { suit: s, v: 'rev' });
      d.push({ suit: s, v: 'draw2' }, { suit: s, v: 'draw2' });
    }
    for (let i = 0; i < 4; i++) {
      d.push({ suit: 'w', v: 'wild' });
      d.push({ suit: 'w', v: 'wild4' });
    }
    return d; // 108 cards
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function newState(configs) {
    const players = configs && configs.length ? configs.length : 4;
    const deck = shuffle(buildDeck());
    const hands = [];
    for (let s = 0; s < players; s++) {
      const h = [];
      for (let k = 0; k < 7; k++) h.push(deck.pop());
      hands.push(h);
    }
    let first = deck.pop();
    while (first.v === 'wild4') { deck.push(first); shuffle(deck); first = deck.pop(); }
    return {
      players: players,
      deck: deck,
      discard: [first],
      hands: hands,
      turn: 0,
      dir: 1,
      currentSuit: first.suit === 'w' ? 'r' : first.suit,
      drew: false,
      last: null
    };
  }

  const seat = (side) => { const n = parseInt(side, 10); return isNaN(n) ? null : n; };
  const nextSeat = (st, me) => (me + st.dir + st.players * 4) % st.players;

  function cardMatches(c, top, currentSuit) {
    if (c.suit === 'w') return true;
    if (c.suit === currentSuit) return true;
    return String(c.v) === String(top.v);
  }

  function canDrawNow(st) {
    if (st.deckCount !== undefined) return st.deckCount > 0 || st.discardCount > 1;
    return st.deck.length > 0 || st.discard.length > 1;
  }

  function legalMoves(state, side) {
    const me = seat(side);
    if (me === null || me >= state.hands.length) return [];
    if (state.turn !== me) return []; // out of turn: no moves for this seat
    const hand = state.hands[me];
    if (!hand || hand.length === 0) return [];
    const top = state.discard ? state.discard[state.discard.length - 1] : state.top;
    const out = [];
    for (let idx = 0; idx < hand.length; idx++) {
      const c = hand[idx];
      if (!cardMatches(c, top, state.currentSuit)) continue;
      if (c.suit === 'w') {
        for (const s of SUITS) out.push({ type: 'play', idx: idx, suit: s });
      } else {
        out.push({ type: 'play', idx: idx, suit: null });
      }
    }
    if (!out.length) {
      if (canDrawNow(state) && !state.drew) out.push({ type: 'draw', idx: null, suit: null });
      if (state.drew) out.push({ type: 'pass', idx: null, suit: null });
    }
    return out;
  }

  function drawOne(state) {
    if (state.deck.length === 0) {
      if (state.discard.length > 1) {
        const top = state.discard.pop();
        shuffle(state.discard);
        state.deck = state.discard;
        state.discard = [top];
      } else {
        return null;
      }
    }
    return state.deck.pop();
  }

  function applyMove(state, m) {
    const me = state.turn;
    const hand = state.hands[me];
    let text;
    if (m.type === 'play') {
      const c = hand.splice(m.idx, 1)[0];
      state.discard.push(c);
      if (c.suit === 'w') state.currentSuit = m.suit;
      text = 'Player ' + (me + 1) + ' played ' + cardText(c) + (c.suit === 'w' ? ' (' + SUITNAME[m.suit] + ')' : '');
      let steps = 1;
      if (c.v === 'skip') steps = 2;
      if (c.v === 'rev') {
        state.dir = -state.dir;
        if (state.players === 2) steps = 2; // 2-player: reverse = skip
      }
      if (c.v === 'draw2') {
        const victim = nextSeat(state, me);
        for (let k = 0; k < 2; k++) { const d = drawOne(state); if (d) state.hands[victim].push(d); }
        text += ' — Player ' + (victim + 1) + ' draws 2';
        steps = 2;
      }
      if (c.v === 'wild4') {
        const victim = nextSeat(state, me);
        for (let k = 0; k < 4; k++) { const d = drawOne(state); if (d) state.hands[victim].push(d); }
        text += ' — Player ' + (victim + 1) + ' draws 4';
      }
      state.turn = (me + steps * state.dir + state.players * 4) % state.players;
      state.drew = false;
    } else if (m.type === 'draw') {
      const c = drawOne(state);
      if (c) hand.push(c);
      state.drew = true;
      text = 'Player ' + (me + 1) + ' drew a card';
    } else {
      // pass (only legal after a draw)
      state.drew = false;
      state.turn = nextSeat(state, me);
      text = 'Player ' + (me + 1) + ' passed';
    }
    state.last = { seat: me, text: text };
  }

  function describeMove(state, m) {
    if (state.last) return state.last.text;
    return 'move';
  }

  function outcome(state) {
    const empty = state.hands.findIndex((h) => h === null ? false : h.length === 0);
    if (empty >= 0) return { over: true, text: 'Player ' + (empty + 1) + ' wins — empty hand!' };
    const top = state.discard ? state.discard[state.discard.length - 1] : state.top;
    if (state.hands[state.turn] === null) {
      // hidden view: rely on host-computed flags
      if (!state.canPlayNow && !state.canDrawNow && !state.drew) {
        return { over: true, text: 'Draw — the deck is exhausted.' };
      }
      return { over: false };
    }
    const playable = state.hands[state.turn].some((c) => cardMatches(c, top, state.currentSuit));
    if (!playable && !state.drew && !canDrawNow(state)) {
      return { over: true, text: 'Draw — the deck is exhausted.' };
    }
    return { over: false };
  }

  function currentSide(state) {
    return outcome(state).over ? null : String(state.turn);
  }

  function viewFor(state, side) {
    const me = seat(side);
    const top = state.discard[state.discard.length - 1];
    const v = {
      players: state.players,
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      top: { ...top }, // clone: the view must not share a live card object
      hands: state.hands.map((h, i) => (i === me ? h.slice() : null)),
      counts: state.hands.map((h) => h.length),
      turn: state.turn,
      dir: state.dir,
      currentSuit: state.currentSuit,
      drew: state.drew,
      last: state.last
    };
    // host-computed flags so outcome() works on the hidden view
    const tm = state.turn;
    v.canPlayNow = state.hands[tm].some((c) => cardMatches(c, top, state.currentSuit));
    v.canDrawNow = canDrawNow(state);
    return v;
  }

  function chooseSuit(state, me, idx) {
    const counts = { r: 0, y: 0, g: 0, b: 0 };
    state.hands[me].forEach((c, i) => { if (i !== idx && c.suit !== 'w') counts[c.suit]++; });
    let best = 'r', bs = -1, roll = Math.random();
    for (const s of SUITS) {
      if (counts[s] > bs) { bs = counts[s]; best = s; }
      else if (counts[s] === bs && roll < 0.25) best = s;
    }
    return best;
  }

  function aiMove(state, side) {
    const me = seat(side);
    // Per the contract: aiMove returns null when the side has no legal move,
    // which includes being out of turn (callers must null-check).
    if (me === null || me >= state.hands.length || state.turn !== me) return null;
    const hand = state.hands[me];
    const top = state.discard[state.discard.length - 1];
    const playable = [];
    for (let idx = 0; idx < hand.length; idx++) {
      if (cardMatches(hand[idx], top, state.currentSuit)) playable.push(idx);
    }
    if (playable.length) {
      let best = playable[0], bs = -Infinity;
      for (const idx of playable) {
        const c = hand[idx];
        let s = 0;
        if (c.suit === state.currentSuit) s += 30;
        if (c.suit === 'w') s -= 40;
        if (c.v === 'draw2' || c.v === 'wild4') s += 25;
        else if (c.v === 'skip') s += 12;
        else if (c.v === 'rev') s += 8;
        else if (typeof c.v === 'number') s += (9 - c.v) * 2;
        s += Math.random() * 3;
        if (s > bs) { bs = s; best = idx; }
      }
      const c = hand[best];
      return { type: 'play', idx: best, suit: c.suit === 'w' ? chooseSuit(state, me, best) : null };
    }
    if (canDrawNow(state) && !state.drew) return { type: 'draw', idx: null, suit: null };
    return { type: 'pass', idx: null, suit: null };
  }

  /* ---------- render ---------- */


  const logic = {
    SUITS,
    SUITNAME,
    DIRNAME,
    label,
    cardText,
    buildDeck,
    shuffle,
    newState,
    seat,
    nextSeat,
    cardMatches,
    canDrawNow,
    legalMoves,
    drawOne,
    applyMove,
    describeMove,
    outcome,
    currentSide,
    viewFor,
    chooseSuit,
    aiMove,
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['uno'] = global.PARLOR['uno'] || {};
  global.PARLOR['uno'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';
  /* UNO — pure logic (Node-testable) + DOM render.
   * Card: {suit:'r'|'y'|'g'|'b'|'w', v:0-9|'skip'|'rev'|'draw2'|'wild'|'wild4'}.
   * Move: {type:'play', idx, suit} | {type:'draw', idx:null, suit:null} | {type:'pass', idx:null, suit:null}.
   * 2-player: reverse acts as skip. Host-authoritative; views hide other hands as null.
   */

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
    const hand = state.hands[me];
    if (!hand || hand.length === 0) return [];
    const top = state.discard[state.discard.length - 1];
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
    if (state.last && state.last.seat === seat(m.type === 'play' ? 'x' : 'x')) { /* no-op guard */ }
    if (state.last) return state.last.text;
    return 'move';
  }

  function outcome(state) {
    const empty = state.hands.findIndex((h) => h === null ? false : h.length === 0);
    if (empty >= 0) return { over: true, text: 'Player ' + (empty + 1) + ' wins — empty hand!' };
    const top = state.discard ? state.discard[state.discard.length - 1] : null;
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
      top: top,
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

  function cardEl(c, isBack) {
    const d = document.createElement('div');
    d.className = 'uno-card' + (isBack ? ' back' : c.suit === 'w' ? ' w' : ' ' + c.suit);
    const big = document.createElement('span');
    big.className = 'uno-val';
    big.textContent = isBack ? '' : label(c);
    d.appendChild(big);
    return d;
  }

  function render(view, el, opts) {
    const mySide = opts.mySide;
    const interactive = !!opts.interactive;
    const onMove = opts.onMove;
    const me = seat(mySide);

    if (!interactive) el.__pend = -1;
    const pend = el.__pend != null ? el.__pend : -1;

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'uno-wrap';

    /* opponents (in play order) */
    const opp = document.createElement('div');
    opp.className = 'uno-opp';
    for (let s = 0; s < view.players; s++) {
      if (s === me) continue;
      const cell = document.createElement('div');
      cell.className = 'uno-oppcell' + (view.turn === s ? ' active' : '');
      const nm = document.createElement('div');
      nm.className = 'uno-oppname';
      nm.textContent = s === me ? '' : 'P' + (s + 1) + ' · ' + view.counts[s];
      cell.appendChild(nm);
      const backs = document.createElement('div');
      backs.className = 'uno-backs';
      const n = Math.min(view.counts[s], 7);
      for (let k = 0; k < n; k++) backs.appendChild(cardEl(null, true));
      cell.appendChild(backs);
      opp.appendChild(cell);
    }
    wrap.appendChild(opp);

    /* middle: deck, discard, suit/direction */
    const mid = document.createElement('div');
    mid.className = 'uno-mid';
    const deckPile = document.createElement('div');
    deckPile.className = 'uno-pile';
    deckPile.appendChild(cardEl(null, true));
    const dcnt = document.createElement('div');
    dcnt.className = 'cnt';
    dcnt.textContent = view.deckCount;
    deckPile.appendChild(dcnt);
    mid.appendChild(deckPile);

    const discPile = document.createElement('div');
    discPile.className = 'uno-pile';
    discPile.appendChild(cardEl(view.top, false));
    const scnt = document.createElement('div');
    scnt.className = 'cnt';
    scnt.textContent = view.discardCount - 1;
    discPile.appendChild(scnt);
    mid.appendChild(discPile);

    const info = document.createElement('div');
    info.className = 'uno-info';
    info.innerHTML = '<div class="uno-suitrow">Suit: <b class="uno-suit-' + view.currentSuit + '">' + SUITNAME[view.currentSuit] + '</b></div>' +
      '<div>Direction: ' + (view.dir === 1 ? '↻ clockwise' : '↺ counter') + '</div>' +
      (view.drew ? '<div class="uno-hint">You drew — play it or pass.</div>' : '');
    mid.appendChild(info);
    wrap.appendChild(mid);

    /* my hand */
    const handRow = document.createElement('div');
    handRow.className = 'uno-hand';
    const moves = interactive ? legalMoves(view, mySide) : [];
    const playableIdx = {};
    for (const m of moves) if (m.type === 'play') playableIdx[m.idx] = true;
    const myHand = view.hands[me] || [];
    myHand.forEach((c, idx) => {
      const ce = cardEl(c, false);
      if (interactive && playableIdx[idx]) {
        ce.classList.add('can');
        ce.addEventListener('click', () => {
          if (c.suit === 'w') { el.__pend = pend === idx ? -1 : idx; build(); return; }
          onMove({ type: 'play', idx: idx, suit: null });
        });
      }
      if (interactive && pend === idx && c.suit === 'w') ce.classList.add('pend');
      handRow.appendChild(ce);
    });
    wrap.appendChild(handRow);

    /* actions */
    const act = document.createElement('div');
    act.className = 'uno-actions';
    if (interactive) {
      if (pend >= 0) {
        for (const s of SUITS) {
          const b = document.createElement('button');
          b.className = 'btn uno-suitbtn uno-suitbtn-' + s;
          b.textContent = SUITNAME[s];
          b.addEventListener('click', () => {
            el.__pend = -1;
            onMove({ type: 'play', idx: pend, suit: s });
          });
          act.appendChild(b);
        }
      } else {
        if (moves.some((m) => m.type === 'draw')) {
          const b = document.createElement('button');
          b.className = 'btn big';
          b.textContent = '🂠 Draw a card';
          b.addEventListener('click', () => onMove({ type: 'draw', idx: null, suit: null }));
          act.appendChild(b);
        }
        if (moves.some((m) => m.type === 'pass')) {
          const b = document.createElement('button');
          b.className = 'btn big';
          b.textContent = 'Pass';
          b.addEventListener('click', () => onMove({ type: 'pass', idx: null, suit: null }));
          act.appendChild(b);
        }
      }
    }
    wrap.appendChild(act);
    el.appendChild(wrap);
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    for (let s = 0; s < view.players; s++) {
      const row = document.createElement('div');
      row.className = 'player-row' + (view.turn === s ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = (String(s) === opts.mySide ? 'You — ' : '') + 'Player ' + (s + 1);
      const det = document.createElement('span');
      det.className = 'muted';
      det.textContent = view.counts[s] + ' cards' + (s === view.turn && view.drew ? ' · drew, must resolve' : '');
      row.appendChild(name);
      row.appendChild(det);
      el.appendChild(row);
    }
  }

  const css = [
    '.uno-wrap{display:flex;flex-direction:column;gap:12px;width:min(94vw,640px);margin:0 auto}',
    '.uno-opp{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
    '.uno-oppcell{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.04)}',
    '.uno-oppcell.active{outline:2px solid #f5c518}',
    '.uno-oppname{font-size:12px;opacity:.85}',
    '.uno-backs{display:flex;gap:2px}',
    '.uno-mid{display:flex;align-items:center;justify-content:center;gap:18px}',
    '.uno-pile{position:relative;display:flex;align-items:center;justify-content:center}',
    '.uno-pile .cnt{position:absolute;bottom:-6px;right:-4px;font-size:12px;background:#12151d;border:1px solid #2c3444;border-radius:8px;padding:0 5px;color:#cdd6e4}',
    '.uno-info{font-size:13px;line-height:1.6;opacity:.92}',
    '.uno-suit-r{color:#ff6b5e}.uno-suit-y{color:#ffd75e}.uno-suit-g{color:#5ad07f}.uno-suit-b{color:#6aa8ff}',
    '.uno-hand{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:70px}',
    '.uno-card{position:relative;width:46px;height:66px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#20242e;border:2px solid rgba(0,0,0,.7);box-shadow:0 2px 5px rgba(0,0,0,.5);flex:0 0 auto}',
    '.uno-card.r{background:linear-gradient(140deg,#e0453a,#a3271f)}',
    '.uno-card.y{background:linear-gradient(140deg,#f0c419,#c79a08)}',
    '.uno-card.g{background:linear-gradient(140deg,#2ea44f,#1c7138)}',
    '.uno-card.b{background:linear-gradient(140deg,#2f6fd6,#1d4a99)}',
    '.uno-card.w{background:conic-gradient(#e0453a 0 25%,#2f6fd6 0 50%,#2ea44f 0 75%,#f0c419 0 100%)}',
    '.uno-val{font-weight:800;font-size:24px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);transform:rotate(-8deg);user-select:none}',
    '.uno-card.back{background:radial-gradient(circle at 50% 45%, #e8ebf2 16%, #232836 17%)}',
    '.uno-card.back{width:30px;height:44px}',
    '.uno-card.can{cursor:pointer;outline:3px solid #f5c518;transition:transform .08s}',
    '.uno-card.can:hover{transform:translateY(-6px)}',
    '.uno-card.pend{outline:3px solid #fff}',
    '.uno-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;min-height:34px}',
    '.uno-suitbtn{font-weight:700;border-radius:8px;padding:6px 14px;color:#fff;border:none;cursor:pointer}',
    '.uno-suitbtn-r{background:#c0392b}.uno-suitbtn-y{background:#c79a08}.uno-suitbtn-g{background:#1c7138}.uno-suitbtn-b{background:#1d4a99}',
    '.uno-hint{color:#ffd75e}'
  ].join('\n');

  const game = {
    id: 'uno',
    title: 'UNO',
    blurb: 'The classic card game — 2 to 4 players, wilds, +2, skip and reverse.',
    sideList: ['0', '1', '2', '3'],
    pickSide: false,
    sideName(side) { return 'Player ' + (parseInt(side, 10) + 1); },
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
  global.Games['uno'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);

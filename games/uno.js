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
    if (state.last && state.last.seat === seat(m.type === 'play' ? 'x' : 'x')) { /* no-op guard */ }
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
    const oval = document.createElement('span');
    oval.className = 'uno-oval';
    d.appendChild(oval);
    const big = document.createElement('span');
    big.className = 'uno-val';
    big.textContent = isBack ? '' : label(c);
    d.appendChild(big);
    if (!isBack) {
      const i1 = document.createElement('span');
      i1.className = 'uno-idx';
      i1.textContent = label(c);
      const i2 = document.createElement('span');
      i2.className = 'uno-idx b';
      i2.textContent = label(c);
      d.appendChild(i1);
      d.appendChild(i2);
    }
    return d;
  }

  /* One-shot deal animations: render() rebuilds everything, so without a
     guard every re-render would replay the card-deal animation. These keys
     live in the closure and mark which areas' contents actually changed —
     only those re-animate; the rest get .still (animation:none). */
  let lastHandKey = '', lastTopKey = '', lastCountKey = '';
   let lastHandArr = null;  // previous hand — detects "one card appended" (a draw)
   let lastDeckKey = '';    // deckCount:canDraw — fires the reshuffle spin once
   let lastNoteKey = '';    // seat:text:discardCount:counts — one play-note per action
   let lastDeckCount = -1;  // deck count — fires the deck pop when a card is drawn
   let lastOneArr = null;   // per-seat count===1 — fires the UNO! burst + badge pop once
   let lastSuitKey = '';    // currentSuit — fires the suit beat on change
   let lastDirKey = 1;      // play direction — fires the direction spin on flip

  function render(view, el, opts) {
    const mySide = opts.mySide;
    const interactive = !!opts.interactive;
    const onMove = opts.onMove;
    const me = seat(mySide);

    if (!interactive) el.__pend = -1;
    const pend = el.__pend != null ? el.__pend : -1;

    const myHand = view.hands[me] || [];
    const handKey = myHand.map((c) => (c ? c.suit + c.v : '?')).join(',');
    const topKey = view.top ? view.top.suit + view.top.v : '';
    const countKey = view.counts.join(',');
    const handChanged = handKey !== lastHandKey;
    const topChanged = topKey !== lastTopKey;
    const countsChanged = countKey !== lastCountKey;
    const oneArr = view.counts.map((c) => c === 1);
    const suitChanged = view.currentSuit !== lastSuitKey;
    const dirChanged = view.dir !== lastDirKey;

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'uno-wrap';

    /* opponents (in play order) */
    const opp = document.createElement('div');
    opp.className = 'uno-opp' + (countsChanged ? '' : ' still');
    for (let s = 0; s < view.players; s++) {
      if (s === me) continue;
      const cell = document.createElement('div');
      cell.className = 'uno-oppcell' + (view.turn === s ? ' active' : '') + (view.counts[s] === 1 ? ' one' : '');
      const nm = document.createElement('div');
      nm.className = 'uno-oppname';
      nm.textContent = s === me ? '' : 'P' + (s + 1) + ' · ' + view.counts[s];
      cell.appendChild(nm);
      if (view.counts[s] === 1) {
        const justOne = !!(lastOneArr && !lastOneArr[s]);
        const badge = document.createElement('span');
        badge.className = 'uno-one' + (justOne ? ' pop' : '');
        badge.textContent = '1';
        cell.appendChild(badge);
        if (justOne) {
          const burst = document.createElement('span');
          burst.className = 'uno-burst';
          burst.textContent = 'UNO!';
          cell.appendChild(burst);
        }
      }
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
    const deckKey = view.deckCount + ':' + (view.canDrawNow ? 1 : 0);
    const deckSpin = view.deckCount === 0 && view.canDrawNow && deckKey !== lastDeckKey;
    const deckDealt = !deckSpin && lastDeckCount >= 0 && view.deckCount < lastDeckCount;
    const deckPile = document.createElement('div');
    deckPile.className = 'uno-pile uno-deck' + (deckSpin ? ' shuffling' : deckDealt ? ' dealt' : ' still');
    const d1 = cardEl(null, true); d1.className += ' uno-d1';
    const d2 = cardEl(null, true); d2.className += ' uno-d2';
    const d3 = cardEl(null, true); d3.className += ' uno-d3';
    deckPile.appendChild(d1);
    deckPile.appendChild(d2);
    deckPile.appendChild(d3);
    const dcnt = document.createElement('div');
    dcnt.className = 'cnt';
    dcnt.textContent = view.deckCount;
    deckPile.appendChild(dcnt);
    mid.appendChild(deckPile);

    const noteKey = view.last
      ? view.last.seat + ':' + view.last.text + ':' + view.discardCount + ':' + view.counts.join(',')
      : '';
    const noteChanged = noteKey !== lastNoteKey;

    const discPile = document.createElement('div');
    discPile.className = 'uno-pile uno-disc' + (topChanged ? '' : ' still');
    const under = cardEl(null, true);
    under.className += ' uno-under';
    discPile.appendChild(under);
    const topCard = cardEl(view.top, false);
    if (topChanged) topCard.classList.add(view.last && view.last.seat === me ? 'playin-mine' : 'playin-opp');
    discPile.appendChild(topCard);
    if (view.last && noteChanged) {
      const note = document.createElement('div');
      note.className = 'uno-note';
      note.textContent = view.last.text.replace('Player ' + (me + 1), 'You');
      discPile.appendChild(note);
    }
    const scnt = document.createElement('div');
    scnt.className = 'cnt';
    scnt.textContent = view.discardCount - 1;
    discPile.appendChild(scnt);
    mid.appendChild(discPile);

    const info = document.createElement('div');
    info.className = 'uno-info';
    const dirCcw = view.dir !== 1;
    info.innerHTML = '<div class="uno-suitrow">Suit: <b class="uno-suit-' + view.currentSuit + (suitChanged ? ' uno-suitbeat' : '') + '">' + SUITNAME[view.currentSuit] + '</b></div>' +
      '<div class="uno-dirrow"><span class="uno-dir' + (dirCcw ? ' ccw' : '') + (dirChanged ? ' dirbeat' : '') + '">' + (dirCcw ? '↺' : '↻') + '</span> ' + (dirCcw ? 'counter' : 'clockwise') + '</div>' +
      (view.drew ? '<div class="uno-hint">You drew — play it or pass.</div>' : '');
    mid.appendChild(info);
    wrap.appendChild(mid);

    /* my hand — fanned arc; only genuinely new cards animate */
    let handMode = 'still'; // still | full (fresh deal) | drawn (one card appended)
    if (handChanged) {
      const prev = lastHandArr || [];
      const isAppend = myHand.length > prev.length &&
        prev.every((c, i) => myHand[i] && c.suit + c.v === myHand[i].suit + myHand[i].v);
      handMode = isAppend ? 'drawn' : (myHand.length < prev.length ? 'still' : 'full');
    }
    const handRow = document.createElement('div');
    handRow.className = 'uno-hand' + (handMode === 'still' ? ' still' : '');
    const moves = interactive ? legalMoves(view, mySide) : [];
    const playableIdx = {};
    for (const m of moves) if (m.type === 'play') playableIdx[m.idx] = true;
    const midIdx = (myHand.length - 1) / 2;
    const denom = Math.max(Math.abs(midIdx), 1);
    myHand.forEach((c, idx) => {
      const ce = cardEl(c, false);
      const d = idx - midIdx;
      const rot = Math.max(-9, Math.min(9, d * 1.5));
      const t = d / denom;
      const lift = 10 * (1 - t * t);
      if (ce.style) {
        if (ce.style.setProperty) {
          ce.style.setProperty('--rot', rot.toFixed(2) + 'deg');
          ce.style.setProperty('--lift', lift.toFixed(2) + 'px');
        }
        ce.style.zIndex = String(idx);
      }
      if (handMode === 'drawn' && idx !== myHand.length - 1) ce.classList.add('uno-still');
      if (handMode === 'drawn' && idx === myHand.length - 1) ce.classList.add('drawn');
      if (myHand.length === 1) ce.classList.add('last');
      if (interactive && playableIdx[idx]) {
        ce.classList.add('can');
        ce.addEventListener('click', () => {
          if (c.suit === 'w') { el.__pend = pend === idx ? -1 : idx; render(view, el, opts); return; }
          onMove({ type: 'play', idx: idx, suit: null });
        });
      }
      if (interactive && pend === idx && c.suit === 'w') ce.classList.add('pend');
      handRow.appendChild(ce);
    });
    if (myHand.length === 1 && lastOneArr && !lastOneArr[me]) {
      const burst = document.createElement('div');
      burst.className = 'uno-burst';
      burst.textContent = 'UNO!';
      handRow.appendChild(burst);
    }
    wrap.appendChild(handRow);

    /* actions */
    const act = document.createElement('div');
    act.className = 'uno-actions';
    if (interactive) {
      if (pend >= 0) {
        SUITS.forEach((s, si) => {
          const b = document.createElement('button');
          b.className = 'btn uno-suitbtn uno-suitbtn-' + s + ' suitin';
          b.textContent = SUITNAME[s];
          if (b.style && b.style.setProperty) b.style.setProperty('animation-delay', (si * .05) + 's');
          b.addEventListener('click', () => {
            el.__pend = -1;
            onMove({ type: 'play', idx: pend, suit: s });
          });
          act.appendChild(b);
        });
      } else {
        if (moves.some((m) => m.type === 'draw')) {
          const b = document.createElement('button');
          b.className = 'btn big';
          b.textContent = 'Draw a card';
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

    lastHandKey = handKey; lastTopKey = topKey; lastCountKey = countKey;
    lastHandArr = myHand.map((c) => (c ? { suit: c.suit, v: c.v } : null));
    lastDeckKey = deckKey;
    lastNoteKey = noteKey;
    lastDeckCount = view.deckCount;
    lastOneArr = oneArr;
    lastSuitKey = view.currentSuit;
    lastDirKey = view.dir;
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
    '.uno-wrap{display:flex;flex-direction:column;gap:14px;width:min(94vw,640px);margin:0 auto}',
    '.uno-opp{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}',
    '.uno-oppcell{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 14px;border-radius:14px;background:#faf9f5;border:1px solid #e4e0d4;transition:border-color .2s, background .2s, box-shadow .2s}',
    '.uno-oppcell.active{border-color:#16683f;background:#e9f1ea;box-shadow:inset 0 0 0 1px #16683f;animation:turn-glow 1.6s ease-in-out infinite}',
    '.uno-oppcell.one{border-color:var(--gold);background:var(--gold-soft);box-shadow:inset 0 0 0 1px var(--gold)}',
    '.uno-one{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;background:var(--gold);color:#fff;font-family:var(--font-display);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(28,33,30,.3);animation:pill-pulse .9s ease-in-out infinite}',
    '.uno-one.pop{animation:uno-badge-pop .45s var(--ease-spring) both, pill-pulse .9s ease-in-out .55s infinite}',
    '@keyframes uno-badge-pop{0%{transform:scale(0)}60%{transform:scale(1.45)}100%{transform:scale(1)}}',
    '.uno-burst{position:absolute;top:-16px;left:50%;z-index:9;font-family:var(--font-display);font-weight:900;font-size:22px;color:#a34433;letter-spacing:.05em;text-shadow:0 1px 3px rgba(28,33,30,.35);pointer-events:none;transform:translateX(-50%);animation:uno-burst .9s var(--ease-spring) both}',
    '@keyframes uno-burst{0%{opacity:0;transform:translateX(-50%) scale(.3) rotate(-14deg)}35%{opacity:1;transform:translateX(-50%) scale(1.35) rotate(6deg)}60%{opacity:1;transform:translateX(-50%) scale(1) rotate(-3deg)}100%{opacity:0;transform:translateX(-50%) scale(1.05) rotate(0)}}',
    '.uno-suitbeat{display:inline-block;animation:uno-suitbeat .5s var(--ease-spring) both}',
    '@keyframes uno-suitbeat{0%{transform:scale(1.6);filter:brightness(1.5)}100%{transform:scale(1);filter:brightness(1)}}',
    '.uno-dir.dirbeat{animation:dir-spin 9s linear infinite, uno-dirbeat .55s var(--ease-spring)}',
    '.uno-dir.ccw.dirbeat{animation:dir-spin 9s linear infinite reverse, uno-dirbeat .55s var(--ease-spring)}',
    '@keyframes uno-dirbeat{from{transform:rotate(360deg)}to{transform:rotate(0)}}',
    '.uno-oppname{font-size:12px;font-weight:600;color:#5c6560;letter-spacing:.02em}',
    '.uno-backs{display:flex;gap:3px}',
    '.uno-mid{display:flex;align-items:center;justify-content:center;gap:22px}',
    '.uno-pile{position:relative;perspective:420px}',
    '.uno-pile.still .uno-card{animation:none}',
    '.uno-deck{display:grid;place-items:center;width:56px;height:80px}',
    '.uno-deck .uno-card{grid-area:1/1}',
    '.uno-d1{transform:translate(-6px,-7px) rotate(-6deg);opacity:.4}',
    '.uno-d2{transform:translate(-3px,-3px) rotate(-3deg);opacity:.7}',
    '.uno-d3{z-index:1}',
    '.uno-deck.shuffling{animation:dir-spin .8s var(--ease-out) both}',
    '.uno-deck.dealt .uno-d3{animation:deck-pop .35s var(--ease-spring) both}',
    '.uno-disc{display:grid;place-items:center;width:62px;height:86px}',
    '.uno-disc .uno-card{grid-area:1/1}',
    '.uno-under{transform:translate(-4px,-5px) rotate(-5deg);opacity:.75;animation:none}',
    '.uno-disc .uno-card:not(.uno-under){z-index:1}',
    '.uno-note{position:absolute;top:-24px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.02em;color:#f7f2e5;background:#232836;padding:3px 11px;border-radius:999px;box-shadow:0 2px 6px rgba(28,33,30,.3);pointer-events:none;z-index:6;animation:note-fade 1.6s var(--ease-out) both}',
    '.uno-opp.still .uno-card{animation:none}',
    '.uno-hand.still .uno-card{animation:none}',
    '.uno-card.playin-mine{animation:uno-play-mine .55s var(--ease-glide) both}',
    '.uno-card.playin-opp{animation:uno-play-opp .5s var(--ease-glide) both}',
    '.uno-pile .cnt{position:absolute;bottom:-8px;right:-8px;font-size:11.5px;font-weight:700;background:#fff;border:1px solid #d3cdbd;border-radius:999px;padding:1px 8px;color:#47514b;box-shadow:0 1px 3px rgba(28,33,30,.12)}',
    '.uno-info{font-size:13px;line-height:1.65;color:#47514b}',
    '.uno-dirrow{display:flex;align-items:center;gap:6px}',
    '.uno-dir{display:inline-block;font-size:15px;line-height:1;animation:dir-spin 9s linear infinite}',
    '.uno-dir.ccw{animation-direction:reverse}',
    '.uno-suit-r{color:#a34433;font-weight:700}.uno-suit-y{color:#a87c15;font-weight:700}.uno-suit-g{color:#1e5634;font-weight:700}.uno-suit-b{color:#2e4d74;font-weight:700}',
    '.uno-hand{position:relative;display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-end;min-height:92px;padding-top:16px}',
    '.uno-hand .uno-card{margin-left:-16px}',
    '.uno-hand .uno-card:first-child{margin-left:0}',
    '.uno-still{animation:none !important}',
    '.uno-card{position:relative;width:52px;height:74px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:#20242e;box-shadow:0 3px 8px rgba(28,33,30,.28);flex:0 0 auto;transform:rotate(var(--rot,0deg)) translateY(calc(var(--lift,0px) * -1));animation:uno-deal .3s var(--ease-out) both;transition:transform .32s var(--ease-glide)}',
    '.uno-card::before{content:"";position:absolute;inset:0;border-radius:11px;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),inset 0 -3px 8px rgba(0,0,0,.28);pointer-events:none}',
    '.uno-oval{position:absolute;inset:19% 7%;background:#f7f2e5;border-radius:50%;transform:rotate(-16deg);box-shadow:inset 0 0 0 1.5px rgba(28,33,30,.14)}',
    '.uno-val{position:relative;z-index:1;font-family:var(--font-display);font-weight:900;font-size:25px;line-height:1;color:#fff;transform:rotate(-16deg);user-select:none}',
    '.uno-idx{position:absolute;z-index:1;top:4px;left:6px;font-family:var(--font-display);font-size:10px;font-weight:800;line-height:1;color:#f7f2e5;text-shadow:0 1px 2px rgba(0,0,0,.55);transform:rotate(-16deg)}',
    '.uno-idx.b{top:auto;left:auto;bottom:4px;right:6px;transform:rotate(164deg)}',
    '.uno-card.r{background:linear-gradient(140deg,#b04a33,#7f2a1c)}',
    '.uno-card.r .uno-val{color:#9c2f1e}',
    '.uno-card.y{background:linear-gradient(140deg,#d2a12e,#9c7415)}',
    '.uno-card.y .uno-val{color:#8a6510}',
    '.uno-card.g{background:linear-gradient(140deg,#3c8551,#1e5634)}',
    '.uno-card.g .uno-val{color:#1e5634}',
    '.uno-card.b{background:linear-gradient(140deg,#48699a,#2a466e)}',
    '.uno-card.b .uno-val{color:#2a466e}',
    '.uno-card.w{background:conic-gradient(#b04a33 0 25%,#48699a 0 50%,#3c8551 0 75%,#d2a12e 0 100%)}',
    '.uno-card.w .uno-val{color:#232836}',
    '.uno-card.back{background:#232836;width:34px;height:48px}',
    '.uno-card.back .uno-oval{inset:22% 14%;background:#f7f2e5}',
    '.uno-card.back::after{content:"";position:absolute;z-index:1;left:50%;top:50%;width:9px;height:13px;margin:-6.5px 0 0 -4.5px;border-radius:50%;background:#c29330;transform:rotate(-16deg)}',
    '.uno-card.back.uno-under{width:52px;height:74px}',
    '.uno-deck .uno-card.back{width:52px;height:74px}',
    '.uno-backs .uno-card:nth-child(2){animation-delay:.03s}',
    '.uno-backs .uno-card:nth-child(3){animation-delay:.06s}',
    '.uno-backs .uno-card:nth-child(4){animation-delay:.09s}',
    '.uno-backs .uno-card:nth-child(5){animation-delay:.12s}',
    '.uno-backs .uno-card:nth-child(6){animation-delay:.15s}',
    '.uno-backs .uno-card:nth-child(7){animation-delay:.18s}',
    '.uno-hand .uno-card:nth-child(2){animation-delay:.03s}',
    '.uno-hand .uno-card:nth-child(3){animation-delay:.06s}',
    '.uno-hand .uno-card:nth-child(4){animation-delay:.09s}',
    '.uno-hand .uno-card:nth-child(5){animation-delay:.12s}',
    '.uno-hand .uno-card:nth-child(6){animation-delay:.15s}',
    '.uno-hand .uno-card:nth-child(7){animation-delay:.18s}',
    '.uno-hand .uno-card:nth-child(8){animation-delay:.21s}',
    '.uno-hand .uno-card:nth-child(9){animation-delay:.24s}',
    '.uno-hand .uno-card:nth-child(10){animation-delay:.27s}',
    '.uno-hand .uno-card:nth-child(11){animation-delay:.30s}',
    '.uno-hand .uno-card:nth-child(12){animation-delay:.33s}',
    '.uno-card.can{cursor:pointer;outline:3px solid #16683f;outline-offset:1px;transition:transform .14s var(--ease-spring), outline-color .12s, box-shadow .12s}',
    '.uno-card.can:hover{transform:translateY(-16px) scale(1.07) rotate(0);z-index:50}',
    '.uno-card.pend{outline:3px solid #fff;box-shadow:0 0 0 5px rgba(22,104,63,.5), 0 4px 12px rgba(28,33,30,.3);transform:translateY(-16px) scale(1.07) rotate(0);z-index:50}',
    '.uno-card.last{outline:3px solid var(--gold);animation:uno-last-pulse 1.2s ease-in-out infinite}',
    '@keyframes uno-last-pulse{0%,100%{box-shadow:0 2px 6px rgba(28,33,30,.22), 0 0 0 0 rgba(194,147,48,0)}50%{box-shadow:0 2px 6px rgba(28,33,30,.22), 0 0 0 9px rgba(194,147,48,.4)}}',
    '.uno-card.drawn{animation:uno-drawfly .6s var(--ease-glide) both;animation-delay:.06s}',
    '.uno-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;min-height:38px}',
    '.uno-suitbtn{font-weight:800;border-radius:10px;padding:9px 18px;color:#fff;border:none;cursor:pointer;letter-spacing:.03em;box-shadow:0 3px 0 rgba(0,0,0,.25);transition:transform .1s, box-shadow .1s, filter .15s}',
    '.uno-suitbtn.suitin{animation:entry-in .32s var(--ease-spring) backwards}',
    '.uno-suitbtn:hover{filter:brightness(1.12);transform:translateY(-1px)}',
    '.uno-suitbtn:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.25)}',
    '.uno-suitbtn-r{background:#7f2a1c}.uno-suitbtn-y{background:#9c7415}.uno-suitbtn-g{background:#1e5634}.uno-suitbtn-b{background:#2a466e}',
    '.uno-hint{color:#8a6a1f;font-weight:600}',
    '@keyframes uno-play-mine{0%{opacity:0;transform:translate(40px,320px) rotate(20deg) scale(.7)}55%{opacity:1;transform:translate(12px,110px) rotate(6deg) scale(.92)}80%{transform:translate(-4px,-8px) rotate(-1.5deg) scale(1.05)}100%{opacity:1;transform:translate(0,0) rotate(0) scale(1)}}',
    '@keyframes uno-play-opp{0%{opacity:0;transform:translate(0,-320px) rotate(-18deg) scale(.7)}55%{opacity:1;transform:translate(0,-110px) rotate(-5deg) scale(.93)}80%{transform:translate(0,10px) rotate(1.5deg) scale(1.05)}100%{opacity:1;transform:translate(0,0) rotate(0) scale(1)}}',
    '@keyframes uno-drawfly{0%{opacity:0;transform:translate(-230px,-300px) rotate(-14deg) scale(.6)}60%{opacity:1;transform:translate(-80px,-120px) rotate(-5deg) scale(.9)}100%{opacity:1;transform:rotate(var(--rot,0deg)) translateY(calc(var(--lift,0px) * -1)) scale(1)}}',
    '@keyframes note-fade{0%{opacity:0;transform:translate(-50%,8px)}12%{opacity:1;transform:translate(-50%,0)}72%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-10px)}}',
    '@keyframes deck-pop{0%{transform:scale(.8)}60%{transform:scale(1.1)}100%{transform:scale(1)}}'
  ].join('\n');

  const game = {
    id: 'uno',
    title: 'UNO',
    blurb: 'The classic card game — 2 to 4 players, wilds, +2, skip and reverse.',
    hint: "Play a card matching the top card's color or value — or draw.",
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

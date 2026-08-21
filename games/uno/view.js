/* games/uno/view.js — UNO: DOM render layer. Logic symbols via L = global.PARLOR['uno'].logic. */
(function (global) {
  'use strict';

  const L = global.PARLOR['uno'].logic;
  const { SUITS, SUITNAME, DIRNAME, label, cardText, buildDeck, shuffle, newState, seat, nextSeat, cardMatches, canDrawNow, legalMoves, drawOne, applyMove, describeMove, outcome, currentSide, viewFor, chooseSuit, aiMove } = L;

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

  /* Motion gating — same feature gate as poker: card flights need real layout
     geometry and rAF, neither of which the test stub provides, and
     prefers-reduced-motion users should never see them. */
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

  /* ghost card for in-flight cards — a real card that travels, then fades */
  function flyCardEl(card, isBack) {
    const g = cardEl(card, isBack);
    g.className += ' uno-flycard';
    return g;
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
   let lastCountsArr = null; // per-seat count snapshot — detects who drew (count grew)

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

    /* FX events for this render (consumed by main.js pumpEvents). */
    const fx = [];
    /* hand animation mode — computed early so FX decisions can use it */
    let handMode = 'still'; // still | full (fresh deal) | drawn (one card appended)
    if (handChanged) {
      const prev = lastHandArr || [];
      const isAppend = myHand.length > prev.length &&
        prev.every((c, i) => myHand[i] && c.suit + c.v === myHand[i].suit + myHand[i].v);
      handMode = isAppend ? 'drawn' : (myHand.length < prev.length ? 'still' : 'full');
    }

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'uno-wrap';

    /* table: red felt oval with the deck and discard in the middle; every
       player sits around it, keyed by offset from my seat — 0 = me (bottom),
       then clockwise 1 = left, 2 = top, 3 = right. With three players the
       top seat splits into a top-left / top-right pair (.trio). */
    const table = document.createElement('div');
    table.className = 'uno-table' + (view.players === 3 ? ' trio' : '');
    const feltEl = document.createElement('div');
    feltEl.className = 'uno-felt';
    table.appendChild(feltEl);
    if (handMode === 'full' || !lastHandArr) fx.push({ t: 'deal', el: feltEl }); // fresh deal / re-deal

    /* middle: deck, discard, suit/direction */
    const mid = document.createElement('div');
    mid.className = 'uno-mid';
    const piles = document.createElement('div');
    piles.className = 'uno-piles';
    const deckKey = view.deckCount + ':' + (view.canDrawNow ? 1 : 0);
    const deckSpin = view.deckCount === 0 && view.canDrawNow && deckKey !== lastDeckKey;
    const deckDealt = !deckSpin && lastDeckCount >= 0 && view.deckCount < lastDeckCount;
    const deckPile = document.createElement('div');
    deckPile.className = 'uno-pile uno-deck' + (deckSpin ? ' shuffling' : deckDealt ? ' dealt' : ' still');
    if (deckSpin) fx.push({ t: 'shuffle', el: deckPile }); // deck ran dry → reshuffle
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
    piles.appendChild(deckPile);

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
    if (topChanged) {
      topCard.classList.add('topin');
      if (canFly() && view.last) topCard.classList.add('late');
    }
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
    piles.appendChild(discPile);
    if (topChanged && lastTopKey && handMode !== 'full') { // a card was played onto the discard
      fx.push({ t: 'play', el: discPile });
      if (suitChanged) fx.push({ t: 'wild', el: discPile }); // a wild chose a new suit
    }

    const info = document.createElement('div');
    info.className = 'uno-info';
    const dirCcw = view.dir !== 1;
    info.innerHTML = '<div class="uno-dirrow"><b class="uno-suit-' + view.currentSuit + (suitChanged ? ' uno-suitbeat' : '') + '">' + SUITNAME[view.currentSuit] + '</b><span class="uno-sep">·</span><span class="uno-dir' + (dirCcw ? ' ccw' : '') + (dirChanged ? ' dirbeat' : '') + '">' + (dirCcw ? '↺' : '↻') + '</span> ' + (dirCcw ? 'counter' : 'clockwise') + '</div>' +
      (view.drew ? '<div class="uno-hint">You drew — play it or pass.</div>' : '');
    mid.appendChild(piles);
    mid.appendChild(info);
    table.appendChild(mid);

    /* seats, one per player (mine included — the fanned hand below is the
       interactive copy, the seat shows who holds what and whose turn it is) */
    const seatEls = new Array(view.players);
    for (let s = 0; s < view.players; s++) {
      const off = (s - me + view.players * 4) % view.players;
      const cell = document.createElement('div');
      cell.className = 'uno-pos uno-pos' + off + ' uno-oppcell' + (view.turn === s ? ' active' : '') + (view.counts[s] === 1 ? ' one' : '') + (countsChanged ? '' : ' still');
      const nm = document.createElement('div');
      nm.className = 'uno-oppname';
      nm.textContent = (s === me ? 'You · ' : 'P' + (s + 1) + ' · ') + view.counts[s];
      cell.appendChild(nm);
      if (view.counts[s] === 1) {
        const justOne = !!(lastOneArr && !lastOneArr[s]);
        if (justOne) fx.push({ t: 'uno', el: cell }); // a count just hit one
        const badge = document.createElement('span');
        badge.className = 'uno-one' + (justOne ? ' pop' : '');
        badge.textContent = '1';
        cell.appendChild(badge);
        if (justOne && s !== me) {
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
      seatEls[s] = cell;
      table.appendChild(cell);
    }
    wrap.appendChild(table);

    /* my hand — fanned arc; only genuinely new cards animate
       (handMode was computed at the top of render so FX events can use it) */
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
    if (lastCountsArr && handMode !== 'full') { // someone's hand grew since the last render
      const grewMe = view.counts[me] - lastCountsArr[me];
      if (grewMe >= 1) fx.push({ t: grewMe >= 2 ? 'draw2' : 'draw1', el: handRow });
      for (let s = 0; s < view.players; s++) {
        if (s === me) continue;
        const grew = view.counts[s] - lastCountsArr[s];
        if (grew >= 1) fx.push({ t: grew >= 2 ? 'draw2' : 'draw1', el: seatEls[s] });
      }
    }

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

    /* --- card flights: a played card flies from the acting seat to the
       discard; a drawn card flies from the deck to the seat that drew it
       (or into my hand). Gated by canFly() so the test stub and
       reduced-motion never touch layout geometry; on the very first
       render (no previous state) there is nothing to fly. --- */
    if (canFly()) {
      function flyCard(tbl, src, dst, node, w, h, delay, dur) {
        const tr = tbl.getBoundingClientRect();
        node.style.left = (src.left + src.width / 2 - tr.left) + 'px';
        node.style.top = (src.top + src.height / 2 - tr.top) + 'px';
        node.style.margin = (-(h / 2)) + 'px 0 0 ' + (-(w / 2)) + 'px';
        tbl.appendChild(node);
        const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
        const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
        setTimeout(() => {
          requestAnimationFrame(() => {
            node.style.transition = 'transform ' + dur + 's var(--ease-out), opacity .18s ease-out ' + (dur - .2) + 's';
            node.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.85)';
            node.style.opacity = '0';
          });
        }, delay * 1000);
        setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, (delay + dur + .35) * 1000);
      }
      if (topChanged && view.last) {
        flyCard(table, seatEls[view.last.seat].getBoundingClientRect(), discPile.getBoundingClientRect(), flyCardEl(view.top, false), 44, 64, 0, .42);
      }
      for (let s = 0; s < view.players; s++) {
        const grew = lastCountsArr ? view.counts[s] - lastCountsArr[s] : 0;
        for (let k = 0; k < Math.min(grew, 2); k++) {
          const dst = (s === me ? handRow.children[myHand.length - 1] : seatEls[s]).getBoundingClientRect();
          flyCard(table, deckPile.getBoundingClientRect(), dst, flyCardEl(null, true), 34, 48, k * .09, .4);
        }
      }
    }

    el.__events = fx; // fresh array every render, even empty (pumpEvents contract)
    lastHandKey = handKey; lastTopKey = topKey; lastCountKey = countKey;
    lastHandArr = myHand.map((c) => (c ? { suit: c.suit, v: c.v } : null));
    lastDeckKey = deckKey;
    lastNoteKey = noteKey;
    lastDeckCount = view.deckCount;
    lastOneArr = oneArr;
    lastSuitKey = view.currentSuit;
    lastDirKey = view.dir;
    lastCountsArr = view.counts.slice();
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


  global.PARLOR = global.PARLOR || {};
  global.PARLOR['uno'] = global.PARLOR['uno'] || {};
  global.PARLOR['uno'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);

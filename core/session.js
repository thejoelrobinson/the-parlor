/* core/session.js — The Parlor session state machine: the active session (S),
 * moves, P2P message handling, the FX event pump, results/rematch/leave, chat
 * and log. Loaded after core/p2p.js, before the game modules and main.js.
 * main.js binds A (window.AUDIO), F (window.FX) and show() at boot, because
 * fx/ and the shell screens load after core/.
 *
 * P2P model: the HOST is authoritative. The guest sends {t:'move'} messages;
 * the host validates, applies, and broadcasts the guest's hidden-safe view.
 * The host is always sideList[0]; the guest is sideList[1].
 */
(function (global) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const Games = global.Games || (global.Games = {});

  let S = null;              // active session
  let lastPillKey = '';      // turn-pill className+text; re-pulses on change
  let botTimer = null;       // pending CPU move; cleared before rescheduling and on leave

  /* ---------- audio & FX (window.AUDIO / window.FX from fx/, see CONTRACT.md) ----------
   * The fx modules may be missing (e.g. the Node click-test does not load
   * them), so every call is guarded. Game render() emits presentation events
   * on el.__events; pumpEvents() turns them into SFX + particles locally on
   * both P2P sides — no new message types. */
  let A = null;   // window.AUDIO — bound by main.js at boot (fx/ loads after core/)
  let F = null;   // window.FX — bound by main.js at boot (fx/ loads after core/)
  let show = function () {}; // shell screen transition — bound by main.js at boot

  let boardFxLayer = null;   // FX particle layer on #board for the active session
  let overlayFxLayer = null; // FX layer on #overlay-fx for result fanfare
  let lastTurnSide = null;   // side to move on the previous render (drives the turn tick)
  let pumpedResult = false;  // true while the last pump played a mate/draw board sting
  let irisDone = false;      // this session's first board render already iris-revealed
  let lastRenderOver = false; // outcome().over on the previous render (rematch detection)

  function fxOn() { return !!F && typeof F.enabled === 'function' && F.enabled(); }

  /* ================= sessions ================= */
  function configsFor(g, mode) {
    if (mode !== 'local') return [{ kind: 'human' }, { kind: 'human' }];
    return g.localConfigs ? g.localConfigs() : null; // 4-player games declare their bot seats
  }

  function otherSide(g, side) {
    if (g.sideList.length === 2) return g.sideList[0] === side ? g.sideList[1] : g.sideList[0];
    return side === '0' ? '1' : '0'; // seated games in P2P: seats 0 and 1
  }

  /* ---------- board iris reveal (game start / rematch / next hand) ----------
   * One-shot clip-path wipe on #board. Cleanup is timeout-based rather than
   * animationend, because piece-level animationend events bubble up to the
   * board and would cut the wipe short. No-op in the Node click-test. */
  function irisBoard() {
    const b = $('#board');
    if (!b || !b.classList) return;
    b.classList.remove('iris-in');
    void b.offsetWidth; // reflow: lets a quick re-trigger restart the wipe
    b.classList.add('iris-in');
    setTimeout(() => { if (b.classList.contains('iris-in')) b.classList.remove('iris-in'); }, 1400);
  }

  function startSession(gameId, mode, mySide) {
    const g = Games[gameId];
    S = {
      game: g, gameId, mode, mySide,
      configs: configsFor(g, mode),
      state: null, view: null, over: false
    };
    setConn(mode);
    $('#log').innerHTML = '';
    $('#chat-log').innerHTML = '';
    $('#chat-box').classList.toggle('hidden', mode === 'local');
    $('#game-title').textContent = g.title;
    $('#game-hint').textContent = g.hint || '';

    // presentation: attach the FX particle layer to the board and start this
    // game's music scene (stops whatever was playing first).
    boardFxLayer = F && F.attach ? (F.attach($('#board')) || null) : null;
    if (A && A.music) { A.music.stop(); A.music.start(gameId); }
    lastTurnSide = null;
    irisDone = false;      // first rendered board this session gets the iris reveal
    lastRenderOver = false; // ...and no "finished→alive" transition is pending

    if (mode === 'local' || mode === 'p2p-host') {
      S.state = g.newState(S.configs);
      addLog(mode === 'local' ? 'Playing against the computer. You are ' + g.sideName(mySide) + '.'
                              : 'Host connected. You are ' + g.sideName(mySide) + '.');
      broadcastView();
      show('screen-game');
      renderAll();
      afterMove();
    } else {
      const dealPill = $('#turn-pill');
      dealPill.textContent = 'Waiting for the host to deal';
      dealPill.className = 'pill wait';
      show('screen-game');
    }
  }

  function setConn(mode) {
    const pill = $('#conn-pill');
    if (!mode) { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    pill.className = mode === 'local' ? 'pill cpu' : 'pill p2p';
    pill.textContent = mode === 'local' ? 'vs Computer'
                     : mode === 'p2p-host' ? 'P2P · Host' : 'P2P · Guest';
  }

  function broadcastView() {
    if (S.mode === 'p2p-host') {
      P2P.send({ t: 'state', view: S.game.viewFor(S.state, otherSide(S.game, S.mySide)) });
    }
  }

  /* ---------- game-event pump (P2P-safe FX; see CONTRACT.md) ----------
   * A game's render() diffs its own view and records {t, el?, x?, y?, n?}
   * events on el.__events. After every render we play the matching SFX + FX.
   * Both P2P peers diff the same state, so both fire identical FX locally —
   * no new message types are needed. Unknown event types pass their name
   * through as the SFX (additive, never throws). */
  const FX_EVENTS = {
    // event t -> { sfx, fx (particle kind), n (count), shake (board size) }
    move:      { sfx: 'move' },
    castle:    { sfx: 'move' },
    capture:   { sfx: 'capture', fx: 'spark', shake: 'sm' },
    check:     { sfx: 'check', fx: 'ring' },
    mate:      { sfx: 'mate', shake: 'lg' },
    promo:     { sfx: 'promo', fx: 'goldrain' },
    crown:     { sfx: 'crown', fx: 'goldrain' },
    multijump: { sfx: 'capture', fx: 'spark', shake: 'md' },
    draw:      { sfx: 'draw' },
    deal:      { sfx: 'deal', fx: 'dust' },
    draw1:     { sfx: 'draw1', fx: 'dust' },
    draw2:     { sfx: 'draw1', fx: 'dust' },
    play:      { sfx: 'flip', fx: 'spark' },
    flip:      { sfx: 'flip' },
    wild:      { sfx: 'wild', fx: 'confetti', n: 36 },
    shuffle:   { sfx: 'shuffle', fx: 'dust' },
    uno:       { sfx: 'uno', fx: 'ring', shake: 'sm' },
    bet:       { sfx: 'chip', fx: 'spark' },
    fold:      { sfx: 'fold', fx: 'smoke' },
    allin:     { sfx: 'allin', fx: 'sweep' },
    phase:     { sfx: 'tick' },
    showdown:  { sfx: null, fx: 'sweep' }, // silent sweep: the overlay fanfare carries the sound
    click:     { sfx: 'click' }
  };

  function pumpEvents(boardEl) {
    pumpedResult = false; // cleared every pump; set again only by mate/draw
    const evs = boardEl && boardEl.__events;
    if (!evs || !evs.length) return;
    boardEl.__events = []; // consumed — the next render starts a fresh diff
    const layer = boardFxLayer;
    for (const ev of evs) {
      if (!ev || !ev.t) continue;
      const def = FX_EVENTS[ev.t] || { sfx: ev.t };
      if (def.sfx !== null && A && A.play) A.play(def.sfx);
      if (ev.t === 'mate' || ev.t === 'draw') pumpedResult = true;
      if (ev.t === 'check' && A && A.music && A.music.setIntensity) A.music.setIntensity(2);
      if (!F || !fxOn() || !layer) continue;
      if (def.shake) F.shake(boardEl, def.shake);
      if (def.fx) {
        if (ev.el) F.at(ev.el, def.fx, { layer: layer, n: def.n });
        else F.burst(def.fx, ev.x || 0, ev.y || 0, { layer: layer, n: def.n });
      }
    }
  }

  /* Music intensity 0–3 (1 calm, 2 tension, 3 climax); fx/audio.js applies it
   * on the next bar boundary. Reads only public view fields. */
  function setIntensity(view) {
    if (!A || !A.music || !A.music.setIntensity) return;
    const g = S.game;
    // each game maps its own view to a 0-3 level (g.intensity); default 1 = calm
    A.music.setIntensity(g.intensity ? g.intensity(view, S.mySide) : 1);
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    if (!S) return;
    const g = S.game;
    // render always works on a VIEW for the viewer's seat (guest: host's projection;
    // local/host: the seat's own projection — same shapes the guest receives)
    const view = S.mode === 'p2p-guest' ? S.view : S.game.viewFor(S.state, S.mySide);
    if (!view) return;

    if (g.css) {
      let st = document.getElementById('game-css-' + S.gameId);
      if (!st) {
        st = document.createElement('style');
        st.id = 'game-css-' + S.gameId;
        document.head.appendChild(st);
      }
      if (st.textContent !== g.css) st.textContent = g.css;
    }

    const side = g.currentSide(view);
    const over = g.outcome(view).over;

    // Iris reveal: the first board render of the session, and whenever a
    // finished game comes back to life (rematch / next hand). Both P2P peers
    // derive the same finished→alive transition from the public outcome API,
    // so both wipe identically with no new message types.
    if (!irisDone || (lastRenderOver && !over)) { irisDone = true; irisBoard(); }
    lastRenderOver = over;

    const pill = $('#turn-pill');
    if (over) { pill.textContent = 'Finished'; pill.className = 'pill'; }
    else if (side === S.mySide) { pill.textContent = 'Your turn'; pill.className = 'pill mine'; }
    // trailing "…" left off: .pill.wait::after appends animated dots
    else if (S.mode === 'local') { pill.textContent = 'Computer is thinking'; pill.className = 'pill wait'; }
    else if (S.mode === 'p2p-host') { pill.textContent = 'Waiting for your opponent'; pill.className = 'pill wait'; }
    else { pill.textContent = 'Waiting for the host'; pill.className = 'pill wait'; }
    const pillKey = pill.className + '|' + pill.textContent;
    if (pillKey !== lastPillKey) {
      lastPillKey = pillKey;
      pill.classList.remove('pill-pop');
      void pill.offsetWidth; // reflow: restart the pulse
      pill.classList.add('pill-pop');
    }

    g.render(view, $('#board'), {
      mySide: S.mySide,
      interactive: !over && side === S.mySide,
      onMove: userMove
    });
    pumpEvents($('#board')); // SFX + particles for the view diff this render emitted

    const pEl = $('#players');
    pEl.innerHTML = '';
    if (g.renderInfo) g.renderInfo(view, pEl, { mySide: S.mySide });
  }

  /* ---------- moving ---------- */
  function canon(x) {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(canon);
    const o = {};
    Object.keys(x).sort().forEach((k) => { o[k] = canon(x[k]); });
    return o;
  }
  // key-order-insensitive move equality (guest renders must match host legalMoves)
  function sameMove(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

  function userMove(move) {
    if (!S || S.over) return;
    const g = S.game;
    if (S.mode === 'p2p-guest') { P2P.send({ t: 'move', move }); return; }
    const view = S.state;
    const side = g.currentSide(view);
    if (side !== S.mySide) return;
    if (!g.legalMoves(view, side).some((m) => sameMove(m, move))) return;
    g.applyMove(view, move);
    addLog(g.describeMove(view, move));
    afterMove();
  }

  function afterMove() {
    if (!S) return;
    if (botTimer !== null) { clearTimeout(botTimer); botTimer = null; }
    const g = S.game;
    const out = g.outcome(S.state);
    renderAll();
    if (out.over) {
      S.over = true;
      lastTurnSide = null;
      broadcastView();
      showResult(out.text, g);
      return;
    }
    const side = g.currentSide(S.state);
    // soft cue when the turn passes from me to the other side (one per exchange)
    if (lastTurnSide !== null && side !== null &&
        String(lastTurnSide) === String(S.mySide) && String(side) !== String(S.mySide)) {
      if (A && A.play) A.play('tick');
    }
    lastTurnSide = side;
    setIntensity(S.mode === 'p2p-guest' ? S.view : S.game.viewFor(S.state, S.mySide));
    broadcastView();
    if (S.mode === 'local' && side !== S.mySide) {
      botTimer = setTimeout(() => {
        botTimer = null;
        if (!S || S.over || S.mode !== 'local') return;
        if (g.currentSide(S.state) !== side) return; // state changed while the timer was pending
        const m = g.aiMove(S.state, side);
        if (!m) return;                              // no legal move for this side
        g.applyMove(S.state, m);
        addLog(g.describeMove(S.state, m));
        afterMove();
      }, 500);
    }
  }

  /* ---------- P2P messages ---------- */
  P2P.onMessage = (m) => {
    if (!S || !m || !m.t) return;
    const g = S.game;
    if (m.t === 'state') {                       // guest
      S.view = m.view;
      renderAll();
      // the opponent just moved and the turn is mine — soft cue
      const ns = g.currentSide(S.view);
      if (ns !== null && String(ns) === String(S.mySide) && lastTurnSide !== null && String(lastTurnSide) !== String(S.mySide)) {
        if (A && A.play) A.play('tick');
      }
      lastTurnSide = ns;
      setIntensity(S.view);
      const out = g.outcome(S.view);
      if (out.over) { S.over = true; showResult(out.text, g); }
      else if (S.over) { S.over = false; $('#overlay').classList.add('hidden'); }
    } else if (m.t === 'move') {                 // host
      if (S.over) return;
      const guestSide = otherSide(g, S.mySide);
      if (g.currentSide(S.state) !== guestSide) return;
      if (!g.legalMoves(S.state, guestSide).some((x) => sameMove(x, m.move))) return;
      g.applyMove(S.state, m.move);
      addLog(g.describeMove(S.state, m.move));
      afterMove();
    } else if (m.t === 'rematch') {              // host
      if (!S.over) return;                        // guests can only request after the game ends
      if (S.game.nextHand) beginNextHand(); else beginRematch();
    } else if (m.t === 'chat') {
      addChat('Opponent', m.text);
    }
  };

  /* ---------- results / rematch / leave ---------- */


  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* Confetti lives inside .overlay-card (overflow:hidden), so it can never
     escape the card. Skipped under reduced motion, and guarded for the Node
     click-test stub whose elements have no style object. */
  function confettiBurst(hostEl) {
    if (reducedMotion()) return;
    const probe = document.createElement('span');
    if (typeof probe.style !== 'object') return;
    const palette = ['#16683f', '#c29330', '#b04a33', '#2a466e', '#e6d9b8'];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.className = 'confetti';
      s.style.background = palette[i % palette.length];
      s.style.left = (4 + Math.random() * 92) + '%';
      if (i % 3 === 0) { s.style.width = '11px'; s.style.height = '6px'; } // wide slivers mixed in
      s.style.setProperty('--cx', ((Math.random() * 2 - 1) * 60) + 'px');
      s.style.setProperty('--cy', (160 + Math.random() * 160) + 'px');
      s.style.setProperty('--cr0', (Math.random() * 360) + 'deg');
      s.style.setProperty('--cr', (180 + Math.random() * 540) + 'deg');
      s.style.setProperty('--cd', (0.9 + Math.random() * 0.7) + 's');
      s.style.setProperty('--cdel', (Math.random() * 0.25) + 's');
      hostEl.appendChild(s);
      s.addEventListener('animationend', function () {
        if (s.parentNode) s.parentNode.removeChild(s);
      }, { once: true });
    }
    setTimeout(function () { // fallback sweep in case animationend never fires
      hostEl.querySelectorAll('.confetti').forEach(function (s) {
        if (s.parentNode) s.parentNode.removeChild(s);
      });
    }, 2200);
  }

  /* Win / lose / draw from the result text. Draws are shared text heuristics
     (draw / stalemate / a poker split pot); the win-vs-lose read belongs to
     each game: g.resultTone(text, mySide), via its sideName. */
  function resultTone(g, text) {
    if (/\bdraw\b/i.test(text)) return 'draw';
    if (text.indexOf('split') >= 0) return 'draw'; // poker split pot
    return g.resultTone ? g.resultTone(text, S.mySide) : 'lose';
  }

  function showResult(text, g) {
    const iconEl = $('#overlay-icon');
    if (iconEl) {
      const icon = g.resultIcon || '';
      iconEl.innerHTML = icon;
      iconEl.classList.toggle('hidden', !icon);
    }
    const fxEl = $('#overlay-fx');
    if (fxEl) {
      fxEl.innerHTML = '';
      if (g.confetti !== false) confettiBurst(fxEl); // poker hands end constantly: icon only
    }
    const title = $('#overlay-title');
    const label = g.nextHand ? 'Hand over' : 'Game over';
    // per-character entrance (styles.css .ot-char); spaces become nbsp so the
    // inline-block spans keep their width. The Node stub has no style object.
    title.innerHTML = '';
    if (title.style) title.style.animation = 'none'; // letters play instead of the h2 fade
    for (let i = 0; i < label.length; i++) {
      const sp = document.createElement('span');
      sp.className = 'ot-char';
      sp.textContent = label[i] === ' ' ? '\u00a0' : label[i];
      if (sp.style) sp.style.animationDelay = Math.min(i, 26) * 38 + 'ms';
      title.appendChild(sp);
    }
    $('#overlay-text').textContent = text;
    const primary = $('#overlay-primary');
    if (S.mode === 'p2p-guest') {
      primary.textContent = '↻ Start next round';
    } else {
      primary.textContent = g.nextHand ? 'Next hand →' : '↻ Rematch';
    }
    $('#overlay').classList.remove('hidden');
    if (typeof primary.focus === 'function') primary.focus();

    // fanfare: one SFX, then a tone-matched FX moment in the overlay's layer
    overlayFxLayer = F && F.attach ? (F.attach(fxEl) || null) : null;
    const tone = resultTone(g, text);
    // The board pump may have just played the mate/draw sting — don't double it
    // with the overlay tone (the fanfare FX below still plays).
    if (A && A.play && !pumpedResult) A.play(tone);
    if (A && A.music) A.music.stop(); // the game's scene ends here
    if (F && fxOn() && overlayFxLayer) {
      const w = (fxEl && typeof fxEl.clientWidth === 'number' && fxEl.clientWidth > 0) ? fxEl.clientWidth : 320;
      const h = (fxEl && typeof fxEl.clientHeight === 'number' && fxEl.clientHeight > 0) ? fxEl.clientHeight : 240;
      if (tone === 'win') {
        for (let i = 0; i < 3; i++) {
          F.burst('firework', Math.round(w * (0.2 + 0.3 * i)), Math.round(h * (0.25 + 0.15 * (i % 2))), { layer: overlayFxLayer, n: 36 });
        }
      } else if (tone === 'lose') {
        F.burst('smoke', Math.round(w / 2), Math.round(h * 0.4), { layer: overlayFxLayer, n: 24 });
      } else {
        F.burst('ring', Math.round(w / 2), Math.round(h * 0.45), { layer: overlayFxLayer });
      }
    }
  }

  $('#overlay-primary').addEventListener('click', () => {
    if (!S) return;
    if (S.mode === 'p2p-guest') { P2P.send({ t: 'rematch' }); return; }
    if (S.game.nextHand) beginNextHand(); else beginRematch();
  });
  $('#overlay-menu').addEventListener('click', leaveGame);

  $('#btn-rematch').addEventListener('click', () => {
    if (!S || !S.game) return;
    const g = S.game;
    const v = S.mode === 'p2p-guest' ? S.view : S.state;
    const out = v ? g.outcome(v) : { over: false };
    if (g.nextHand && !out.over && S.mode !== 'p2p-guest') return; // mid-hand: ignore
    if (S.mode === 'p2p-guest') P2P.send({ t: 'rematch' });
    else if (g.nextHand) beginNextHand(); else beginRematch();
  });

  function beginRematch() {
    if (!S) return;
    S.over = false;
    S.view = null;
    S.state = S.game.newState(S.configs);
    $('#log').innerHTML = '';
    $('#overlay').classList.add('hidden');
    addLog('New game started.');
    if (A && A.music) { A.music.stop(); A.music.start(S.gameId); } // resume the scene
    afterMove(); // broadcasts the new state
  }

  function beginNextHand() {
    if (!S || S.mode === 'p2p-guest' || !S.game.nextHand) return;
    if (!S.game.outcome(S.state).over) return;
    S.over = false;
    S.view = null;
    S.game.nextHand(S.state);
    $('#overlay').classList.add('hidden');
    addLog('New hand — dealer: ' + S.game.sideName(S.state.dealer != null ? String(S.state.dealer) : S.mySide));
    if (A && A.music) A.music.setIntensity(1); // new hand, back to calm
    afterMove(); // broadcasts the new state (re-renders the board fresh)
  }

  function leaveGame() {
    if (botTimer !== null) { clearTimeout(botTimer); botTimer = null; }
    P2P.close(); // the channel's onclose fires P2P.onFail → the disconnect chime
    S = null;
    lastTurnSide = null;
    boardFxLayer = null;
    overlayFxLayer = null;
    $('#overlay').classList.add('hidden');
    show('screen-menu');
    if (A && A.music) { A.music.stop(); A.music.start('menu'); }
  }
  $('#btn-leave').addEventListener('click', leaveGame);

  /* ---------- chat ---------- */
  function addChat(who, text) {
    const el = $('#chat-log');
    const div = document.createElement('div');
    div.className = 'entry';
    const b = document.createElement('b');
    b.textContent = who + ': ';
    div.appendChild(b);
    div.appendChild(document.createTextNode(text));
    el.appendChild(div);
    while (el.children.length > 100) el.removeChild(el.children[0]);
    el.scrollTop = el.scrollHeight;
  }
  function sendChat() {
    const input = $('#chat-in');
    const v = input.value.trim();
    if (!v || !S || S.mode === 'local') return;
    input.value = '';
    addChat('You', v);
    P2P.send({ t: 'chat', text: v });
  }
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  /* ---------- log ---------- */
  function addLog(text) {
    const el = $('#log');
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = text;
    el.appendChild(div);
    while (el.children.length > 80) el.removeChild(el.children[0]);
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- shell binding (main.js loads after fx/ and the games) ---------- */
  function init(o) { A = o.A; F = o.F; show = o.show; }

  const SESSION = {
    init: init,
    start: startSession,
    active: function () { return !!S; },
    setConn: setConn,
    log: addLog
  };
  global.SESSION = SESSION;
  if (typeof module !== 'undefined' && module.exports) module.exports = SESSION;
})(typeof window !== 'undefined' ? window : globalThis);

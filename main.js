/* main.js — The Parlor shell: menu, mode setup, local & P2P sessions.
 * Game modules register themselves on window.Games (see CONTRACT.md).
 *
 * P2P model: the HOST is authoritative. The guest sends {t:'move'} messages;
 * the host validates, applies, and broadcasts the guest's hidden-safe view.
 * The host is always sideList[0]; the guest is sideList[1].
 */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const Games = window.Games;

  let S = null;              // active session
  let selectedGame = null;   // game id on the setup screen

  /* ================= screens ================= */
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) =>
      s.classList.toggle('hidden', s.id !== id));
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.back)));

  /* ================= menu / setup ================= */
  document.querySelectorAll('.gcard').forEach((c) =>
    c.addEventListener('click', () => { selectedGame = c.dataset.game; openSetup(); }));

  function openSetup() {
    const g = Games[selectedGame];
    if (!g) return;
    $('#setup-title').textContent = g.title;
    $('#setup-desc').textContent = g.blurb || '';
    const sideRow = $('#setup-side');
    sideRow.innerHTML = '';
    sideRow.dataset.choice = g.sideList[0];
    if (g.pickSide) {
      sideRow.classList.remove('hidden');
      const lbl = document.createElement('span');
      lbl.className = 'muted';
      lbl.textContent = 'Play as:';
      sideRow.appendChild(lbl);
      g.sideList.forEach((s) => {
        const b = document.createElement('button');
        b.className = 'btn side-opt';
        b.textContent = g.sideName(s);
        if (s === g.sideList[0]) b.classList.add('active');
        b.onclick = () => {
          sideRow.querySelectorAll('.side-opt').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          sideRow.dataset.choice = s;
        };
        sideRow.appendChild(b);
      });
    } else {
      sideRow.classList.add('hidden');
    }
    show('screen-setup');
  }

  $('#btn-local').addEventListener('click', () => {
    const g = Games[selectedGame];
    const side = (g.pickSide ? $('#setup-side').dataset.choice : g.sideList[0]) || g.sideList[0];
    startSession(selectedGame, 'local', side);
  });

  $('#btn-p2p').addEventListener('click', () => { resetConnectUI(); show('screen-connect'); });

  /* ================= connect screen ================= */
  let connRole = null; // 'host' | 'guest'

  function setConnTab(r) {
    connRole = r;
    $('#tab-host').classList.toggle('active', r === 'host');
    $('#tab-guest').classList.toggle('active', r === 'guest');
    $('#host-box').classList.toggle('hidden', r !== 'host');
    $('#guest-box').classList.toggle('hidden', r !== 'guest');
    setConnectStatus('');
  }
  $('#tab-host').addEventListener('click', () => setConnTab('host'));
  $('#tab-guest').addEventListener('click', () => setConnTab('guest'));

  function resetConnectUI() {
    setConnTab('host');
    $('#offer-out').value = ''; $('#answer-in').value = '';
    $('#offer-in').value = ''; $('#answer-out').value = '';
    $('#btn-accept').disabled = true; $('#copy-offer').disabled = true; $('#copy-answer').disabled = true;
    $('#btn-create').disabled = false; $('#btn-join').disabled = false;
  }
  function setConnectStatus(t) { $('#connect-status').textContent = t; }

  function copyText(btn, area) {
    const txt = area.value;
    if (!txt) return;
    const done = () => { const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = o; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => { area.select(); document.execCommand('copy'); done(); });
    } else { area.select(); document.execCommand('copy'); done(); }
  }

  $('#btn-create').addEventListener('click', async () => {
    $('#btn-create').disabled = true;
    setConnectStatus('Creating room…');
    try {
      const offer = await P2P.host();
      $('#offer-out').value = offer;
      $('#btn-accept').disabled = false;
      $('#copy-offer').disabled = false;
      setConnectStatus('Room created. Send the room code to your friend, then paste their answer code below.');
    } catch (e) {
      setConnectStatus('✕ ' + (e && e.message ? e.message : e));
    } finally { $('#btn-create').disabled = false; }
  });

  $('#copy-offer').addEventListener('click', () => copyText($('#copy-offer'), $('#offer-out')));

  $('#btn-accept').addEventListener('click', async () => {
    setConnectStatus('Connecting…');
    try {
      await P2P.acceptAnswer($('#answer-in').value);
      setConnectStatus('Connected! Starting the game…');
    } catch (e) {
      setConnectStatus('✕ That answer code doesn\'t look right. ' + (e && e.message ? e.message : e));
    }
  });

  $('#btn-join').addEventListener('click', async () => {
    $('#btn-join').disabled = true;
    setConnectStatus('Generating your answer code…');
    try {
      const answer = await P2P.join($('#offer-in').value);
      $('#answer-out').value = answer;
      $('#copy-answer').disabled = false;
      setConnectStatus('Send the answer code back to your friend. Waiting for the connection…');
    } catch (e) {
      setConnectStatus('✕ That room code doesn\'t look right. ' + (e && e.message ? e.message : e));
    } finally { $('#btn-join').disabled = false; }
  });

  $('#copy-answer').addEventListener('click', () => copyText($('#copy-answer'), $('#answer-out')));

  P2P.onOpen = () => {
    if (selectedGame && !S) {
      const g = Games[selectedGame];
      const mode = P2P.role === 'host' ? 'p2p-host' : 'p2p-guest';
      const side = mode === 'p2p-host' ? g.sideList[0] : g.sideList[1];
      startSession(selectedGame, mode, side);
    }
  };
  P2P.onFail = (msg) => {
    if (S) { setConn(null); addLog('✕ ' + msg); }
    else setConnectStatus('✕ ' + msg);
  };

  /* ================= sessions ================= */
  function configsFor(g, mode) {
    if (mode !== 'local') return [{ kind: 'human' }, { kind: 'human' }];
    if (g.id === 'uno' || g.id === 'poker') {
      return [{ kind: 'human' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }];
    }
    return null;
  }

  function otherSide(g, side) {
    if (g.sideList.length === 2) return g.sideList[0] === side ? g.sideList[1] : g.sideList[0];
    return side === '0' ? '1' : '0'; // seated games in P2P: seats 0 and 1
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
      st.textContent = g.css;
    }

    const side = g.currentSide(view);
    const over = g.outcome(view).over;
    const pill = $('#turn-pill');
    if (over) { pill.textContent = 'Finished'; pill.className = 'pill'; }
    else if (side === S.mySide) { pill.textContent = 'Your turn'; pill.className = 'pill mine'; }
    // trailing "…" left off: .pill.wait::after appends animated dots
    else if (S.mode === 'local') { pill.textContent = 'Computer is thinking'; pill.className = 'pill wait'; }
    else if (S.mode === 'p2p-host') { pill.textContent = 'Waiting for your opponent'; pill.className = 'pill wait'; }
    else { pill.textContent = 'Waiting for the host'; pill.className = 'pill wait'; }

    g.render(view, $('#board'), {
      mySide: S.mySide,
      interactive: !over && side === S.mySide && S.mode !== 'p2p-guest-waiting',
      onMove: userMove
    });

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
    const g = S.game;
    const out = g.outcome(S.state);
    renderAll();
    if (out.over) {
      S.over = true;
      broadcastView();
      showResult(out.text, g);
      return;
    }
    broadcastView();
    const side = g.currentSide(S.state);
    if (S.mode === 'local' && side !== S.mySide) {
      setTimeout(() => {
        if (!S || S.over || S.mode !== 'local') return;
        const m = g.aiMove(S.state, side);
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
      if (S.game.nextHand) beginNextHand(); else beginRematch();
    } else if (m.t === 'chat') {
      addChat('Opponent', m.text);
    }
  };

  /* ---------- results / rematch / leave ---------- */
  /* Result icons reuse the menu-card motif marks (editorial ink, no emoji):
     the serif glyph, the disc pair, the four-ink dots. */
  const RESULT_ICON = {
    chess: '<span class="gicon-glyph">\u265e</span>',
    checkers: '<span class="gicon-discs"><i></i><i></i></span>',
    uno: '<span class="gicon-dots"><i></i><i></i><i></i><i></i></span>',
    poker: '<span class="gicon-glyph">\u2660</span>'
  };

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

  function showResult(text, g) {
    const iconEl = $('#overlay-icon');
    if (iconEl) {
      const icon = RESULT_ICON[g.id] || '';
      iconEl.innerHTML = icon;
      iconEl.classList.toggle('hidden', !icon);
    }
    const fxEl = $('#overlay-fx');
    if (fxEl) {
      fxEl.innerHTML = '';
      if (g.id !== 'poker') confettiBurst(fxEl); // poker hands end constantly: icon only
    }
    $('#overlay-title').textContent = g.id === 'poker' ? 'Hand over' : 'Game over';
    $('#overlay-text').textContent = text;
    const primary = $('#overlay-primary');
    if (S.mode === 'p2p-guest') {
      primary.textContent = '↻ Start next round';
    } else {
      primary.textContent = g.nextHand ? 'Next hand →' : '↻ Rematch';
    }
    $('#overlay').classList.remove('hidden');
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
    broadcastView();
    afterMove();
  }

  function beginNextHand() {
    if (!S || S.mode === 'p2p-guest' || !S.game.nextHand) return;
    if (!S.game.outcome(S.state).over) return;
    S.over = false;
    S.view = null;
    S.game.nextHand(S.state);
    $('#overlay').classList.add('hidden');
    addLog('New hand — dealer: ' + S.game.sideName(S.state.dealer != null ? String(S.state.dealer) : S.mySide));
    broadcastView();
    afterMove();
  }

  function leaveGame() {
    P2P.close();
    S = null;
    $('#overlay').classList.add('hidden');
    show('screen-menu');
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
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- boot ---------- */
  if (!window.Games || Object.keys(window.Games).length === 0) {
    console.warn('The Parlor: no game modules loaded.');
  }
  show('screen-menu');
})();

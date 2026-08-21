/* main.js — The Parlor shell: menu, mode setup, connect, audio UI, spotlight,
 * boot. The session state machine lives in core/session.js (window.SESSION).
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
  let selectedGame = null;   // game id on the setup screen

  const A = window.AUDIO;
  const F = window.FX;
  let audioUnlocked = false; // Web Audio may only start after a user gesture

  // First pointer/click anywhere: unlock audio (autoplay policy), then let the
  // menu music in a beat later. Idempotent; a no-op in the Node click-test.
  function unlockAudio() {
    if (audioUnlocked || !A || typeof A.ensure !== 'function') return;
    audioUnlocked = true;
    A.ensure();
    window.setTimeout(() => { if (A && !S) A.music.start('menu'); }, 300);
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('click', unlockAudio, { once: true });
  /* ================= screens ================= */
  // Screen depth order: forward moves (menu→setup→game) slide in from the
  // right, back moves (any [data-back] / leave) slide in from the left.
  const SCREEN_ORDER = { 'screen-menu': 0, 'screen-setup': 1, 'screen-connect': 1, 'screen-game': 2 };
  function show(id) {
    let cur = null;
    document.querySelectorAll('.screen').forEach((s) => {
      if (!s.classList.contains('hidden')) cur = s.id;
    });
    const fwd = (SCREEN_ORDER[id] || 0) > (SCREEN_ORDER[cur] || -1);
    document.querySelectorAll('.screen').forEach((s) => {
      if (s.id === id) {
        s.classList.remove('fwd', 'back');
        void s.offsetWidth; // reflow: force the entry animation to restart
        s.classList.add(fwd ? 'fwd' : 'back');
      }
      s.classList.toggle('hidden', s.id !== id);
    });
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
    SESSION.start(selectedGame, 'local', side);
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
    if (A && A.play) A.play('connect');
    if (selectedGame && !SESSION.active()) {
      const g = Games[selectedGame];
      const mode = P2P.role === 'host' ? 'p2p-host' : 'p2p-guest';
      const side = mode === 'p2p-host' ? g.sideList[0] : g.sideList[1];
      SESSION.start(selectedGame, mode, side);
    }
  };
  P2P.onFail = (msg) => {
    if (A && A.play) A.play('disconnect');
    if (SESSION.active()) { SESSION.setConn(null); SESSION.log('✕ ' + msg); }
    else setConnectStatus('✕ ' + msg);
  };

  /* ---------- audio UI (topbar popover; settings live in fx/audio.js) ----------
     The popover only exists in the real DOM; every hook below is null-guarded
     so the Node click-test stub (which has no topbar audio elements) skips it. */
  const btnSound = $('#btn-sound');
  const audioPop = $('#audio-pop');
  const audioUi = $('#audio-ui');

  function audioUIState() {
    if (!A || !btnSound || !audioUi) return;
    const muted = A.muted();
    btnSound.classList.toggle('muted', muted);
    audioUi.classList.toggle('muted', muted);
    audioUi.classList.toggle('music-on', !muted && A.musicOn() && !!(A.music && A.music.playing));
    if (btnSound.setAttribute) {
      btnSound.setAttribute('aria-label', muted ? 'Unmute sound' : 'Adjust sound');
      btnSound.setAttribute('aria-expanded',
        String(!!audioPop && !audioPop.classList.contains('hidden')));
    }
  }

  if (btnSound && audioPop) {
    btnSound.addEventListener('click', (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      audioPop.classList.toggle('hidden');
      audioUIState();
    });
    if (document.addEventListener) document.addEventListener('click', (e) => {
      if (audioPop.classList.contains('hidden')) return;
      const t = e && e.target;
      const inPop = audioPop.contains ? audioPop.contains(t) : true;
      const inBtn = btnSound.contains ? btnSound.contains(t) : true;
      if (!inPop && !inBtn) { audioPop.classList.add('hidden'); audioUIState(); }
    });
  }
  if (A && btnSound && audioPop) {
    const vol = $('#audio-vol');
    if (vol) {
      vol.value = String(Math.round(A.volume() * 100));
      vol.addEventListener('input', () => { A.setVolume((parseInt(vol.value, 10) || 0) / 100); });
    }
    const mus = $('#audio-music');
    if (mus) {
      mus.checked = A.musicOn();
      mus.addEventListener('change', () => { A.setMusicOn(!!mus.checked); audioUIState(); });
    }
    const sfx = $('#audio-sfx');
    if (sfx) {
      sfx.checked = A.sfxOn();
      sfx.addEventListener('change', () => {
        A.setSfxOn(!!sfx.checked);
        if (F) F.setEnabled(!!sfx.checked);
        audioUIState();
      });
    }
    if (A.music) A.music.onchange = () => audioUIState();
    audioUIState();
  }

  /* ---------- menu micro-interaction: cursor spotlight ----------
   * One delegated pointermove on the card grid; the hovered card's --mx/--my
   * custom props (consumed by .gcard::before) update at most once per frame
   * via rAF. Presentation only: null-guarded so the Node click-test (no rAF,
   * no getBoundingClientRect, no style) skips every step. */
  const cardsEl = $('#screen-menu .cards');
  if (cardsEl && cardsEl.addEventListener) {
    let spCard = null, spX = 0, spY = 0, spRaf = 0;
    const spApply = () => {
      spRaf = 0;
      const c = spCard;
      spCard = null;
      if (!c || !c.style || !c.style.setProperty || typeof c.getBoundingClientRect !== 'function') return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (spX - r.left) + 'px');
      c.style.setProperty('--my', (spY - r.top) + 'px');
    };
    cardsEl.addEventListener('pointermove', (e) => {
      const t = e && e.target;
      const c = t && t.closest ? t.closest('.gcard') : null;
      if (!c) { spCard = null; return; }
      spCard = c;
      spX = (e.clientX || 0);
      spY = (e.clientY || 0);
      if (typeof requestAnimationFrame === 'function') {
        if (!spRaf) spRaf = requestAnimationFrame(spApply);
      } else {
        spApply();
      }
    });
  }

  /* ---------- boot ---------- */
  if (!window.Games || Object.keys(window.Games).length === 0) {
    console.warn('The Parlor: no game modules loaded.');
  }
  SESSION.init({ A: window.AUDIO, F: window.FX, show: show });
  show('screen-menu');
})();

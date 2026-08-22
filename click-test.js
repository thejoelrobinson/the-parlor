/* click-test.js — headless click-through harness for The Parlor.
 *
 * Loads p2p.js + the four game modules + main.js against a minimal DOM stub
 * and plays every game in local mode exactly the way a user does: click the
 * game card, pick a side, click "Play vs Computer", then click pieces /
 * cards / buttons in the rendered board until the game (or hand) ends.
 *
 * After EVERY user click it asserts the rendered view actually changed.
 * The previous harness called onMove() directly and never touched the DOM,
 * which is how the stale-closure selection bug (tap-to-move dead in chess &
 * checkers) and the undefined build() (UNO wild cards) could ship.
 *
 * Run: node click-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------- deterministic RNG ---------------- */
let seed = 1;
function reseed(base) { seed = (base * 2654435761) >>> 0; }
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------------- DOM stub ---------------- */
const IdRegistry = new Map();

function parseSimple(s) {
  const out = { tag: null, classes: [] };
  let rest = s;
  const tm = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tm) { out.tag = tm[0].toUpperCase(); rest = rest.slice(tm[0].length); }
  while (rest.startsWith('.')) {
    const cm = rest.match(/^\.[a-zA-Z0-9_-]+/);
    if (!cm) break;
    out.classes.push(cm[0].slice(1));
    rest = rest.slice(cm[0].length);
  }
  if (rest !== '') throw new Error('selector stub cannot parse: ' + s);
  return out;
}

function matchSimple(el, s) {
  s = s.trim();
  if (s[0] === '#') return el.id === s.slice(1);
  if (s[0] === '[') {
    const m = s.match(/^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/);
    if (!m) throw new Error('selector stub cannot parse: ' + s);
    if (!el.dataset) return false;
    let v = el.dataset[m[1]];
    if (v === undefined && m[1].startsWith('data-')) v = el.dataset[m[1].slice(5)];
    return m[2] === undefined ? v !== undefined : v === m[2];
  }
  if (!el.classList) return false; // text node
  const p = parseSimple(s);
  if (p.tag && el.tagName !== p.tag) return false;
  return p.classes.every((c) => el.classList.contains(c));
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.min = '';
    this.max = '';
    this._id = '';
    this._html = '';
    this.parentNode = null;
    this.listeners = Object.create(null);
    this.attrs = Object.create(null);
    this.classList = {
      add: (...cs) => { const set = new Set(this._cs()); for (const c of cs) set.add(c); this.className = [...set].join(' '); },
      remove: (...cs) => { const set = new Set(this._cs()); for (const c of cs) set.delete(c); this.className = [...set].join(' '); },
      contains: (c) => this._cs().includes(c),
      toggle: (c, force) => {
        const has = this._cs().includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) { const set = new Set(this._cs()); set.add(c); this.className = [...set].join(' '); }
        else if (!want && has) { const set = new Set(this._cs()); set.delete(c); this.className = [...set].join(' '); }
        return want;
      }
    };
  }
  _cs() { return (this.className || '').split(/\s+/).filter(Boolean); }
  set id(v) { const s = String(v); this._id = s; if (s) IdRegistry.set(s, this); }
  get id() { return this._id; }
  set innerHTML(v) { this._html = String(v); if (this._html === '') this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const ls = this.listeners[t]; if (ls) this.listeners[t] = ls.filter((f) => f !== fn); }
  dispatch(t, ev) {
    const e = ev || { type: t, target: this };
    if (typeof this['on' + t] === 'function') this['on' + t](e);
    const ls = this.listeners[t];
    if (ls) for (const fn of ls.slice()) fn(e);
  }
  click() { this.dispatch('click'); }
  setAttribute(k, v) { this.attrs[String(k)] = String(v); }
  getAttribute(k) { const v = this.attrs[String(k)]; return v === undefined ? null : v; }
  removeAttribute(k) { delete this.attrs[String(k)]; }
  all() {
    const out = [];
    const walk = (e) => { for (const c of e.children) { out.push(c); if (c.children) walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) {
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const e of this.all()) {
      if (seen.has(e)) continue;
      if (parts.some((p) => matchSimple(e, p))) { out.push(e); seen.add(e); }
    }
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

const body = new El('body');
const head = new El('head');
const docListeners = Object.create(null);

globalThis.document = {
  body,
  head,
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  getElementById: (id) => IdRegistry.get(String(id)) || null,
  querySelector: (s) => body.querySelector(s) || head.querySelector(s),
  querySelectorAll: (s) => body.querySelectorAll(s).concat(head.querySelectorAll(s)),
  execCommand: () => true,
  // main.js registers one-time pointer/click listeners for audio unlock.
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  removeEventListener: (t, fn) => {
    const ls = docListeners[t];
    if (ls) docListeners[t] = ls.filter((f) => f !== fn);
  },
  dispatch: (t, ev) => {
    const ls = docListeners[t];
    if (ls) for (const fn of ls.slice()) fn(ev || { type: t, target: null });
  }
};

globalThis.window = globalThis;
globalThis.scrollTo = () => {};
// AI chains resolve synchronously inside the user's click (production delays are
// presentation-only; the state transitions are identical).
globalThis.setTimeout = (fn) => { fn(); return 0; };

/* ---------------- static skeleton (mirrors index.html) ---------------- */
function mk(tag, id, cls, extra) {
  const e = new El(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  if (extra) Object.assign(e, extra);
  return e;
}
function add(parent, e) { parent.appendChild(e); return e; }

for (const id of ['screen-menu', 'screen-setup', 'screen-connect', 'screen-game']) {
  add(body, mk('section', id, 'screen hidden'));
}
for (const g of ['chess', 'checkers', 'uno', 'poker', 'catan']) {
  add(body, mk('div', null, 'gcard', { dataset: { game: g } }));
}
// setup screen
add(body, mk('div', 'setup-title'));
add(body, mk('div', 'setup-desc'));
add(body, mk('div', 'setup-side', 'side-row'));
add(body, mk('button', 'btn-local', 'btn'));
add(body, mk('button', 'btn-p2p', 'btn'));
add(body, mk('button', null, 'btn', { dataset: { back: 'screen-menu' } }));
// connect screen
add(body, mk('button', 'tab-host', 'btn'));
add(body, mk('button', 'tab-guest', 'btn'));
add(body, mk('div', 'host-box'));
add(body, mk('div', 'guest-box'));
add(body, mk('textarea', 'offer-out'));
add(body, mk('textarea', 'answer-in'));
add(body, mk('textarea', 'offer-in'));
add(body, mk('textarea', 'answer-out'));
for (const id of ['btn-accept', 'copy-offer', 'copy-answer', 'btn-create', 'btn-join']) add(body, mk('button', id, 'btn'));
add(body, mk('div', 'connect-status'));
// game screen
add(body, mk('div', 'game-title'));
add(body, mk('div', 'turn-pill', 'pill'));
add(body, mk('div', 'game-hint'));
add(body, mk('button', 'btn-rematch', 'btn'));
add(body, mk('button', 'btn-leave', 'btn'));
add(body, mk('div', 'board'));
add(body, mk('div', 'players'));
add(body, mk('div', 'log'));
add(body, mk('div', 'chat-log'));
const chatBox = add(body, mk('div', 'chat-box'));
add(chatBox, mk('input', 'chat-in'));
add(chatBox, mk('button', 'chat-send', 'btn'));
add(body, mk('div', 'conn-pill', 'pill hidden'));
// topbar audio controls (mirror index.html; wired in phase 2)
const audioUi = add(body, mk('div', 'audio-ui', 'audio-ui'));
add(audioUi, mk('button', 'btn-sound', 'audio-btn'));
const eq = add(audioUi, mk('span', null, 'eq'));
for (let i = 0; i < 3; i++) add(eq, mk('i'));
const audioPop = add(body, mk('div', 'audio-pop', 'audio-pop hidden'));
add(audioPop, mk('input', 'audio-vol', null, { type: 'range', min: '0', max: '100', value: '80' }));
add(audioPop, mk('input', 'audio-music', null, { type: 'checkbox' }));
add(audioPop, mk('input', 'audio-sfx', null, { type: 'checkbox' }));
// overlay
const overlay = add(body, mk('div', 'overlay', 'overlay hidden'));
add(overlay, mk('div', 'overlay-icon', 'overlay-icon hidden'));
add(overlay, mk('div', 'overlay-title'));
add(overlay, mk('div', 'overlay-text'));
add(overlay, mk('button', 'overlay-primary', 'btn'));
add(overlay, mk('button', 'overlay-menu', 'btn'));
add(overlay, mk('div', 'overlay-fx', 'overlay-fx'));

/* ---------------- load the app (same order as index.html) ---------------- */
function load(rel) {
  const f = path.join(__dirname, rel);
  vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}
load('core/ui.js');
load('core/p2p.js');
load('core/session.js');
load('games/chess/logic.js');
load('games/chess/view.js');
load('games/chess/index.js');
load('games/checkers/logic.js');
load('games/checkers/view.js');
load('games/checkers/index.js');
load('games/uno/logic.js');
load('games/uno/view.js');
load('games/uno/index.js');
load('games/poker/logic.js');
load('games/poker/view.js');
load('games/poker/index.js');
load('games/catan/logic.js');
load('games/catan/view.js');
load('games/catan/index.js');
load('fx/audio.js');
load('fx/fx.js');
load('main.js');

if (!globalThis.Games || Object.keys(globalThis.Games).length < 4) {
  throw new Error('game modules did not register on window.Games');
}

/* ---------------- fx/audio spy ----------------
 * fx/audio.js and fx/fx.js load before main.js (same order as index.html),
 * so main.js's `A`/`F` constants are the real modules. In this stub both
 * are inert internally (no AudioContext, no canvas 2d context), so we wrap
 * the exported properties to record what the presentation layer asked for.
 * That is exactly the pumpEvents → FX_EVENTS wiring in main.js. Particle
 * kind behavior itself is covered by fx-test.js with a fake 2d context. */
const AUD = globalThis.AUDIO;
const FXM = globalThis.FX;
if (!AUD || !FXM) throw new Error('fx modules did not register (window.AUDIO / window.FX missing)');
const fxLog = { sfx: [], music: [], intensity: [], attaches: 0 };
function fxReset() {
  fxLog.sfx.length = 0; fxLog.music.length = 0; fxLog.intensity.length = 0; fxLog.attaches = 0;
}
function fxCount(list, name) { let c = 0; for (const x of list) if (x === name) c++; return c; }
(function () {
  const _play = AUD.play;
  AUD.play = function (nm) { fxLog.sfx.push(nm); return _play.apply(this, arguments); };
  const _start = AUD.music.start;
  AUD.music.start = function (sc) { fxLog.music.push('start:' + sc); return _start.apply(this, arguments); };
  const _stop = AUD.music.stop;
  AUD.music.stop = function () { fxLog.music.push('stop'); return _stop.apply(this, arguments); };
  const _int = AUD.music.setIntensity;
  AUD.music.setIntensity = function (lvl) { fxLog.intensity.push(lvl); return _int.apply(this, arguments); };
  const _attach = FXM.attach;
  FXM.attach = function (c) { fxLog.attaches++; return _attach.apply(this, arguments); };
})();

/* ---------------- click drivers (the real UI path) ---------------- */
const $id = (id) => document.getElementById(id);
const boardEl = () => $id('board');
const pillText = () => $id('turn-pill').textContent;
const overlayVisible = () => !$id('overlay').classList.contains('hidden');
const showing = (id) => !document.getElementById(id).classList.contains('hidden');

function clickBoard(gameId) {
  const board = boardEl();
  const cls = gameId === 'chess' ? 'chess-sq' : 'chk-sq';
  const own = board.querySelectorAll('.' + cls).filter((sq) => sq.classList.contains('own'));
  if (!own.length) throw new Error(gameId + ': no clickable .own squares on my turn — tap input dead');
  for (const start of own) {
    start.click(); // select
    const tgts = board.querySelectorAll('.' + cls).filter((sq) => sq.classList.contains('tgt'));
    if (tgts.length) {
      pick(tgts).click();
      const bars = boardEl().querySelectorAll('.chess-promo');
      if (bars.length) {
        const promoBtns = bars[0].querySelectorAll('.btn');
        if (promoBtns.length) promoBtns[0].click(); // promotion picker: first = queen (old auto-queen outcome)
      }
      return;
    }
    start.click(); // no targets from this piece — deselect, try the next one
  }
  throw new Error(gameId + ': selecting every own piece produced no targets — tap input dead');
}

function clickUno() {
  const board = boardEl();
  const cards = board.querySelectorAll('.uno-card.can');
  const nonWhite = cards.filter((c) => !c.classList.contains('w'));
  const pool = nonWhite.length ? nonWhite : cards;
  if (pool.length) {
    pick(pool).click();
    const suits = board.querySelectorAll('.uno-suitbtn');
    if (suits.length) pick(suits).click(); // white card: pick a suit
    return;
  }
  const btns = board.querySelectorAll('.btn').filter((b) => b.classList.contains('big'));
  const draw = btns.find((b) => b.textContent.indexOf('Draw') >= 0);
  const pass = btns.find((b) => b.textContent.indexOf('Pass') >= 0);
  if (draw) { draw.click(); return; }
  if (pass) { pass.click(); return; }
  throw new Error('uno: no playable action in the DOM on my turn');
}

function clickPoker() {
  const bar = boardEl().querySelector('.pkr-actions');
  if (!bar) throw new Error('poker: no .pkr-actions on my turn');
  const btns = bar.querySelectorAll('.btn');
  const t = (b) => b.textContent;
  const b =
    btns.find((x) => /^Check$/.test(t(x))) ||
    btns.find((x) => /^Call /.test(t(x))) ||
    btns.find((x) => /^Min /.test(t(x))) ||
    btns.find((x) => /^Fold$/.test(t(x)));
  if (!b) throw new Error('poker: no action button in the DOM');
  b.click();
}

function clickCatan() {
  const board = boardEl();
  // 1. MANDATORY while a 7 (or a played knight) awaits: place the robber. It
  //    is the ONLY legal move then, so it must outrank every other control.
  const robHex = board.querySelectorAll('.cat-hex').find((e) => e.classList.contains('robber-can'));
  if (robHex) { robHex.click(); return; }
  // 2. Answer a standing player-to-player trade offer (we are the recipient):
  //    accept when we can afford the want, else decline (decline is always legal).
  const accept = board.querySelector('.cat-pto-accept');
  if (accept && accept.classList.contains('can')) { accept.click(); return; }
  const decline = board.querySelector('.cat-pto-decline');
  if (decline && decline.classList.contains('can')) { decline.click(); return; }
  // 3. Upgrade a settlement to a city (2 VP).
  const cityCan = board.querySelectorAll('.cat-site').find((e) => e.classList.contains('city-can'));
  if (cityCan) { cityCan.click(); return; }
  // 4. Build a settlement/road (1 VP / expansion).
  const build = board.querySelectorAll('.cat-site.can')[0];
  if (build) { build.click(); return; }
  // 5. Trade 4:1 with the bank.
  const trade = board.querySelectorAll('.cat-trade.can')[0];
  if (trade) { trade.click(); return; }
  // 6. Build a road — the setup road step (S,S,R,R) requires it, and it
  //    expands territory in play.
  const edge = board.querySelectorAll('.cat-edge.can')[0];
  if (edge) { edge.click(); return; }
  // 7. End the turn.
  const end = board.querySelector('.cat-end');
  if (end) { end.click(); return; }
  throw new Error('catan: no actionable control rendered on my turn');
}

/* ---------------- play one full session ---------------- */
function playGame(spec, side, seedBase) {
  reseed(seedBase);
  const g = globalThis.Games[spec.game];

  // capture every view handed to the real renderer
  const origRender = g.render;
  const cap = { last: null };
  g.render = (view, el, opts) => { cap.last = { view, opts }; return origRender(view, el, opts); };

  // count plain road moves (setup roads ride along with the site move and never emit one)
  let roadMoves = 0;
  const origApply = g.applyMove;
  g.applyMove = (st, m) => { if (m && (m.type === 'road' || m.type === 'play-road')) roadMoves++; return origApply(st, m); };

  // menu → setup → Play vs Computer, all via real DOM clicks
  const card = document.querySelectorAll('.gcard').find((x) => x.dataset.game === spec.game);
  if (!card) throw new Error('no .gcard for ' + spec.game);
  card.click();
  if (g.pickSide) {
    const opts = $id('setup-side').querySelectorAll('.side-opt');
    const want = g.sideName(side);
    const b = opts.find((x) => x.textContent === want);
    if (!b) throw new Error('side-opt button not found for ' + want);
    b.click();
  }
  $id('btn-local').click();

  if (!showing('screen-game')) throw new Error('game screen not shown after btn-local click');
  if (!cap.last) throw new Error('no render call after startSession');

  let plies = 0;
  let hands = 0;
  let rematched = false;
  let iters = 0;
  const handsLimit = spec.hands || 0;
  let how = 'over';

  while (iters++ < 5000) {
    if (overlayVisible()) {
      if (spec.game === 'poker') {
        if (++hands >= handsLimit) { how = 'hands-limit'; break; }
        $id('overlay-primary').click(); // 'Next hand →'
        continue;
      }
      if (!rematched) {
        rematched = true;
        $id('overlay-primary').click(); // '↻ Rematch' — exercises beginRematch
        continue;
      }
      break; // second game over → leave
    }
    const t = pillText();
    if (t.indexOf('Your turn') < 0) {
      if (t.indexOf('Finished') >= 0) continue;
      throw new Error(spec.game + ': stuck on non-actionable pill: "' + t + '"');
    }
    const before = cap.last ? JSON.stringify(cap.last.view) : null;
    if (spec.game === 'chess' || spec.game === 'checkers') clickBoard(spec.game);
    else if (spec.game === 'uno') clickUno();
    else if (spec.game === 'catan') clickCatan();
    else clickPoker();
    if (!cap.last) throw new Error(spec.game + ': no render after click');
    const after = JSON.stringify(cap.last.view);
    if (before !== null && after === before) {
      throw new Error(spec.game + ': user click produced no state change — input dead?');
    }
    plies++;
    if (plies >= spec.plies) { how = 'ply-cap'; break; }
  }

  // leave via the real button and confirm we're back at the menu
  $id('overlay-menu').click();
  if (showing('overlay')) throw new Error('overlay still visible after leave');
  if (!showing('screen-menu')) throw new Error('did not return to menu after leave');

  return { plies, hands, how, rematched, roadMoves };
}

/* ---------------- run matrix ---------------- */
const RUNS = [
  { game: 'chess', sides: ['white', 'black'], plies: 400, seeds: 2 },
  { game: 'checkers', sides: ['red', 'black'], plies: 300, seeds: 2 },
  { game: 'uno', sides: ['0'], plies: 600, seeds: 2 },
  { game: 'poker', sides: ['0'], hands: 3, plies: 400, seeds: 2 },
  { game: 'catan', sides: ['0', '1'], plies: 300, seeds: 2 }
];

let failures = 0;
let n = 0;

/* ---------------- chess capture click-through ----------------
 * Regression for "pieces/pawns can't attack": the engine must generate
 * captures AND the UI must show the capture affordance (.tgt + .occ ring)
 * on the occupied target before the capture click is accepted.
 * We inject a fixed position by wrapping g.newState (main.js calls it at
 * session start), then play the capture with real DOM clicks. */
function chessCaptureRun(pairs, fromName, toName, capPiece, label) {
  const g = globalThis.Games.chess;
  const F = 'abcdefgh';
  const sq = (n) => (8 - parseInt(n[1], 10)) * 8 + F.indexOf(n[0]);

  const base = g.newState();
  const pos = JSON.parse(JSON.stringify(base));
  pos.board = new Array(64).fill(null);
  for (const [name, p, c] of pairs) pos.board[sq(name)] = { p: p, c: c };
  pos.castling = { wK: false, wQ: false, bK: false, bQ: false };
  pos.ep = -1;
  pos.turn = 'white';

  const origRender = g.render;
  const cap = { last: null, n: 0 };
  let oLM = null, oAM = null, oCS = null;
  g.render = (view, el, opts) => {
    cap.last = { view: view };
    cap.n++;
    if (process.env.DBG_CAP) {
      const occ = [];
      view.board.forEach((p, i) => { if (p) occ.push(i + ':' + p.p + p.c); });
      console.error('[DBG] render#' + cap.n + ' pill=' + JSON.stringify(pillText()) + ' turn=' + view.turn + ' mySide=' + (opts && opts.mySide) + ' interactive=' + (opts && opts.interactive) + ' occ=' + occ.join(' '));
    }
    return origRender(view, el, opts);
  };
  const origNewState = g.newState;
  g.newState = () => JSON.parse(JSON.stringify(pos));
  if (process.env.DBG_CAP) {
    oLM = g.legalMoves; oAM = g.applyMove; oCS = g.currentSide;
    g.legalMoves = (v, s) => { const r = oLM(v, s); console.error('[DBG] legalMoves(' + s + ') ->', JSON.stringify(r)); return r; };
    g.applyMove = (v, m) => { console.error('[DBG] applyMove', JSON.stringify(m)); return oAM(v, m); };
    g.currentSide = (v) => { const r = oCS(v); console.error('[DBG] currentSide ->', r, 'turn=', v && v.turn); return r; };
  }
  try {
    fxReset(); // this session's sfx log starts clean (boot menu music predates the spy)
    const card = document.querySelectorAll('.gcard').find((x) => x.dataset.game === 'chess');
    card.click();
    const opts = $id('setup-side').querySelectorAll('.side-opt');
    const b = opts.find((x) => x.textContent === g.sideName('white'));
    if (!b) throw new Error(label + ': side-opt white missing');
    b.click();
    $id('btn-local').click();
    if (!showing('screen-game')) throw new Error(label + ': game screen not shown');

    const board = boardEl();
    const fromEl = board.querySelector('[data-i="' + sq(fromName) + '"]');
    const toEl = board.querySelector('[data-i="' + sq(toName) + '"]');
    if (!fromEl || !toEl) throw new Error(label + ': squares not rendered');
    fromEl.click(); // select the attacker
    if (!toEl.classList.contains('tgt')) throw new Error(label + ': capture square not marked .tgt — attack invisible in UI');
    if (!toEl.classList.contains('occ')) throw new Error(label + ': occupied capture square missing .occ capture ring');
    toEl.click(); // execute the capture

    if (!cap.last) throw new Error(label + ': no render after capture click');
    const v = cap.last.view;
    if (process.env.DBG_CAP) {
      const occ = [];
      v.board.forEach((p, i) => { if (p) occ.push(i + '(' + F[i & 7] + (8 - (i >> 3)) + '):' + p.p + p.c); });
      console.error('[DBG] post-click board:', occ.join(' '), 'turn=', v.turn, 'pill=', pillText());
    }
    const got = v.board[sq(toName)];
    if (!got || got.p !== capPiece || got.c !== 'white') throw new Error(label + ': capturing piece not on target after click');
    if (v.board[sq(fromName)] !== null) throw new Error(label + ': attacker still on origin square after capture');
    a(fxCount(fxLog.sfx, 'capture') >= 1, label + ': no "capture" sfx fired for a captured piece');

    // clean up so the next run starts from the menu
    $id('btn-leave').click();
    if (!showing('screen-menu')) throw new Error(label + ': leave did not return to menu');
  } finally {
    g.render = origRender;
    g.newState = origNewState;
    if (process.env.DBG_CAP) {
      g.legalMoves = oLM; g.applyMove = oAM; g.currentSide = oCS;
    }
  }
}

n++;
try {
  chessCaptureRun(
    [['a1', 'k', 'white'], ['a8', 'k', 'black'], ['e4', 'p', 'white'], ['d5', 'p', 'black']],
    'e4', 'd5', 'p', 'chess pawn-capture click');
  console.log('PASS  ' + 'chess pawn-capture click'.padEnd(24));
} catch (e) { failures++; console.log('FAIL  ' + 'chess pawn-capture click'.padEnd(24) + ' — ' + e.message); }

n++;
try {
  chessCaptureRun(
    [['a1', 'k', 'white'], ['a8', 'k', 'black'], ['g5', 'n', 'white'], ['f7', 'p', 'black']],
    'g5', 'f7', 'n', 'chess piece-capture click');
  console.log('PASS  ' + 'chess piece-capture click'.padEnd(24));
} catch (e) { failures++; console.log('FAIL  ' + 'chess piece-capture click'.padEnd(24) + ' — ' + e.message); }

/* ---------------- direct API assertions ----------------
 * Rule/regression cases the random click matrix only hits by chance:
 * castling rights, the FIDE b-file exception for O-O-O, threefold
 * repetition, out-of-turn aiMove, and the poker betting-round edge cases
 * (chip conservation, all-in runout, short all-in raise, per-player
 * `acted` reset on street transitions). */
function a(cond, msg) { if (!cond) throw new Error(msg); }
function direct(label, fn) {
  n++;
  try { fn(); console.log('PASS  ' + label.padEnd(24)); }
  catch (e) { failures++; console.log('FAIL  ' + label.padEnd(24) + ' — ' + e.message); }
}

// Craft a chess position from a piece list (name, piece, colour).
function chessPos(pairs, castling) {
  const g = globalThis.Games.chess;
  const F = 'abcdefgh';
  const sq = (nm) => (8 - parseInt(nm[1], 10)) * 8 + F.indexOf(nm[0]);
  const st = g.newState();
  st.board = new Array(64).fill(null);
  for (const [nm, p, c] of pairs) st.board[sq(nm)] = { p: p, c: c };
  st.castling = castling;
  st.ep = -1;
  st.turn = 'white';
  st.halfmove = 0;
  return st;
}
const NO_CASTLE = { wK: false, wQ: false, bK: false, bQ: false };

direct('chess castling rights', () => {
  const g = globalThis.Games.chess;
  // white back rank is indices 56..63: e1=60, g1=62, c1=58
  const hasOO = (st) => g.legalMoves(st, 'white').some((m) => m.from === 60 && m.to === 62);
  // (a) a rook that left and came back does not restore the right
  let st = g.newState();
  g.applyMove(st, g.legalMoves(st, 'white').find((m) => m.from === 55 && m.to === 39)); // h4 (clears the rook's path)
  g.applyMove(st, g.legalMoves(st, 'black').find((m) => m.from === 8 && m.to === 16)); // a6
  g.applyMove(st, g.legalMoves(st, 'white').find((m) => m.from === 63 && m.to === 47)); // Rh3
  g.applyMove(st, g.legalMoves(st, 'black').find((m) => m.from === 9 && m.to === 17)); // b6
  g.applyMove(st, g.legalMoves(st, 'white').find((m) => m.from === 47 && m.to === 63)); // Rh1
  // (f1/g1 are still occupied here, so the decisive fact is the cleared right)
  a(st.castling.wK === false, 'wK right cleared when the h1 rook left, even though it returned');
  // (b) rights present and f1/g1 clear -> O-O available
  st = chessPos([['e1', 'k', 'white'], ['h1', 'r', 'white'], ['e8', 'k', 'black']],
    { wK: true, wQ: false, bK: false, bQ: false });
  a(hasOO(st), 'O-O available with fresh rights and clear f1/g1');
  // (c) a rook that arrived by promotion brings no rights
  st = chessPos([['e1', 'k', 'white'], ['h1', 'r', 'white'], ['e8', 'k', 'black']], NO_CASTLE);
  a(!hasOO(st), 'O-O unavailable for a rook that arrived by promotion');
});

direct('chess O-O-O b-file hit', () => {
  const g = globalThis.Games.chess;
  const hasOOO = (st) => g.legalMoves(st, 'white').some((m) => m.from === 60 && m.to === 58);
  const mk = (black) => chessPos(
    [['e1', 'k', 'white'], ['a1', 'r', 'white'], ['e8', 'k', 'black']].concat(black),
    { wK: false, wQ: true, bK: false, bQ: false });
  // FIDE: only e1/d1/c1 may not be attacked — b1 may be
  a(hasOOO(mk([['b8', 'r', 'black']])), 'O-O-O legal when only the b-file (b1) is attacked');
  a(!hasOOO(mk([['d8', 'r', 'black']])), 'O-O-O illegal when d1 is attacked');
  a(!hasOOO(mk([['b8', 'r', 'black'], ['c8', 'r', 'black']])), 'O-O-O illegal when c1 is attacked');
});

direct('chess threefold repeat', () => {
  const g = globalThis.Games.chess;
  const st = g.newState();
  const play = (from, to) => {
    const m = g.legalMoves(st, st.turn).find((m) => m.from === from && m.to === to);
    if (!m) throw new Error('move not legal: ' + from + ' -> ' + to);
    g.applyMove(st, m);
  };
  // Nb1c3 / Ng8f6 / Nc3d1 / Nf6g8: the start position recurs every 4 plies
  play(57, 42); play(6, 21); play(42, 57); play(21, 6);
  a(!g.outcome(st).over, 'no draw after one repetition cycle (2nd occurrence)');
  play(57, 42); play(6, 21); play(42, 57); play(21, 6);
  const o = g.outcome(st);
  a(o.over && /threefold/.test(o.text), 'threefold draw on the 3rd occurrence, got: ' + (o.text || 'not over'));
});

direct('chess aiMove null paths', () => {
  const g = globalThis.Games.chess;
  // out of turn: no moves for that side
  let st = g.newState();
  a(g.aiMove(st, 'black') === null, 'aiMove null for out-of-turn side');
  // stalemate: no legal move at all (contract: null, shell null-checks)
  st = chessPos([['a1', 'k', 'white'], ['c1', 'k', 'black'], ['b3', 'q', 'black']], NO_CASTLE);
  a(g.legalMoves(st, 'white').length === 0, 'stalemate position has no white move');
  const o = g.outcome(st);
  a(o.over && /stalemate/i.test(o.text), 'stalemate detected, got: ' + (o.text || 'not over'));
  a(g.aiMove(st, 'white') === null, 'aiMove null with no legal move');
});

direct('uno aiMove out of turn', () => {
  const g = globalThis.Games.uno;
  reseed(7);
  const st = g.newState();
  const me = String(st.turn);
  const other = st.turn === 0 ? '1' : '0';
  a(g.legalMoves(st, other).length === 0, 'legalMoves is empty out of turn');
  a(g.aiMove(st, other) === null, 'aiMove returns null out of turn');
  const m = g.aiMove(st, me);
  a(m !== null, 'aiMove returns a move in turn');
  a(g.legalMoves(st, me).some((x) => JSON.stringify(x) === JSON.stringify(m)), 'aiMove move is legal');
});

direct('poker chip conservation', () => {
  reseed(42);
  const g = globalThis.Games.poker;
  // pot already includes current-street bets, so the invariant is stacks + pot
  const sum = (st) => st.players.reduce((t, p) => t + p.stack, 0) + st.pot;
  const st = g.newState();
  a(sum(st) === 400, 'chips conserved at start (' + sum(st) + ')');
  g.applyMove(st, { type: 'raise', actor: '0', amount: 40, paid: 30, firstBet: false });
  a(sum(st) === 400, 'chips conserved after SB raise');
  g.applyMove(st, { type: 'raise', actor: '1', amount: 200, paid: 180, firstBet: false });
  a(st.players[1].allIn, 'BB all-in after raising to 200');
  a(sum(st) === 400, 'chips conserved after BB all-in');
  g.applyMove(st, { type: 'call', actor: '0', paid: 160 });
  a(st.phase === 'over', 'runout settled the hand');
  a(st.board.length === 5, 'board ran out to 5 (' + st.board.length + ')');
  a(st.pot === 0, 'pot distributed at showdown');
  a(sum(st) === 400, 'chips conserved at hand end (' + sum(st) + ')');
});

direct('poker all-in runout', () => {
  reseed(43);
  const g = globalThis.Games.poker;
  const sum = (st) => st.players.reduce((t, p) => t + p.stack, 0) + st.pot;
  const st = g.newState([0, 1, 2, 3]);
  a(st.n === 4, 'four-player table');
  st.phase = 'turn';
  st.board = [st.deck.shift(), st.deck.shift(), st.deck.shift()];
  for (const p of st.players) { p.bet = 100; p.totalBet = 100; p.stack = 100; p.allIn = true; p.acted = true; }
  st.pot = 400; st.lastBet = 100; st.turn = 3;
  st.players[3].allIn = false;
  a(sum(st) === 800, 'chips conserved in setup (' + sum(st) + ')');
  g.applyMove(st, { type: 'check', actor: '3' });
  a(st.phase === 'over', 'single active player -> immediate runout, got ' + st.phase);
  a(st.board.length === 5, 'board ran out to 5');
  a(sum(st) === 800, 'chips conserved after showdown (' + sum(st) + ')');
});

direct('poker short all-in', () => {
  reseed(44);
  const g = globalThis.Games.poker;
  const st = g.newState();
  st.lastBet = 30; st.minRaise = 20;
  st.players[1].bet = 25; st.players[1].stack = 10; st.players[1].totalBet = 25;
  st.turn = 1;
  const mv = g.legalMoves(st, '1');
  const rs = mv.filter((m) => m.type === 'raise');
  a(rs.length === 1, 'exactly one raise option (short all-in), got ' + rs.length);
  a(rs[0].amount === 35 && rs[0].paid === 10, 'short all-in is 35 paid 10, got ' + JSON.stringify(rs[0]));
  a(mv.some((m) => m.type === 'call'), 'call still offered');
  g.applyMove(st, { type: 'raise', actor: '1', amount: 35, paid: 10, firstBet: false });
  a(st.players[1].allIn && st.lastBet === 35, 'applied: all-in, lastBet 35');
  a(st.minRaise === 20, 'minRaise unchanged — short all-in does not open re-raises');
});

direct('poker street acted reset', () => {
  reseed(45);
  const g = globalThis.Games.poker;
  const st = g.newState(); // heads-up: dealer/SB acts first, BB faces 10
  g.applyMove(st, { type: 'call', actor: '0', paid: 10 });
  a(st.phase === 'preflop' && st.turn === 1, 'BB to act preflop');
  g.applyMove(st, { type: 'check', actor: '1' });
  a(st.phase === 'flop', 'flop dealt, got ' + st.phase);
  a(st.turn === 0, 'dealer acts first postflop');
  g.applyMove(st, { type: 'check', actor: '0' });
  a(st.phase === 'flop' && st.turn === 1,
    'street did NOT skip after the first check (per-player acted reset), got ' + st.phase + '/' + st.turn);
  g.applyMove(st, { type: 'check', actor: '1' });
  a(st.phase === 'turn', 'turn reached only after both players acted');
});

/* ---------------- per-run fx/audio assertions ----------------
 * Verify each session actually fired the expected sfx, music, and FX
 * wiring. The event→sfx table lives in main.js (FX_EVENTS), pumped from
 * the `el.__events` array each game render sets; counts below are
 * deterministic under the fixed per-run seeds. Terminal tones: chess
 * emits a mate/draw board sting (which suppresses the overlay tone),
 * while checkers/uno/poker have no terminal board event so the overlay
 * tone always plays. */
function fxExpect(spec, r) {
  const sfxCount = (nm) => fxCount(fxLog.sfx, nm);
  const has = (nm, min) => a(sfxCount(nm) >= min,
    spec.game + ': expected sfx "' + nm + '" at least ' + min + 'x, got ' + sfxCount(nm));
  const resultTones = () => sfxCount('win') + sfxCount('lose') + sfxCount('draw');
  a(fxLog.attaches >= 1, spec.game + ': FX.attach was never called for the board');
  a(fxLog.music.indexOf('start:' + spec.game) >= 0,
    spec.game + ': music.start("' + spec.game + '") was never called');
  a(fxCount(fxLog.music, 'stop') >= 1, spec.game + ': music.stop() was never called');
  a(fxLog.intensity.length >= 1, spec.game + ': music.setIntensity was never called while rendering');
  if (spec.game === 'chess') {
    has('move', 1);
    if (r.how === 'over') a(sfxCount('mate') + sfxCount('draw') >= 1,
      'chess: game ended but no mate/draw terminal sting was played');
  } else if (spec.game === 'checkers') {
    has('deal', 1); has('move', 1); has('capture', 1);
    if (r.how === 'over') a(resultTones() >= 1, 'checkers: game ended but no win/lose/draw result tone was played');
  } else if (spec.game === 'uno') {
    has('deal', 1); has('flip', 1);
    if (r.how === 'over') a(resultTones() >= 1, 'uno: game ended but no win/lose result tone was played');
  } else if (spec.game === 'poker') {
    const hands = r.hands || 0;
    a(hands >= 1, 'poker: no hand finished');
    has('deal', hands);
    a(resultTones() >= hands,
      'poker: expected a result tone for each of the ' + hands + ' finished hand(s), got ' + resultTones());
    if (hands >= 3) a(sfxCount('chip') + sfxCount('allin') >= 3,
      'poker: expected a bet sound (chip/all-in) in each of the 3 hands');
  } else if (spec.game === 'catan') {
    has('build', 1); has('turn', 1);
    if (r.roadMoves >= 1) has('road', 1); // plain road moves are rare within the ply cap; assert only when one occurred
  }
}

for (const spec of RUNS) {
  for (const side of spec.sides) {
    for (let s = 0; s < spec.seeds; s++) {
      n++;
      const label = spec.game + ' [' + side + '] seed' + s;
      try {
        fxReset(); // boot menu music and any prior run are out of scope
        const r = playGame(spec, side, n * 7919 + 13);
        fxExpect(spec, r);
        console.log('PASS  ' + label.padEnd(24) + ' plies=' + r.plies +
          (r.hands ? ' hands=' + r.hands : '') + ' ' + r.how + (r.rematched ? ' (rematch exercised)' : ''));
      } catch (e) {
        failures++;
        console.log('FAIL  ' + label.padEnd(24) + ' — ' + e.message);
      }
    }
  }
}
console.log('\n' + (failures === 0 ? 'ALL GREEN' : failures + ' FAILURE(S)') + ' (' + n + ' runs)');
process.exit(failures === 0 ? 0 : 1);

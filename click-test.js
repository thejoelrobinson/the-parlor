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

globalThis.document = {
  body,
  head,
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  getElementById: (id) => IdRegistry.get(String(id)) || null,
  querySelector: (s) => body.querySelector(s) || head.querySelector(s),
  querySelectorAll: (s) => body.querySelectorAll(s).concat(head.querySelectorAll(s)),
  execCommand: () => true
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
for (const g of ['chess', 'checkers', 'uno', 'poker']) {
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
load('p2p.js');
load('games/chess.js');
load('games/checkers.js');
load('games/uno.js');
load('games/poker.js');
load('main.js');

if (!globalThis.Games || Object.keys(globalThis.Games).length < 4) {
  throw new Error('game modules did not register on window.Games');
}

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

/* ---------------- play one full session ---------------- */
function playGame(spec, side, seedBase) {
  reseed(seedBase);
  const g = globalThis.Games[spec.game];

  // capture every view handed to the real renderer
  const origRender = g.render;
  const cap = { last: null };
  g.render = (view, el, opts) => { cap.last = { view, opts }; return origRender(view, el, opts); };

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

  return { plies, hands, how, rematched };
}

/* ---------------- run matrix ---------------- */
const RUNS = [
  { game: 'chess', sides: ['white', 'black'], plies: 400, seeds: 2 },
  { game: 'checkers', sides: ['red', 'black'], plies: 300, seeds: 2 },
  { game: 'uno', sides: ['0'], plies: 600, seeds: 2 },
  { game: 'poker', sides: ['0'], hands: 3, plies: 400, seeds: 2 }
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

for (const spec of RUNS) {
  for (const side of spec.sides) {
    for (let s = 0; s < spec.seeds; s++) {
      n++;
      const label = spec.game + ' [' + side + '] seed' + s;
      try {
        const r = playGame(spec, side, n * 7919 + 13);
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

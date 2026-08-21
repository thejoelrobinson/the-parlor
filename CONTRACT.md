# Game module contract — "The Parlor" (p2p-games)

You are writing ONE game module for a browser game collection. Read this completely before writing code.

A game is a **triple** of classic browser `<script>` files under `games/<id>/` (no import/export, no ES modules — must work from `file://` AND in Node). Load order (mirrored in `index.html`): `logic.js`, then `view.js`, then `index.js`. Cross-file handoff goes through `global.PARLOR['<id>']` (logic and view) and `global.Games['<id>']` (final manifest). Create exactly the three files named in your task; do not create, modify, or delete any other file (a temporary node test script that you DELETE afterwards is the only exception).

## File 1 — `games/<id>/logic.js` (pure logic)

```js
(function (global) {
  'use strict';

  /* ...state, moves, rules, AI, viewFor, outcome... */

  const logic = { /* every symbol view.js or index.js needs */ };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['<id>'] = global.PARLOR['<id>'] || {};
  global.PARLOR['<id>'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);
```

- ALL game logic is pure (no DOM, no timers, no globals besides Math/random) so it runs in Node for testing.
- Export EVERY symbol the render layer needs, including render-only constants (glyph tables, names, coordinates).

## File 2 — `games/<id>/view.js` (DOM render layer)

```js
(function (global) {
  'use strict';

  const L = global.PARLOR['<id>'].logic;
  const { a, b, c } = L;  // one destructure line: every logic symbol used below

  /* render(view, el, opts), renderInfo?(view, el, opts), plus
     render-local diff state as module-scope lets */

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['<id>'] = global.PARLOR['<id>'] || {};
  global.PARLOR['<id>'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);
```

- DOM access lives ONLY in this file.
- **Destructure, don't prefix.** The single destructure line at the top pulls every needed logic symbol into a local const; the body never writes `L.foo(...)`. If a name collides with a view-local, `node --check` catches the redeclaration.
- Per-render diff state (e.g. `lastTurn`, `lastCards`) stays module-scope lets HERE, initialized to empties (''/0/-1/null) — `render()` rebuilds the DOM every call, so nothing can live on the element.
- Gliding board transitions use the FLIP helpers in `core/ui.js` (`UI.flipCapture` / `UI.flipPlay`); see chess/checkers for the pattern.

## File 3 — `games/<id>/index.js` (css + manifest)

```js
(function (global) {
  'use strict';

  const L = global.PARLOR['<id>'].logic;
  const V = global.PARLOR['<id>'].view;
  const { newState, currentSide, legalMoves, applyMove, outcome, viewFor, aiMove, describeMove } = L;
  const { render, renderInfo } = V;

  const css = [ /* one CSS rule per line */ ].join('\n');

  const game = { /* the object below */ };

  global.Games = global.Games || {};
  global.Games['<id>'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);
```

`index.js` is the ONLY file that touches `global.Games`. Keep it small: two destructure lines, a css array, the manifest literal, the registration.

## The game object

```js
{
  id: '<id>',                    // 'chess' | 'checkers' | 'uno' | 'poker' | 'catan'
  title: 'Display Title',
  blurb: 'one-line description shown in the menu',
  hint: 'one-line how-to string for the menu',
  sideList: ['a', 'b', ...],     // ALL side ids; sideList[0] moves first / is the host seat
  pickSide: true|false,          // true if a local player may choose their side (board games)
  sideName(side) -> string,      // display name, e.g. 'White', 'You', 'Bot 2'
  css: 'game-specific CSS',
  newState(configs) -> state,    // configs: null OR array of {kind:'human'|'bot'} (seated games use it; board games ignore it)
  currentSide(state) -> sideId|null,   // side to move now; null when the game/hand is over
  legalMoves(state, side) -> Move[],   // Move = plain JSON object
  applyMove(state, move) -> void,      // MUTATES state. Only the host calls it, after validation.
  outcome(state) -> {over:false} | {over:true, text:string},
  viewFor(state, side) -> view,        // JSON-safe view for one side; hidden data -> null (never real values)
  aiMove(state, side) -> Move|null,    // legal move for side, or null when side is out of turn / has no legal move
  describeMove(state, move) -> string, // must be accurate even when called AFTER applyMove ran
  render(view, el, opts) -> void,      // FULL re-render: set el.innerHTML, re-attach listeners
                                       // opts = { mySide, interactive (bool), onMove(move) }
  renderInfo?(view, el, opts) -> void, // optional: per-player status rows for the side panel
  nextHand?(state) -> void             // poker only: start next hand after a hand ends
}
```

## Shell metadata (optional — consumed generically, no per-game branches in the shell)

- `hint` — one-line how-to string for the menu (every game ships it).
- `localConfigs()` — seat configs for **local** mode: an array of `{kind:'human'|'bot'}`. Local UNO/poker declare `[{kind:'human'},{kind:'bot'},{kind:'bot'},{kind:'bot'}]`; two-player board games omit it (the shell seats two humans).
- `intensity(view, mySide)` -> 1-3 — music intensity while the game is live.
- `resultIcon` — HTML string for the result-overlay icon (inline SVG, or a span using the game's own CSS class).
- `resultTone(text, mySide)` -> 'win'|'lose' — draw detection (text containing "draw"/"stalemate"/"split") is the shell's job; only the win-vs-lose read belongs here. Implement with `this.sideName(mySide)` and a `<name> wins` check in the outcome text.
- `confetti: false` — suppress the result-overlay confetti burst (poker: hands end constantly, icon only).
- `nextHand` — its presence also switches the overlay label from "Game over" to "Hand over".

## FX events (optional render side-effect)

`render()` may — purely for presentation — set `el.__events` to a **fresh array** of
plain event objects describing what happened this frame. The shell's `pumpEvents`
(`core/session.js`) consumes it exactly once after every render and resets it to `[]`, so
**every render must assign a new array** (possibly empty) — stale events are
consumed, never accumulated.

```js
el.__events = [ { t: 'capture', sq: 'e5', el: pieceEl }, { t: 'check' } ];
```

- `t` is the event type. The shell maps it through `FX_EVENTS` to a sound effect,
  a particle kind, and optionally a board shake. Unknown types fall back to an SFX
  named after the event (additive, never throws).
- Events may carry `el` (a DOM node whose center becomes the burst position — pass the
  real node you built, e.g. the moved piece or the destination square) and/or `x`/`y`
  (layer-local coordinates, used when no element is available).
- **Events never cross the wire.** They are derived locally from the same
  host-authoritative state diff on both peers, so both devices play the same sounds
  and particles with **zero new P2P message types**. Do not add message types for FX.
- Terminal events (`mate`, `draw`) must fire **exactly once** per game end — compare
  against the previous outcome stored on the element (the games use `el.__prevOver`,
  updated on every render). They also suppress the shell's generic win/lose tone.
- `check` raises the music intensity to 2 for the rest of the game.
- Current `FX_EVENTS` keys: `move castle capture check mate promo crown multijump
  draw deal draw1 draw2 play flip wild shuffle uno bet fold allin phase showdown click`.
- The FX modules are Node-safe: headless, `window.FX.attach()` returns `null` and
  `window.AUDIO` no-ops, so events are simply dropped there. `node click-test.js`
  asserts the sfx/music wiring through this contract.

## Hard rules

1. `state` and `move` are plain JSON (no functions, no `undefined`). Move equality is `JSON.stringify` — make moves canonical (fixed keys, consistent key sets per move type).
2. `render()` rebuilds `el.innerHTML` on every call and re-attaches listeners. When `interactive === true`, clickable controls call `opts.onMove(move)` with a legal move. Never mutate state from render. When `interactive === false` the board still renders (opponent view / thinking) but nothing is clickable.
3. Hidden-information games: the view for a side contains everything that side may see (own cards, public info) and nothing else, plus everything `outcome()` needs. `outcome()` and `render()` must work on the VIEW, not just full state. Use `null` for other players' hidden card lists (render shows card backs).
4. No `alert()`, `prompt()`, `confirm()`. All UI lives inside the given container.
5. `Math.random()` is fine (host is authoritative; no cross-device sync needed).
6. AI: always terminates; returns a legal move, or `null` when the side is out of turn or has no legal move — callers MUST null-check before applying. Keep search depth bounded; forced-capture sequences (checkers) are explored inside the search, not by unbounded external `applyMove` loops.
7. Scope all CSS you add with a unique class prefix (e.g. `.chess-board ...`) so games never collide. Shared classes available (already in styles.css): `btn`, `big`, `pill`, `muted`, `log`, `hidden`.
8. `describeMove(state, move)` is called after `applyMove` — the `move` object must carry everything needed (from/to, card, amount...).
9. Keep `currentSide` null-safe: when the game is over (or poker hand over) return `null`.
10. Host/shell: the authoritative host ignores any peer "rematch" message unless the current game is actually over — a stale button press on a peer's screen must never restart the host's live game.
11. `view.js` and `index.js` take everything from `global.PARLOR['<id>']` through their destructure headers. Never re-declare a logic symbol or duplicate its code — `logic.js` is the only place game rules live.

## Node smoke test (MANDATORY before you finish)

Load the triple in order (logic, view, index) exactly as `click-test.js` does, then from `C:\Users\Joel Robinson\Downloads\p2p-games` run a test (inline `node -e` or a temp file you delete):
1. All three modules load in Node without error.
2. Full AI-vs-AI (or bot-vs-bot) games run to a finished outcome with no exception — at least 3 games (poker: at least 5 hands, including one forced all-in/side-pot hand; verify total chips are conserved).
3. The targeted unit checks listed in your task.
Print a short PASS/FAIL summary. Delete any temp test file afterwards.

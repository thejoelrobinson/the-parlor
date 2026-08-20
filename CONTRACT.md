# Game module contract — "The Parlor" (p2p-games)

You are writing ONE game module for a browser game collection. Read this completely before writing code.

## File & wrapper
Write EXACTLY ONE file at the path given in your task. Do NOT create, modify, or delete any other file (a temporary node test script that you DELETE afterwards is the only exception).

The file is a classic browser `<script>` (no import/export, no ES modules). Use this wrapper:

```js
(function (global) {
  'use strict';
  /* ...pure logic + render code... */
  const game = { /* the object described below */ };
  global.Games = global.Games || {};
  global.Games['<id>'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);
```

ALL game logic must be pure (no DOM, no timers, no globals besides Math/random) so it can run in Node for testing. DOM access is allowed ONLY inside `render` / `renderInfo`.

## The game object

```js
{
  id: '<id>',                    // 'chess' | 'checkers' | 'uno' | 'poker'
  title: 'Display Title',
  blurb: 'one-line description shown in the menu',
  sideList: ['a', 'b', ...],     // ALL side ids; sideList[0] moves first / is the host seat
  pickSide: true|false,          // true if a local player may choose their side (board games)
  sideName(side) -> string,      // display name, e.g. 'White', 'You', 'Bot 2'
  css: 'optional game-specific CSS',
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

## FX events (optional render side-effect)

`render()` may — purely for presentation — set `el.__events` to a **fresh array** of
plain event objects describing what happened this frame. The shell's `pumpEvents`
(`main.js`) consumes it exactly once after every render and resets it to `[]`, so
**every render must assign a new array** (possibly empty) — stale events are
consumed, never accumulated.

```js
el.__events = [ { t: 'capture', sq: 'e5', el: pieceEl }, { t: 'check' } ];
```

- `t` is the event type. `main.js` maps it through `FX_EVENTS` to a sound effect,
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

## Node smoke test (MANDATORY before you finish)
From `C:\Users\Joel Robinson\Downloads\p2p-games` run a test (inline `node -e` or a temp file you delete):
1. Module loads in Node without error.
2. Full AI-vs-AI (or bot-vs-bot) games run to a finished outcome with no exception — at least 3 games (poker: at least 5 hands, including one forced all-in/side-pot hand; verify total chips are conserved).
3. The targeted unit checks listed in your task.
Print a short PASS/FAIL summary. Delete any temp test file afterwards.

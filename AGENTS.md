# The Parlor (p2p-games) — working notes

Static, dependency-free browser game collection. No build step, no server, no npm
install. Plain `<script>` tags; must work from `file://` AND in Node (VM-based click test).

**Read `CONTRACT.md` before writing or changing any file under `games/`.** It is the
authoritative interface spec. Do not re-derive it from the game modules.

## File map — read only what your task names

| File | Lines | Read it when |
|---|---:|---|
| `CONTRACT.md` | 161 | Always, before touching `games/*` |
| `core/ui.js` | 148 | Shared DOM/animation helpers (FLIP board transitions, player rows) |
| `core/p2p.js` | 132 | WebRTC signaling changes only |
| `core/session.js` | 536 | Session/P2P/FX-pump behavior |
| `main.js` | 281 | Menu/boot wiring only |
| `games/chess/logic.js` | 490 | Task names chess (rules/AI) |
| `games/chess/view.js` | 308 | Task names chess (board render) |
| `games/chess/index.js` | 73 | Task names chess (manifest/css) |
| `games/checkers/logic.js` | 241 | Task names checkers (rules/AI) |
| `games/checkers/view.js` | 328 | Task names checkers (board render) |
| `games/checkers/index.js` | 79 | Task names checkers (manifest/css) |
| `games/uno/logic.js` | 287 | Task names uno (rules/deck/AI) |
| `games/uno/view.js` | 368 | Task names uno (cards render) |
| `games/uno/index.js` | 170 | Task names uno (manifest/css) |
| `games/poker/logic.js` | 465 | Task names poker (rules/hand eval/AI) |
| `games/poker/view.js` | 535 | Task names poker (table render) |
| `games/poker/index.js` | 186 | Task names poker (manifest/css) |
| `games/catan/logic.js` | 236 | Task names catan (rules/AI) |
| `games/catan/view.js` | 140 | Task names catan (board render) |
| `games/catan/index.js` | 77 | Task names catan (manifest/css) |
| `fx/audio.js` | 620 | Adding an SFX name or a music scene |
| `fx/fx.js` | 370 | Changing particle kinds or shake |
| `styles.css` | 604 | Shared shell styling only — games ship their own CSS |
| `index.html` | 197 | Adding a `<script>` tag or a shell element |
| `click-test.js` | 781 | Changing the test harness itself |
| `audio-test.js` | 192 | Changing the audio tests |
| `fx-test.js` | 315 | Changing the FX tests |

A task about one game reads at most that game's triple plus CONTRACT.md. Never read the
other four games. Prefer `grep` for a symbol over reading a whole file; when you do read,
use an offset/limit window and note the line numbers you saw.

## Structure — the pattern every game follows

- `games/<id>/logic.js` — pure logic (no DOM); registers `global.PARLOR['<id>'].logic`
  plus a Node `module.exports` guard.
- `games/<id>/view.js` — DOM render; destructures the logic symbols it uses in a
  single header line (never `L.foo(...)` in the body); registers `global.PARLOR['<id>'].view`.
- `games/<id>/index.js` — css array plus the manifest literal; registers
  `global.Games['<id>']` plus a Node `module.exports` guard.
- Script order in `index.html`: `core/ui.js` -> `core/p2p.js` -> `core/session.js` ->
  each game triple (logic, view, index) -> `fx/audio.js` -> `fx/fx.js` -> `main.js`.
- Shell-generic manifest metadata (`hint`, `localConfigs`, `intensity`, `resultIcon`,
  `resultTone`, `confetti`, `nextHand`) lives in the `index.js` manifest — there are
  NO per-game branches in `core/` or `main.js` (see CONTRACT.md, "Shell metadata").

## Invariants that are easy to get wrong

- **Host-authoritative.** The guest sends moves; the host validates with `legalMoves`,
  calls `applyMove`, and broadcasts per-side views from `viewFor`. Hidden cards never
  leave the host.
- **`sideList[0]` is the host seat and moves first.** `sideList[1]` is the guest.
- **P2P is strictly 2-player.** Bots exist only in `local` mode, driven by the
  `afterMove` bot timer (500 ms) in `core/session.js`.
- **`describeMove(state, move)` is called AFTER `applyMove` has already mutated state.**
  The move object must carry everything the description needs.
- **`el.__events` must be assigned a fresh array on every render** (possibly empty).
  `pumpEvents` in `core/session.js` consumes it once and resets it. Events never cross
  the wire — both peers derive them locally from the same state diff. Never add a
  P2P message type for FX.
- **Terminal events (`mate`, `draw`) fire exactly once**, guarded by `el.__prevOver`.
- **An unknown event `t` falls back to an SFX of the same name**, which is silent unless
  that name exists in the `SFX` table in `fx/audio.js`. New event type = new SFX entry.
- **`render()` rebuilds `el.innerHTML` and re-attaches listeners every call.** Never
  mutate state from render.
- **Game logic must be pure** (no DOM, no timers) so it runs in Node. DOM only inside
  `render` / `renderInfo`.
- **`state` and `move` are plain JSON.** Move equality is `JSON.stringify`, so keep move
  objects canonical — fixed key order, consistent key set per move type.
- A stale peer "rematch" message must be ignored by the host unless the game is
  actually over.
- **Line endings are mixed by file.** Most files are CRLF; the catan family
  (`games/catan/*.js`) is LF-only. Preserve each file's existing endings when editing.

## Shared CSS tokens (in `styles.css`)

Colors: `--surface #ffffff`, `--surface-soft #faf9f5`, `--hair #e4e0d4`,
`--hair-strong #d3cdbd`, `--gold #c29330`, `--gold-soft #faf3e2`, `--ink`, `--ink-soft`,
`--green`.
Type: `--font-display "Fraunces"` (body is Inter).
Motion: `--shadow-md`, `--ease-spring cubic-bezier(.18,1.3,.4,1)`, `--ease-out`.
Shared classes: `btn`, `big`, `pill`, `muted`, `log`, `hidden`.

Each game ships its own CSS in the manifest `css` field, scoped under a unique prefix
(`.uno-*`, `.chess-*`, ...). Do not add per-game rules to `styles.css`.

## Tests — run these, they are the definition of done

```
node click-test.js    # 27 seeded AI-vs-AI games across all 5 games, with FX/audio wiring assertions
node audio-test.js    # audio module units
node fx-test.js       # particle layer units
```

`click-test.js` uses a VM plus a minimal DOM stub and a seeded LCG, and drives the real
rendered DOM click path. It asserts the view changed after every click.

Any temporary test script you create must be deleted before you finish.

## Adding a new game — everything you must touch

1. `games/<id>/logic.js`, `view.js`, `index.js` — the triple (see `CONTRACT.md`).
2. `index.html` — three `<script>` tags (logic, view, index) in that order, in the
   game-triple section (after `core/session.js`, before `fx/audio.js`).
3. `fx/audio.js` — a `SCENES.<id>` music table, plus any new SFX names.
4. `core/session.js` — nothing; the shell is generic. Only if the game needs behavior
   the contract cannot express — prefer extending the manifest metadata over a
   per-game branch.
5. `click-test.js` — add the game to the harness (loads the triple the same way the
   existing games are loaded).

## Working style in this repo

- One game (or one subsystem) per session. Finish it, run the tests, then start a fresh
  session for the next one.
- State the exact file and line range you intend to change before editing.
- **Do not re-read a range you have already read** unless the file was edited since.
  If you need it again, it is in the transcript above; scroll rather than re-read.
- Keep tasks narrow and concretely specified. Open-ended framings ("make it AAA",
  "add two games") reliably cause runaway deliberation that ends the turn before any
  tool call is emitted. One game, one subsystem, one named acceptance test.

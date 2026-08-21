# ♟ The Parlor

Five classic games in your browser — **Chess, Checkers, UNO, Poker (Texas Hold'em), and Catan (simplified)** —
with no installs, no accounts, and no server:

- **vs Computer** — play any game against a built-in AI opponent.
- **Peer-to-Peer** — two browsers link **directly** with WebRTC (no game server).
  You swap two short codes, then play with in-game chat.

## Run it

Just open **`index.html`** in a modern browser (Chrome, Edge, or Firefox).
Everything is plain static files — no build step.

If your browser blocks anything on `file://`, serve the folder instead:

```
python -m http.server 8000
# or: npx serve .
```

then visit `http://localhost:8000`.

## Playing peer-to-peer

1. Both players pick the **same game**, then choose **Play Peer-to-Peer**.
2. One taps **I host** → **Create room** → copies the *room code*.
3. The other taps **I join** → pastes the room code → **Generate my answer** →
   copies the *answer code* back.
4. The host pastes the answer code → **Connect**. The game starts (host deals).

The codes can travel by **Bluetooth chat, SMS, iMessage, Discord, or anything else** —
that's just the signaling channel; after the link is up, all game traffic flows
directly between the two devices.

### A note on Bluetooth

You asked for P2P "over Bluetooth if possible": browsers **cannot** link to each other
over Bluetooth. The Web Bluetooth API only lets a page talk to small BLE peripherals
(heart-rate straps, beacons) — phones and laptops don't expose a generic data channel
to each other. So the link is **WebRTC** (which is how browser P2P actually works),
with Bluetooth remaining a perfectly fine way to hand over the connection codes.
STUN is included, so it also works across the internet in most home/office NAT setups.
There is **no TURN relay** (STUN only): if both devices are behind strict/symmetric NATs
that block hole punching, the link may not connect — connection attempts are bounded by a
short ICE-gathering wait and then reported as a failed connection rather than hanging.

## The games

| Game | Notes |
|---|---|
| Chess | Full rules: castling, en passant, promotion, check/checkmate/stalemate, 50-move, threefold-repetition & insufficient-material draws. AI: minimax + alpha-beta (depth 3). |
| Checkers | 8×8 draughts: mandatory captures, multi-jumps, crowning kings. AI: minimax, 6-ply search (root + 5). |
| UNO | 108-card deck, skips, reverses, +2, wild & wild+4. 2 players (P2P) or you + 3 bots (local). Reverse = skip in 2-player games. |
| Poker | Texas Hold'em: blinds 10/20, stacks 200, full betting rounds, all-ins & **side pots**, showdown hand evaluation. You + 3 bots (local) or 2-player (P2P). AI is heuristic (made hand, draws, pot odds, occasional bluffs). |
| Catan | Simplified 2-player Catan: 7 hexes, 12 building sites, settlements & cities, 3-for-1 trades, first to 5 VP wins. No robber, roads, or dev cards. AI: greedy (upgrade, build on the best hex, trade when it unlocks). |

## How it works

- `index.html` + `styles.css` — UI shell & theme (screen transitions, board
  "iris-in", living menu cards, shake keyframes — all transform/opacity only)
- `core/ui.js` — shared DOM/animation helpers (FLIP board transitions, player rows)
- `core/p2p.js` — WebRTC data channel with copy-paste signaling
- `core/session.js` — session logic: local bot games and P2P play (host-authoritative:
  the guest sends moves, the host validates and broadcasts hidden-safe views, so
  hands/cards stay secret in UNO & poker); also pumps each game's FX events into
  sound and particles
- `main.js` — menu and boot wiring
- `games/<id>/` — one directory per game, three files: `logic.js` (pure rules + AI),
  `view.js` (DOM render), `index.js` (css + manifest). See `CONTRACT.md`.
- `fx/audio.js` — procedural Web Audio music & sound effects (see below)
- `fx/fx.js` — canvas-2d particle layer + screen shake (see below)
- `CONTRACT.md` — the interface contract the game modules implement
  (including the `el.__events` FX-event contract)

## Audio & FX

All sound and visual effects are **procedural** — no audio files, no images,
no libraries:

- **`fx/audio.js`** — a Web Audio step sequencer plays a different procedural
  backing track per screen (menu, chess, checkers, UNO, poker), built from
  per-scene chord progressions (minor/maj7/min9/dom9 qualities, bass + pad at
  rest, arps or stabs at intensity 1, percussion at 2, pulse/counter-melody at
  3). The shell raises music intensity to 2 while a king is in check. One-shot
  SFX (move, capture, check, mate, deal, chip, wild, fanfares, …) are short
  oscillator/noise bursts that duck the music bus. Settings (mute, volume,
  music/SFX on-off) persist in `localStorage` (`parlor:audio`).
- **`fx/fx.js`** — one transparent canvas-2d layer per board. Eight particle
  kinds (dust, spark, confetti, ring, firework, sweep, gold-rain, smoke) plus
  screen-shake and a brief camera nudge. The animation loop runs
  `requestAnimationFrame` **only while particles exist**; the pool is hard-capped
  at 400 particles and device-pixel-ratio at 2.
- **Event contract** — a game's `render()` describes what just happened by
  setting `el.__events` (full spec in `CONTRACT.md`); `main.js` pumps that
  array into sounds + particles + shake after every render. Both P2P peers
  derive the same events from the same host-authoritative state diff, so the
  juice stays in sync on both devices with **zero new wire messages**.
- **Audio gesture gate** — browsers start `AudioContext` suspended until a user
  gesture: the first tap/click unlocks audio and the menu music begins ~300 ms
  later. Without Web Audio (or before the gesture) everything is a silent
  no-op; gameplay is never blocked on sound.
- **Accessibility** — the OS `prefers-reduced-motion` setting (or the
  in-app Effects toggle) disables all particles, shakes, and camera moves, and
  the CSS keyframes are wrapped in a `prefers-reduced-motion` media query.

## Performance

- ~250 KB of plain JS + CSS in total (unminified source, zero dependencies,
  zero binary assets, zero build step).
- Particles: rAF only while particles are alive, 400-particle hard cap, DPR
  capped at 2, canvas sized to its board container; the layer self-clears and
  stops when the pool empties.
- Audio: a single 25 ms scheduler interval with a 350 ms lookahead; each step
  is a few short-lived oscillator nodes that are garbage-collected after they
  sound; one shared 1.2 s noise buffer for all percussive SFX.
- CSS motion (iris-in, shake, menu card life) uses transform/opacity only, so
  it stays on the compositor thread.

## Manual test checklist

Run the Node suites first (all must be green), then in a browser:

**Local play** — Chrome / Firefox / Safari, desktop

- [ ] Menu music starts on the first tap/click (browser gesture gate).
- [ ] Volume slider, mute, and music/SFX toggles persist across a reload
      (`localStorage["parlor:audio"]`).
- [ ] Chess: moves/captures have sound + particles; a check makes the track
      noticeably busier (intensity up); checkmate plays the terminal sting
      (not a double fanfare).
- [ ] Every game end: overlay win/lose/draw tone + particles (checkers/UNO/
      poker) or terminal sting (chess); leaving back to the menu switches the
      track to the menu theme.
- [ ] Rematch: the board iris-in replays and the game track restarts.
- [ ] With `prefers-reduced-motion` on (OS setting, or DevTools → Rendering):
      no particles/shake/camera nudge; everything else identical.

**Peer-to-peer** — two browsers, or a browser + a phone

- [ ] Both peers hear the same SFX and see the same particles for the same
      public moves and phases (events derive locally from shared state — there
      is no FX traffic on the wire, so FX lag is zero).
- [ ] Hidden info stays hidden: no sound or particle leak for the opponent's
      hole cards / hidden UNO cards on your side.

**Mobile**

- [ ] Touch works everywhere; where the browser supports `navigator.vibrate`,
      haptic ticks fire on big events (mate, all-in, wild).
- [ ] On a mid-range phone the particle layer holds frame rate (400-particle
      cap) and the board stays legible in both orientations.

**Served vs `file://`**

- [ ] Opening `index.html` directly works; so does
      `python -m http.server 8000` → `http://localhost:8000`.

## Tests (Node, no browser needed)

```
node click-test.js    # 27 seeded AI-vs-AI games across all 5 games, with FX/audio wiring assertions
node audio-test.js    # unit tests for the audio module (scene tables, scheduling, settings, Node no-ops)
node fx-test.js       # unit tests for the particle layer (headless no-ops + fake-canvas behavior)
```

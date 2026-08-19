# ♟ The Parlor

Four classic games in your browser — **Chess, Checkers, UNO, and Poker (Texas Hold'em)** —
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

## The games

| Game | Notes |
|---|---|
| Chess | Full rules: castling, en passant, promotion, check/checkmate/stalemate, 50-move & insufficient-material draws. AI: minimax + alpha-beta (depth 3). |
| Checkers | 8×8 draughts: mandatory captures, multi-jumps, crowning kings. AI: minimax (depth 6). |
| UNO | 108-card deck, skips, reverses, +2, wild & wild+4. 2 players (P2P) or you + 3 bots (local). Reverse = skip in 2-player games. |
| Poker | Texas Hold'em: blinds 10/20, stacks 200, full betting rounds, all-ins & **side pots**, showdown hand evaluation. You + 3 bots (local) or 2-player (P2P). AI is heuristic (made hand, draws, pot odds, occasional bluffs). |

## How it works

- `index.html` + `styles.css` — UI shell & theme
- `p2p.js` — WebRTC data channel with copy-paste signaling
- `main.js` — menu, local sessions, P2P session logic (host-authoritative: the
  guest sends moves, the host validates them and broadcasts hidden-safe views,
  so hands/cards stay secret in UNO & poker)
- `games/*.js` — one self-contained module per game (pure logic + rendering)
- `CONTRACT.md` — the interface contract the game modules implement

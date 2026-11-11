# AGENTS.md

## What this is
A website for sharing photos between any devices in the same room: phones, tablets and laptops. Devices join a room, push orbs to join their screens into one shared space and drag photos across. Files go device to device over WebRTC. When the network blocks that, they go through the room server (Supabase Realtime) end-to-end encrypted.

Every device in a room is a stranger: anyone with the room code can send anything. The code is written for that.

## Layout
| Path | What it does |
|---|---|
| `web/index.html` | The shared space: joining screens, prints, dragging, saving |
| `web/net.js` | The room: who is here, the shared clock, screen joins |
| `web/layout.js` | Where each screen sits in the shared space |
| `web/peers.js` | Links between devices: direct WebRTC or the encrypted relay |
| `web/seal.js` | End-to-end encryption: ECDH P-256, HKDF, AES-256-GCM |
| `web/check.js` | Checks for everything received from another device |
| `tests/` | Unit tests and the two-browser test |
| `docs/` | Requirements, architecture, threat model and test plan |

## Docs
Requirements: `docs/PRD.md`. Design and message types: `docs/ARCHITECTURE.md`. Threats: `docs/THREAT-MODEL.md`. Tests: `docs/TESTING.md`. Every ticket cites its PRD ID (for example S6) and every PR names the IDs it covers.

## Setup
```sh
npm install
npx playwright install chromium
npm run serve        # http://127.0.0.1:5199/ (local only)
```

## Verify
```sh
npm run test:unit       # check.js
npm run test:browsers   # two-browser test, direct then relay (needs internet)
npm test                # both
```

## Rules
Builders follow these rules. Reviewers flag any change that breaks one, even if all tests pass.

### Security and privacy

**1. Every message from another device is checked or dropped** (the Stranger Rule)
- **Rule:** every kind of message another device can send (photos, moves, requests, file pieces, screen joins and connection setup) has a check in `web/check.js`. A message is used only after its check accepts it. If there's no check for it or the check fails, the message is dropped: never guessed at, repaired or half-used.
- **Where:** every place that reads another device's data: `onMessage` in `web/index.html`, the room handlers in `web/net.js` (presence, clock, pushes, layouts, join results, signals) and `onSignal` in `web/peers.js`.
- **Why:** anyone with the room code is in the room. On Day 1 most review findings were one device able to crash, flood or stall the others by sending something unexpected.
- **Breaks it:** `prints.set(m.pid, m)` straight from a message, without `validPrint(m)` first.
- **Checked by:** `tests/check.test.mjs` tests the checks themselves. `npm run test:browsers` sends malformed messages to a live device during a real transfer. In review: any handler that reads a message before its check and any new message type without one.

**2. The room server only ever sees sealed bytes** (the Deaf Relay Rule)
- **Rule:** the room server never sees photos, keys or filenames in readable form. Anything relayed is sealed with `web/seal.js` first: a fresh random IV per message, sender and receiver bound in as associated data. Secrets come from `crypto.getRandomValues`, never `Math.random`.
- **Allowed in the clear:** room codes, device ids and names, screen sizes, public keys and WebRTC setup messages. `Math.random` is fine for things that aren't secret, like where a print lands.
- **Where:** `web/peers.js`, `web/seal.js` and anything that calls `signal()`.
- **Why:** the point of the site is that nobody in the middle can look at your photos, including us.
- **Breaks it:** `signal(peer, { file: bytes })` without `seal()` first.
- **Checked by:** the relay run of `npm run test:browsers`; in review, anything sent through `signal()` that isn't sealed.

### Network reliability

**3. No device can hold up anyone else** (the One Slow Phone Rule)
- **Rule:** one slow, broken or hostile device must never stall anyone else. Each device's work is capped and timed out on its own. Nothing waits forever on another device. The one shared queue is the relay's pacing, which keeps the room under the server's rate limit: only frames that are ready to send go in it, never work that is waiting on a device. Limits are named constants, not loose numbers: `LIMITS` in `web/check.js`, `HOLD` and `RELAY_GAP` in `web/peers.js`, `MAX_BATCH`, `PER_DEV` and `DEADLINE` in `web/net.js`.
- **Where:** `web/peers.js` (links, keys, relay queues), `web/net.js` (pushes, layouts), transfers in `web/index.html`.
- **Why:** phones drop off Wi-Fi, lock their screens and lag. On Day 1 a single bad key could block the relay for the whole room.
- **Checked by:** review only for now: any wait without a cap or timeout, anything in the shared relay queue that waits on a device and any limit that isn't a named constant.

**4. A file is kept only if it matches its fingerprint** (the Fingerprint Rule)
- **Rule:** a received file is only kept if every piece is the expected length and the whole file matches the SHA-256 sent with its print. Otherwise it is thrown away and fetched again from someone else.
- **Where:** receiving files in `web/index.html`, piece checks in `web/check.js`.
- **Why:** a device can claim to hold a photo and send anything. On Day 1 empty pieces could be saved as a "photo".
- **Breaks it:** `files.set(fid, new File(parts, name))` before comparing the SHA-256.
- **Checked by:** `tests/check.test.mjs` (piece lengths) and `npm run test:browsers` (files arrive byte-identical).

### Verification

**5. Joining and transfer changes pass the two-browser test before merging** (the Two-Browser Rule)
- **Rule:** any change to joining, linking or transfer passes `npm run test:browsers` (direct and relay) before it is merged. This includes fixes written by review tools and agents.
- **Where:** every pull request that touches `web/`.
- **Why:** on Day 1 a review tool's fix looked right and broke the site twice: it crashed as soon as two devices connected and screens could never join. Only this test caught it.
- **Checked by:** the test output in the PR description. If a run couldn't happen (for example no internet for the relay run), the PR says so. It never claims a pass it didn't see.

## Known gaps
These are known. Don't flag them as new findings. Do flag any change that makes them worse.
- The room server could swap public keys during key exchange. There is no check both people can compare yet.
- Anyone with the room code can join the room. The host can't confirm who is in it yet.
- Files from other devices aren't checked for what they contain, only for size and fingerprint. A file could be harmful.

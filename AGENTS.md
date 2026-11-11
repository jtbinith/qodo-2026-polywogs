# AGENTS.md

## What this is
A browser app for sharing photos between any devices in the same room: phones, tablets and laptops. Devices join a room, push orbs to join their screens into one shared space and drag photos across. Files go device to device over WebRTC. When the network blocks that, they go through the room server (Supabase Realtime) end-to-end encrypted.

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

**1. Nothing from another device is used until `check.js` accepts it** (the Stranger Rule)
- **Rule:** nothing received from another device is used until a check in `web/check.js` has accepted it. New message types get a check there first. Unknown or malformed messages are dropped, never repaired.
- **Where:** every handler of messages from other devices: `web/index.html`, `web/peers.js`, `web/net.js`.
- **Why:** anyone with the room code is in the room. On Day 1 most review findings were one device able to crash, flood or stall the others by sending something unexpected.
- **Breaks it:** `prints.set(m.pid, m)` straight from a message, without `validPrint(m)` first.
- **Checked by:** `tests/check.test.mjs`; in review, any handler that uses a message before checking it.

**2. The room server only ever sees sealed bytes** (the Deaf Relay Rule)
- **Rule:** the room server never sees photos, keys or filenames in readable form. Anything relayed is sealed with `web/seal.js` first: a fresh random IV per message, sender and receiver bound in as associated data. Secrets come from `crypto.getRandomValues`, never `Math.random`.
- **Allowed in the clear:** room codes, device ids and names, screen sizes, public keys and WebRTC setup messages. `Math.random` is fine for things that aren't secret, like where a print lands.
- **Where:** `web/peers.js`, `web/seal.js` and anything that calls `signal()`.
- **Why:** the point of the app is that nobody in the middle can look at your photos, including us.
- **Breaks it:** `signal(peer, { file: bytes })` without `seal()` first.
- **Checked by:** the relay run of `npm run test:browsers`; in review, anything sent through `signal()` that isn't sealed.

### Network reliability

**3. No device can hold up anyone else** (the One Slow Phone Rule)
- **Rule:** one slow, broken or hostile device must never stall anyone else. Work for each device is queued, capped and timed out on its own. Nothing waits forever on another device. Limits are named constants, not loose numbers: `LIMITS` in `web/check.js`, `HOLD` and `RELAY_GAP` in `web/peers.js`, `MAX_BATCH`, `PER_DEV` and `DEADLINE` in `web/net.js`.
- **Where:** `web/peers.js` (links, keys, relay queues), `web/net.js` (pushes, layouts), transfers in `web/index.html`.
- **Why:** phones drop off Wi-Fi, lock their screens and lag. On Day 1 a single bad key could block the relay for the whole room.
- **Checked by:** review only for now: any wait without a cap or timeout, any queue shared between devices and any limit that isn't a named constant.

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
- **Why:** on Day 1 a review tool's fix looked right and broke the app twice: it crashed as soon as two devices connected and screens could never join. Only this test caught it.
- **Checked by:** the test output in the PR description. If a run couldn't happen (for example no internet for the relay run), the PR says so. It never claims a pass it didn't see.

## Known gaps
These are known. Don't flag them as new findings. Do flag any change that makes them worse.
- The room server could swap public keys during key exchange. There is no check both people can compare yet.
- Anyone with the room code can join the room. The host can't confirm who is in it yet.
- Files from other devices aren't checked for what they contain, only for size and fingerprint. A file could be harmful.

# Testing: universal sharing

How the product is tested. Requirement IDs are in the [PRD](PRD.md). Misuse cases are in the [threat model](THREAT-MODEL.md#misuse-cases). The design being tested is in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Approach (V-model)
Each level of specification is paired with the level of testing that proves it. Development itself is iterative and tracked on the project board. The V-model is used to plan the tests.

```mermaid
flowchart TB
  subgraph Spec["Specify"]
    direction TB
    R["Requirements<br/>goals, user stories, misuse cases"]
    SS["System specification<br/>PRD requirements"]
    AR["Architecture<br/>ARCHITECTURE.md"]
    MD["Module design<br/>one job per file"]
  end
  subgraph Verify["Verify"]
    direction TB
    AT["Acceptance tests<br/>Given / When / Then on real devices"]
    ST["System tests<br/>two-browser test, direct and relay"]
    IT["Integration tests<br/>messages between live devices"]
    UT["Unit tests<br/>check.js, seal.js, layout.js"]
  end
  C(["Code"])
  R --> SS --> AR --> MD --> C --> UT --> IT --> ST --> AT
  R -.- AT
  SS -.- ST
  AR -.- IT
  MD -.- UT
```

## 2. Test plan
Which level of test proves each requirement. Results are recorded on each requirement's issue.

| Requirements | Level | Test |
|---|---|---|
| G1, N1 | Acceptance | A first-time user shares one photo from an iPhone to a laptop, timed from opening the link to "Tap to save" |
| G1, N1 | System | The two-browser test records time to ready and transfer time, direct and relay. The measured relay speed is written into the test output so the 15 s target can be checked against real numbers |
| N4 | Acceptance | Share a file using only the keyboard, then with VoiceOver |
| US1–US17 | Acceptance | Each Given / When / Then on real devices |
| Misuse cases | Acceptance, Integration | Each attack must fail. The threat model says which run automatically |
| C2–C9, C13 | System | Two-browser test, direct and relay (exists) |
| C14, F1, F5, F7–F10 | System | New two-browser cases (to write) |
| N2, Q2 | System | Two-browser test in Chromium and WebKit |
| Q1 | System | Two-browser test as a required GitHub check |
| C10, N3, S1.1, S1.2, S1.4–S1.6, S2, S7, S10 | Integration | The attack or malformed message is sent between live devices and must change nothing |
| S1.3 | Unit, System | `tests/peers.test.mjs`: a device that never sends its key or never drains its buffer is given up on after 10 s, a draining or throttled link finishes, a dropped message is reported so a print can be announced again when a late key arrives, and one relay frame that fails to send doesn't block later frames. The two-browser test asks for a photo from a silent device while two others keep transferring, checks a read error isn't blamed on the other device and holds back a device's key for 11 s so a print to it is dropped, then checks the print is announced again once the key comes (exists) |
| S3 | Integration | Matching words. A swapped key makes them differ |
| C1, C11 | Unit | `tests/check.test.mjs` (exists) |
| S6 | Unit, System | `tests/strip.test.mjs`: iPhone- and Android-style JPEG fixtures lose GPS and camera details, stay upright and a JPEG without metadata is unchanged. The two-browser test sends one with and one without "Keep details" (exists) |
| S5, S12 | Unit | New fixtures for file types and links (to write) |
| `seal.js`, `layout.js` | Unit | Key derivation, sealing and layout solving (to write) |
| F2 | System | Progress and error messages appear during a transfer and a failed fingerprint check (to write) |
| F3 | Acceptance | Save a received photo to the camera roll on an iPhone and an Android phone (manual) |
| F4 | System | A file already held is marked and not requested again (to write) |
| F6 | System | 50 prints added at once never fully cover each other (to write) |
| S4 | Integration | A device the host hasn't accepted receives nothing (to write) |
| S9 | Integration, Acceptance | A blocked device's prints disappear. A stranger's thumbnail is blurred (to write) |
| S11 | Integration | A room's code stops working 30 minutes after the last device leaves (to write) |
| S13 | System | After Leave, no received file or thumbnail is left in memory and the tab's keys are gone from IndexedDB (to write) |
| S14 | Unit, System | `tests/thumb.test.mjs`: a thumbnail over 400 × 400 pixels, whose size can't be read or with bytes after its end marker is not decoded. The two-browser test sends 400 × 400, 401 × 400, a 30000 × 30000 image bomb and a 400 × 400 with 30000 bytes after its end: only the first is decoded, the others show a plain card (exists) |
| S15 | Acceptance | The site loaded inside another site's frame refuses to run (manual) |
| S16 | System | The room code is gone from the address bar after joining (to write) |
| S8 | Integration | A client without a token from the site cannot join a room's channel (to write) |
| Q3 | Acceptance | The Qodo review standards list shows one fingerprint standard (manual) |
| S17 | Unit | HEIC, PNG, WebP and video fixtures with GPS arrive without it (to write) |
| L2 | Acceptance | A first-time user joins screens with only the on-screen guide (manual) |
| C15 | System | Two browsers click facing join tabs within 2 s and join. Non-facing tabs don't join and nor do taps 3 s apart. Undo splits them (to write) |
| C16 | Integration | A mini-map request joins nothing until the other device accepts. "No" leaves both screens as they were (to write) |
| F11, F12 | System | Three devices: a print dropped into a joined space is fetched by both others with no drag. A print shared with everyone reaches a device that isn't joined. A 30 MB file waits for a tap. Nothing is fetched by itself during a join's 10-second Undo window, nor prints from before the join (to write) |
| F13 | Acceptance | "Save all" opens the share sheet once with every received photo on an iPhone and an Android phone (manual) |
| F16 | System | A drag ended by `pointercancel` puts the print back. A print pushed past the screen edge keeps 40 px on screen. A print dropped across a shared edge ends fully on one screen (to write) |
| F17 | System | Click, move, click moves a print with no button held. Esc puts it back (to write) |
| F18 | Acceptance | On a real iPhone and Android phone, using the site never triggers a back swipe, a pull-down panel or the home bar (manual) |
| S18 | System | Reloading a joined device mid-transfer keeps its id, name and join, and the transfer restarts and finishes. No received bytes are in IndexedDB. A duplicated tab gets a new id. After a tab closes, the next start-up deletes its stored keys (to write) |
| S19 | Unit | A table of names: "Sam" clashes with "sam", "SAM", "Ｓａｍ" and " Sam "; "José" clashes with "Jose"; "Sam M" doesn't clash with "Sam"; names with a zero-width space, a text-direction override, mixed scripts or 25 characters are refused; "👩‍👩‍👧" counts as one character (to write) |
| S20 | System | With "Remember this device" on, a reload in a new tab shows "seen before" to the other device. A different device using the same name shows "new device". Forget clears both (to write) |
| R1–R4 | System | Chaos runs of the browser test: a share of relay frames dropped, a holder stopped halfway, a device delayed, a piece corrupted. Each must still end with the right SHA-256. Results go to the R4 dashboard (later) |

## 3. Running the tests
```sh
npm run test:unit       # unit tests
npm run test:browsers   # two-browser test, direct then relay (needs internet)
npm test                # both
```

# qodo-hack-2026: the photo table

Everyone's photos on one table. Take only the ones you want. Nobody in the middle can see them.

Friends put their phones, tablets and laptops together. The screens join into one shared table, everyone's photos spread across it like printed polaroids, and each person drags the ones they want onto their own device. It runs in any modern browser: no app, no account, no swapping phone numbers, and it works between iPhone, Android and Linux, Windows or Mac laptops.

Built for the [Qodo "Build a Software Factory in 30 Days"](https://hackathon.qodo.ai) hackathon. Live at **https://jtbinith.github.io/qodo-hack-2026/**

## What works today

- **Join screens:** devices join a table with a code. Push the glowing orb towards a shared edge on two screens at the same moment and those edges join, so the table spans both screens.
- **Share:** add photos or videos, and they appear on the table as prints that everyone at the table can see.
- **Take:** drag a print onto your screen and the full original file comes to your device. Tap it to save (the share sheet on iPhone, a download on a laptop).
- **Any network:** photos go directly between devices (WebRTC) when the network allows it. On hotel Wi-Fi or mobile data, where direct links are blocked, they go through the room server instead, end-to-end encrypted.

Tested on an iPhone 12 (Safari, iOS 26) and a Linux laptop (Chrome) on hotel Wi-Fi.

## How it works

| File | What it does |
|---|---|
| `web/index.html` | The table: joining screens, prints, dragging, saving |
| `web/net.js` | The room: who is here, a shared clock (synced to the earliest device) and screen joins, over Supabase Realtime |
| `web/layout.js` | Where every screen sits in the shared table, from its edge joins |
| `web/peers.js` | Links between devices: direct WebRTC first, the encrypted relay as a fallback; files stream in pieces |
| `web/seal.js` | End-to-end encryption: ECDH P-256 key exchange, HKDF, AES-256-GCM |
| `web/pick-test.html` | Test page: what a browser gives you when you pick photos (type, size, date, location, hashes) |

The room server (Supabase) only relays messages. It sees public keys and encrypted bytes, never a photo.

## Known gaps (honest list)

- The room server could swap public keys in transit (an active attack). Fix planned: both devices show a matching check built from the key fingerprints.
- Anyone who knows a table code can join that table. Fix planned: the host confirms who is at the table.
- On iPhone, videos save as a file, not into Photos.
- The encrypted relay is slow (about 0.5 MB a second). A TURN relay would make blocked networks faster.
- Test with your own photos only until the gaps above are fixed.

## History

This repo started as Polywogs (coding club kids' 3D models coming alive). I changed my mind about the project on 11 Nov 2026. The Polywogs commits and pull requests are kept in the history.

## Credits

[supabase-js](https://github.com/supabase/supabase-js), [exifr](https://github.com/MikeKovarik/exifr) and [hash-wasm](https://github.com/Daninet/hash-wasm), all MIT, in `web/vendor/`.

# qodo-hack-2026

Share photos between any devices in the same room, in the browser. No app, no account.

Devices join a room with a code and their screens join into one shared space. Photos appear as prints that everyone can see, and you drag the ones you want onto your own screen to get the full file.

Live: https://jtbinith.github.io/qodo-hack-2026/

## How it works

- Rooms, screen joins and the shared clock run over Supabase Realtime (`web/net.js`, `web/layout.js`).
- Files go device to device over WebRTC. If the network blocks that, they go through the room server, end-to-end encrypted (`web/peers.js`, `web/seal.js`).
- Everything received from other devices is checked before use (`web/check.js`).

## Limits

- The room server could swap encryption keys (an active attack). There is no check for this yet.
- Anyone with the room code can join the room.
- Test with your own photos only.

Built for the [Qodo hackathon](https://hackathon.qodo.ai). This repo started as a different project (Polywogs); its history is kept.

Uses [supabase-js](https://github.com/supabase/supabase-js), [exifr](https://github.com/MikeKovarik/exifr) and [hash-wasm](https://github.com/Daninet/hash-wasm) (MIT), in `web/vendor/`.

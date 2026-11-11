// Links between everyone at the table. Two ways to reach a device:
//   1. direct: a WebRTC data channel (fast; fails on hotel Wi-Fi, mobile data, etc.)
//   2. relay: through the room server (Supabase), end-to-end encrypted with seal.js so the
//      server only sees ciphertext. Used whenever the direct link isn't open.
// Both carry the same frames: [4-byte header length][JSON header][payload bytes].
//
// Direct links use "perfect negotiation": either side may start; if both start at once the
// "polite" side (smaller id) backs off.

import { makeKeyPair, deriveKey, seal, open, b64, unb64 } from './seal.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const DIRECT_CHUNK = 64 * 1024;
const RELAY_CHUNK = 24 * 1024;   // keeps each relay message well under the server's size limit
const RELAY_GAP = 45;            // ms between relay messages (stays under the server's rate limit)
const KEY_TIMEOUT = 5000;        // ms to wait for a peer's public key before giving up on the relay
const HIGH_WATER = 1 << 20;

export function createPeers({ myId, table, signal, forceRelay = false }) {
  const links = {};   // peer id -> { pc, dc, open, polite, makingOffer, ignoreOffer, key, keyReady, gotKey }
  const handlers = new Set();
  const emit = (from, msg, bytes) => handlers.forEach((f) => f(from, msg, bytes));
  const mine = makeKeyPair();

  function link(peer) {
    if (links[peer]) return links[peer];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const L = links[peer] = { pc, dc: null, open: false, polite: myId < peer, makingOffer: false, ignoreOffer: false };
    const keyWait = new Promise((r) => (L.gotKey = r));
    // resolves when the key arrives or after a timeout, so one silent peer can't stall the relay queue
    L.keyReady = Promise.race([keyWait, new Promise((r) => setTimeout(r, KEY_TIMEOUT))]);
    mine.then(({ pub }) => signal(peer, { pub: b64(pub) }));     // swap public keys
    const attach = (dc) => {
      L.dc = dc;
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = HIGH_WATER / 2;
      dc.onopen = () => { L.open = !forceRelay; }; // forceRelay: test the encrypted relay path
      dc.onclose = () => { L.open = false; };
      dc.onmessage = (e) => onFrame(peer, new Uint8Array(e.data));
    };
    if (myId < peer) attach(pc.createDataChannel('table', { ordered: true }));
    pc.ondatachannel = (e) => attach(e.channel);
    pc.onicecandidate = ({ candidate }) => candidate && signal(peer, { cand: candidate.toJSON() });
    pc.onnegotiationneeded = async () => {
      try { L.makingOffer = true; await pc.setLocalDescription(); signal(peer, { desc: pc.localDescription.toJSON() }); }
      finally { L.makingOffer = false; }
    };
    return L;
  }

  async function onSignal(from, data) {
    const L = link(from), pc = L.pc;
    if (data.pub) {
      if (L.key || L.keyFailed) return;     // first key wins; ignore later swaps
      try {
        const { kp } = await mine;
        L.key = await deriveKey(kp, unb64(data.pub), { table, a: myId, b: from });
      } catch (e) {
        L.keyFailed = true;                 // malformed key: stop waiting on this peer
        console.warn('bad key from', from, e);
      }
      L.gotKey();
    } else if (data.r) {                    // relayed, encrypted frame
      await L.keyReady;
      let frame;
      try { frame = await open(L.key, unb64(data.r), from, myId); } catch { return; } // tampered or not for us
      onFrame(from, frame);
    } else if (data.desc) {
      const collision = data.desc.type === 'offer' && (L.makingOffer || pc.signalingState !== 'stable');
      L.ignoreOffer = !L.polite && collision;
      if (L.ignoreOffer) return;
      await pc.setRemoteDescription(data.desc);
      if (data.desc.type === 'offer') { await pc.setLocalDescription(); signal(from, { desc: pc.localDescription.toJSON() }); }
    } else if (data.cand) {
      try { await pc.addIceCandidate(data.cand); } catch (e) { if (!L.ignoreOffer) console.warn(e); }
    }
  }

  function onFrame(from, u8) {
    const n = new DataView(u8.buffer, u8.byteOffset).getUint32(0);
    const head = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + n)));
    emit(from, head, u8.subarray(4 + n));
  }
  function frame(head, bytes = new Uint8Array(0)) {
    const h = new TextEncoder().encode(JSON.stringify(head));
    const buf = new Uint8Array(4 + h.length + bytes.length);
    new DataView(buf.buffer).setUint32(0, h.length);
    buf.set(h, 4); buf.set(bytes, 4 + h.length);
    return buf;
  }

  // One relay queue for the whole page, paced so we don't trip the server's rate limit.
  let relayTail = Promise.resolve();
  function relay(peer, buf) {
    const L = link(peer);
    relayTail = relayTail.then(async () => {
      await L.keyReady;
      if (!L.key) return;                   // no usable key for this peer: drop instead of blocking the queue
      signal(peer, { r: b64(await seal(L.key, buf, myId, peer)) });
      await new Promise((r) => setTimeout(r, RELAY_GAP));
    });
    return relayTail;
  }

  async function sendFrame(peer, buf) {
    const L = link(peer);
    if (L.open && L.dc.readyState === 'open') {
      if (L.dc.bufferedAmount > HIGH_WATER) await new Promise((r) => L.dc.addEventListener('bufferedamountlow', r, { once: true }));
      L.dc.send(buf);
    } else await relay(peer, buf);
  }

  const send = (peer, msg) => sendFrame(peer, frame(msg));

  // Stream a File/Blob in pieces without loading it all into memory. `only` resends
  // just the listed pieces (after the receiver reports gaps).
  async function sendFile(peer, fid, file, only = null, cs = null) {
    const L = link(peer);
    cs = cs || (L.open ? DIRECT_CHUNK : RELAY_CHUNK);
    const n = Math.ceil(file.size / cs) || 1;
    for (const i of only || [...Array(n).keys()]) {
      const bytes = new Uint8Array(await file.slice(i * cs, (i + 1) * cs).arrayBuffer());
      await sendFrame(peer, frame({ t: 'chunk', fid, i, n, cs }, bytes));
    }
  }

  return {
    onSignal, send, sendFile,
    connect: (peer) => link(peer),
    on: (f) => handlers.add(f),
    path: (peer) => { const L = links[peer]; return !L ? 'none' : L.open ? 'direct' : L.key ? 'relay (encrypted)' : 'keys…'; },
    state: (peer) => links[peer]?.pc.connectionState || 'none',
  };
}

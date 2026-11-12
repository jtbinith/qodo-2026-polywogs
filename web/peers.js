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
const HOLD = 400;                // relay frames held per peer while its key is on the way (each ≤ 24 KB)
const HIGH_WATER = 1 << 20;
const SEND_TIMEOUT = 10000;      // ms a send waits on one device with no progress before giving up (S1.3)
const DRAIN_CHECK = 1000;        // ms between checks that a full direct buffer is still draining

// A send gave up because the other device stopped answering.
export class SendTimeout extends Error {
  constructor(peer) { super(`no progress from ${peer} for ${SEND_TIMEOUT / 1000} s`); this.name = 'SendTimeout'; this.peer = peer; }
}

// Wait on one device, giving up after SEND_TIMEOUT with no progress. `start(ok, progress)`
// begins the wait: it calls ok(value) when done and progress() to restart the timer, and
// returns a function that cancels the wait.
function waitOn(peer, start) {
  return new Promise((resolve, reject) => {
    let timer, cancel = () => {};
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { cancel(); reject(new SendTimeout(peer)); }, SEND_TIMEOUT); };
    arm();
    cancel = start((v) => { clearTimeout(timer); cancel(); resolve(v); }, arm) || cancel;
  });
}

export function createPeers({ myId, table, signal, forceRelay = false }) {
  const links = {};   // peer id -> { pc, dc, open, polite, makingOffer, ignoreOffer, pending, key, keyFailed, outbox, inbox }
  const handlers = new Set();
  const emit = (from, msg, bytes) => handlers.forEach((f) => f(from, msg, bytes));
  const mine = makeKeyPair();

  function link(peer) {
    if (links[peer]) return links[peer];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const L = links[peer] = { pc, dc: null, open: false, polite: myId < peer, makingOffer: false, ignoreOffer: false, pending: [] };
    // Frames for or from this peer wait here until its key arrives. They never sit in the
    // shared relay queue, so one silent peer can't hold up anyone else.
    L.outbox = []; L.inbox = [];
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
      // Answer a first-time key with ours, in case our earlier one was sent before they
      // were listening (a device that just joined can miss it). Replies aren't answered.
      if (!data.reply) mine.then(({ pub }) => signal(from, { pub: b64(pub), reply: true }));
      if (L.key || L.keyFailed) return;     // first key wins; ignore later swaps
      try {
        const { kp } = await mine;
        L.key = await deriveKey(kp, unb64(data.pub), { table, a: myId, b: from });
      } catch (e) {
        L.keyFailed = true;                 // malformed key: stop waiting on this peer
        console.warn('bad key from', from, e);
      }
      keyArrived(from, L);
    } else if (data.r) {                    // relayed, encrypted frame
      if (L.keyFailed) return;
      if (!L.key) { if (L.inbox.length < HOLD) L.inbox.push(data.r); return; }
      await openRelayed(from, L, data.r);
    } else if (data.desc) {
      const collision = data.desc.type === 'offer' && (L.makingOffer || pc.signalingState !== 'stable');
      L.ignoreOffer = !L.polite && collision;
      if (L.ignoreOffer) return;
      await pc.setRemoteDescription(data.desc);
      // candidates that arrived before this description can be applied now
      for (const c of L.pending.splice(0)) { try { await pc.addIceCandidate(c); } catch (e) { console.warn(e); } }
      if (data.desc.type === 'offer') { await pc.setLocalDescription(); signal(from, { desc: pc.localDescription.toJSON() }); }
    } else if (data.cand) {
      // too early (no remote description yet): keep it for later instead of losing it
      if (!pc.remoteDescription) { if (L.pending.length < 50) L.pending.push(data.cand); return; }
      try { await pc.addIceCandidate(data.cand); } catch (e) { if (!L.ignoreOffer) console.warn(e); }
    }
  }

  function onFrame(from, u8) {
    let head;
    try {
      if (u8.length < 4) return;
      const n = new DataView(u8.buffer, u8.byteOffset).getUint32(0);
      if (n > 4096 || 4 + n > u8.length) return;          // header must fit and stay small
      head = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + n)));
      if (!head || typeof head !== 'object') return;
      emit(from, head, u8.subarray(4 + n));
    } catch (e) { console.warn('bad frame from', from, e); }
  }
  function frame(head, bytes = new Uint8Array(0)) {
    const h = new TextEncoder().encode(JSON.stringify(head));
    const buf = new Uint8Array(4 + h.length + bytes.length);
    new DataView(buf.buffer).setUint32(0, h.length);
    buf.set(h, 4); buf.set(bytes, 4 + h.length);
    return buf;
  }

  async function openRelayed(from, L, r) {
    let frame;
    try { frame = await open(L.key, unb64(r), from, myId); } catch { return; } // tampered or not for us
    onFrame(from, frame);
  }
  // A peer's key has arrived (or turned out bad): deliver what was waiting for it.
  async function keyArrived(peer, L) {
    const out = L.outbox.splice(0), inb = L.inbox.splice(0);
    if (!L.key) { out.forEach((o) => o.done()); return; } // bad key: drop, but don't leave senders hanging
    for (const o of out) o.done(enqueue(peer, L, o.buf));  // stops its timer: the shared queue isn't a wait on the device
    for (const r of inb) await openRelayed(peer, L, r);
  }

  // One relay queue for the whole page, paced so we don't trip the server's rate limit.
  // Only frames whose key is ready go in it.
  let relayTail = Promise.resolve();
  function enqueue(peer, L, buf) {
    relayTail = relayTail.then(async () => {
      signal(peer, { r: b64(await seal(L.key, buf, myId, peer)) });
      await new Promise((r) => setTimeout(r, RELAY_GAP));
    });
    return relayTail;
  }
  function relay(peer, buf) {
    const L = link(peer);
    if (L.keyFailed) return Promise.resolve();
    if (L.key) return enqueue(peer, L, buf);
    if (L.outbox.length >= HOLD) return Promise.resolve();
    return waitOn(peer, (done) => {
      const o = { buf, done };
      L.outbox.push(o);
      return () => { const i = L.outbox.indexOf(o); if (i >= 0) L.outbox.splice(i, 1); };   // timed out: never sent
    });
  }

  async function sendFrame(peer, buf) {
    const L = link(peer);
    if (L.open && L.dc.readyState === 'open') {
      if (L.dc.bufferedAmount > HIGH_WATER) await drained(peer, L.dc);
      L.dc.send(buf);
    } else await relay(peer, buf);
  }

  // Wait for a full direct buffer to drain. A slow link that keeps draining restarts the timer.
  function drained(peer, dc) {
    return waitOn(peer, (done, progress) => {
      let last = dc.bufferedAmount;
      const check = setInterval(() => { if (dc.bufferedAmount < last) progress(); last = dc.bufferedAmount; }, DRAIN_CHECK);
      const low = () => done();
      dc.addEventListener('bufferedamountlow', low, { once: true });
      return () => { clearInterval(check); dc.removeEventListener('bufferedamountlow', low); };
    });
  }

  // A short message that can't be sent in time is dropped. Every caller can ask again.
  const send = (peer, msg) => sendFrame(peer, frame(msg)).catch((e) => console.warn('dropped message to', peer, e.message));

  // Stream a File/Blob in pieces without loading it all into memory. `only` resends
  // just the listed pieces (after the receiver reports gaps). Rejects with SendTimeout if the
  // device stops answering; the rest of the file is not sent.
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

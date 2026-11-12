// Unit tests for web/peers.js: no send waits forever on another device (S1.3, threat T-D4).
// WebRTC is replaced with a fake so a test can hold a device's buffer full or keep its key
// back, and the clock is mocked so 10 seconds pass instantly.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPeers } from '../web/peers.js';
import { makeKeyPair, b64 } from '../web/seal.js';

const TIMEOUT = 10_000;              // the ticket: a send gives up after 10 s with no progress
const FULL = 2 << 20;                // more than the direct link's high-water mark
const PIECE = 64 * 1024;             // one piece on a direct link

const channels = [];
class FakeChannel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0; bufferedAmountLowThreshold = 0; sent = 0;
  send() { this.sent++; }
  drainTo(n) { this.bufferedAmount = n; if (n <= this.bufferedAmountLowThreshold) this.dispatchEvent(new Event('bufferedamountlow')); }
}
class FakePC {
  connectionState = 'new';
  createDataChannel() { const dc = new FakeChannel(); channels.push(dc); return dc; }
}
globalThis.RTCPeerConnection = FakePC;

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }));
afterEach(() => mock.timers.reset());

// Let real async work (file reads, crypto) finish. setImmediate isn't mocked.
const settle = async (n = 50) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const tick = async (ms) => { mock.timers.tick(ms); await settle(); };
async function waitFor(cond) { for (let i = 0; i < 5000 && !cond(); i++) await new Promise((r) => setImmediate(r)); assert.ok(cond(), 'condition never met'); }
function watch(p) {
  const s = { state: 'pending' };
  p.then(() => { s.state = 'fulfilled'; }, (e) => { s.state = 'rejected'; s.error = e; });
  return s;
}
function room() {
  const sent = [];
  const peers = createPeers({ myId: 'a', table: 'T', signal: (to, d) => sent.push([to, d]) });
  return { peers, frames: (to) => sent.filter(([t, d]) => t === to && d.r).length };
}
async function giveKey(peers, from) { const { pub } = await makeKeyPair(); await peers.onSignal(from, { pub: b64(pub), reply: true }); }
function direct(peers, peer) { peers.connect(peer); const dc = channels.at(-1); dc.onopen(); return dc; }
const file = (bytes) => new Blob([new Uint8Array(bytes)]);

test('a send to a device that never sends its key gives up after 10 s', async () => {
  const { peers } = room();
  const s = watch(peers.sendFile('c', 'f1', file(100)));
  await settle();
  await tick(TIMEOUT - 1);
  assert.equal(s.state, 'pending', 'gave up too early');
  await tick(1);
  assert.equal(s.state, 'rejected', 'still waiting after 10 s');
});

test('the cancelled send is not delivered late, and the receiver can ask again', async () => {
  const { peers, frames } = room();
  const s = watch(peers.sendFile('c', 'f1', file(100)));
  await settle(); await tick(TIMEOUT);
  assert.equal(s.state, 'rejected');
  await giveKey(peers, 'c');
  await settle();
  assert.equal(frames('c'), 0, 'a cancelled piece was sent once the key arrived');
  const again = watch(peers.sendFile('c', 'f1', file(100)));   // the receiver asks again
  await waitFor(() => frames('c') === 1);
  await tick(100);
  assert.equal(again.state, 'fulfilled');
});

test('a key that arrives before 10 s lets the send finish', async () => {
  const { peers, frames } = room();
  const s = watch(peers.sendFile('b', 'f1', file(100)));
  await settle(); await tick(TIMEOUT - 1000);
  await giveKey(peers, 'b');
  await waitFor(() => frames('b') === 1);
  await tick(2000);
  assert.equal(s.state, 'fulfilled');
});

test('a direct link whose buffer never drains gives up after 10 s', async () => {
  const { peers } = room();
  const dc = direct(peers, 'b');
  dc.bufferedAmount = FULL;
  const s = watch(peers.sendFile('b', 'f1', file(100)));
  await settle();
  await tick(TIMEOUT - 1);
  assert.equal(s.state, 'pending', 'gave up too early');
  await tick(1);
  assert.equal(s.state, 'rejected', 'still waiting after 10 s');
  assert.equal(dc.sent, 0);
});

test('the timer restarts whenever the buffer drains', async () => {
  const { peers } = room();
  const dc = direct(peers, 'b');
  dc.bufferedAmount = FULL;
  const s = watch(peers.sendFile('b', 'f1', file(2 * PIECE)));   // two pieces, each waits 9 s
  await settle();
  await tick(TIMEOUT - 1000);
  dc.drainTo(0); dc.bufferedAmount = FULL;                        // first piece goes, buffer full again
  await settle();
  await tick(TIMEOUT - 1000);
  assert.equal(s.state, 'pending', 'gave up though the buffer drained 9 s ago');
  dc.drainTo(0);
  await settle();
  assert.equal(s.state, 'fulfilled');
  assert.equal(dc.sent, 2);
});

test('a throttled but working link finishes', async () => {
  const { peers } = room();
  const dc = direct(peers, 'b');
  dc.bufferedAmount = FULL;
  const s = watch(peers.sendFile('b', 'f1', file(100)));
  await settle();
  for (let t = 0; t < 25; t++) {                                  // 25 s of slow draining, never below the low mark
    dc.bufferedAmount -= 50 * 1024;
    await tick(1000);
    assert.equal(s.state, 'pending', `gave up after ${t + 1} s though the buffer was draining`);
  }
  dc.drainTo(0);
  await settle();
  assert.equal(s.state, 'fulfilled');
});

test('a silent device times out while two others keep transferring', async () => {
  const { peers, frames } = room();
  await giveKey(peers, 'b');
  const silent = watch(peers.sendFile('c', 'f1', file(100)));
  await settle();
  const live = watch(peers.sendFile('b', 'f2', file(100)));
  await waitFor(() => frames('b') === 1);
  await tick(100);
  assert.equal(live.state, 'fulfilled', 'the silent device held up the other transfer');
  assert.equal(silent.state, 'pending');
  await tick(TIMEOUT);
  assert.equal(silent.state, 'rejected');
  const later = watch(peers.sendFile('b', 'f3', file(100)));
  await waitFor(() => frames('b') === 2);
  await tick(100);
  assert.equal(later.state, 'fulfilled');
});

test('a short message to a silent device is dropped after 10 s without an error', async () => {
  const { peers } = room();
  const s = watch(peers.send('c', { t: 'have', pid: '0123456789abcdef' }));
  await settle(); await tick(TIMEOUT);
  assert.equal(s.state, 'fulfilled');
});

// Qodo on #44: a print dropped after 10 s was still counted as announced, so a device whose
// key came late never saw the photo. The caller must learn the message was dropped, and when
// the key arrives, so it can announce again.
test('a short message says whether it was sent or dropped', async () => {
  const { peers } = room();
  const lost = peers.send('c', { t: 'print', pid: '0123456789abcdef' });
  await settle(); await tick(TIMEOUT);
  assert.equal(await lost, false, 'a dropped message was reported as sent');
  await giveKey(peers, 'b');
  const sent = peers.send('b', { t: 'print', pid: '0123456789abcdef' });
  await settle(); await tick(100);
  assert.equal(await sent, true, 'a sent message was reported as dropped');
  const late = peers.send('d', { t: 'print', pid: '0123456789abcdef' });
  await settle(); await tick(TIMEOUT - 1000);
  await giveKey(peers, 'd');
  await settle(); await tick(100);
  assert.equal(await late, true, 'a message held until the key came was reported as dropped');
});

test('the caller hears when a device\'s key arrives, but not a bad one', async () => {
  const { peers } = room();
  const ready = [];
  peers.onReady((peer) => ready.push(peer));
  peers.send('c', { t: 'print', pid: '0123456789abcdef' });
  await settle(); await tick(TIMEOUT);
  await giveKey(peers, 'c');                                       // the key comes after the print was dropped
  await settle();
  assert.deepEqual(ready, ['c']);
  await peers.onSignal('e', { pub: 'not a key', reply: true });
  await settle();
  assert.deepEqual(ready, ['c'], 'a bad key was reported as ready');
});

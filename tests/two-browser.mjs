// The two-browser test: two browser windows play two devices. They join a room, join
// screens, one shares photos and a video, drags them onto the other screen, and the other
// must end up with byte-identical files. Also checks a stranger's malformed messages are
// ignored and that a late guest still sees photos after their owner leaves.
//
//   node tests/two-browser.mjs           direct device-to-device path (WebRTC)
//   node tests/two-browser.mjs --relay   force the end-to-end encrypted relay path
//
// Needs internet access (rooms run over Supabase Realtime). Serves web/ on 127.0.0.1 only.
import { chromium } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';
import { serve } from './serve.mjs';

const RELAY = process.argv.includes('--relay');
const server = await serve(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = [...randomBytes(10)].map((b) => ALPHABET[b & 31]).join('');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed = true; };

const browser = await chromium.launch();
async function device(w, h) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.on('pageerror', (e) => { console.log('page error:', e.message); failed = true; });
  await page.goto(`${BASE}?room=${room}&auto${RELAY ? '&relay' : ''}`);
  return page;
}
const until = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });

try {
  const A = await device(900, 600), B = await device(390, 700);
  await until(A, () => window.__t && Object.keys(window.__t.net.peers).length === 2);
  await until(B, () => window.__t && Object.keys(window.__t.net.peers).length === 2);

  // join A's right edge to B's left edge at the same moment
  await Promise.all([A.evaluate(() => window.__t.net.push('R', 300)), B.evaluate(() => window.__t.net.push('L', 350))]);
  await until(A, () => window.__t.net.joins.length === 1); await until(B, () => window.__t.net.joins.length === 1);
  check(true, 'screens joined');

  // two real images (drawn in the browser) and one fake video
  const images = await A.evaluate(() => Promise.all([0, 1].map((i) => new Promise((ok) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
    g.fillStyle = i ? '#345' : '#c84'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillText('photo ' + i, 40, 60);
    c.toBlob(async (b) => ok([...new Uint8Array(await b.arrayBuffer())]), 'image/jpeg', 0.9);
  }))));
  const files = [
    { name: 'photo-0.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(images[0]) },
    { name: 'photo-1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(images[1]) },
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: randomBytes(60000) },
  ];
  await A.setInputFiles('#pick', files);
  await until(B, () => window.__t.prints.size === 3);
  await until(B, () => [...window.__t.prints.values()].filter((p) => p.img).length === 2);
  check(true, 'the other device sees 3 prints with 2 thumbnails');

  // drag photo-0 and the video onto B's screen
  for (const i of [0, 2]) await A.evaluate((i) => {
    const t = window.__t, p = [...t.prints.values()].filter((p) => p.owner === t.id)[i];
    const other = Object.keys(t.net.peers).find((k) => k !== t.id), o = t.layout.pos[other];
    t.setWorld(p, o[0] + 60, o[1] + 150 + i * 60);
    t.peers.send(other, { t: 'move', pid: p.pid, anchor: p.anchor, x: p.x, y: p.y, final: true });
    t.peers.send(other, { t: 'dropcheck', pid: p.pid });
  }, i);
  await until(B, () => window.__t.files.size === 2, null, 60000);
  const got = await B.evaluate(() => Promise.all([...window.__t.files.values()].map(async (f) => [f.name, [...new Uint8Array(await f.arrayBuffer())]])));
  for (const [name, bytes] of got) check(sha(Buffer.from(bytes)) === sha(files.find((f) => f.name === name).buffer), `${name} arrived byte-identical`);
  const path = await A.evaluate(() => { const t = window.__t; return t.peers.path(Object.keys(t.net.peers).find((k) => k !== t.id)); });
  check(RELAY ? path === 'relay (encrypted)' : path === 'direct', `went ${path}`);

  // a stranger's malformed messages are ignored
  const before = await B.evaluate(() => window.__t.prints.size);
  await A.evaluate(() => { const t = window.__t, k = Object.keys(t.net.peers).find((k) => k !== t.id);
    t.peers.send(k, { t: 'print', pid: 'abc' });
    t.peers.send(k, { t: 'chunk', fid: 'deadbeefdeadbeef', i: 0, n: 1e9, cs: 65536 });
    t.peers.send(k, { t: 'need', fid: 'x', missing: 'all' }); });
  await new Promise((r) => setTimeout(r, 1500));
  check(await B.evaluate(() => window.__t.prints.size) === before, 'malformed messages ignored');

  // a late guest still sees photos B holds after A (the owner) leaves
  await A.context().close();
  const C = await device(390, 700);
  await until(C, () => window.__t && window.__t.prints.size >= 2, null, 45000);
  check(true, 'late guest sees photos still held after the owner left');
} catch (e) {
  check(false, e.message.split('\n')[0]);
} finally {
  await browser.close(); server.close();
}
process.exit(failed ? 1 : 0);

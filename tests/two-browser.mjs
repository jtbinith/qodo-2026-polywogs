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

  // drag photo-0 and the video onto B's screen with the mouse: press on the print, move past
  // A's right edge (B's screen is joined there) and let go
  async function drag(page, name, toX) {   // toX: where to let go, in this page's screen x (beyond its right edge = the joined screen)
    const at = await page.evaluate((name) => {
      const t = window.__t, p = [...t.prints.values()].find((p) => p.name === name), [wx, wy] = t.world(p), me = t.layout.pos[t.id];
      return { x: wx - me[0] + p.w / 2, y: wy - me[1] + p.h / 2 };
    }, name);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(at.x + ((toX - at.x) * k) / 12, at.y);
    await page.mouse.up();
  }
  await drag(A, 'photo-0.jpg', 900 + 150);   // the middle of B's screen
  await drag(A, 'clip.mp4', 900 + 150);
  const before = await B.evaluate(() => window.__t.prints.size);
  await until(B, () => window.__t.files.size === 2, null, 60000);
  const got = await B.evaluate(() => Promise.all([...window.__t.files.values()].map(async (f) => [f.name, [...new Uint8Array(await f.arrayBuffer())]])));
  for (const [name, bytes] of got) check(sha(Buffer.from(bytes)) === sha(files.find((f) => f.name === name).buffer), `${name} arrived byte-identical`);
  const path = await A.evaluate(() => { const t = window.__t; return t.peers.path(Object.keys(t.net.peers).find((k) => k !== t.id)); });
  check(RELAY ? path === 'relay (encrypted)' : path === 'direct', `went ${path}`);

  // a stranger's malformed messages change nothing, even when aimed at a real transfer
  const ids = await A.evaluate(() => { const t = window.__t; return { a: t.id, b: Object.keys(t.net.peers).find((k) => k !== t.id) }; });
  const FID = '0123456789abcdef';
  await B.evaluate(([fid, from]) => window.__t.expect(fid, from, 50000), [FID, ids.a]);   // B is expecting this file from A
  await B.evaluate(() => { const t = window.__t; t.sent = 0; const real = t.peers.sendFile; t.peers.sendFile = (...a) => { t.sent++; return real(...a); }; });
  await A.evaluate(([fid, b]) => { const t = window.__t, junk = new Uint8Array(10), full = new Uint8Array(24576);
    t.peers.send(b, { t: 'print', pid: 'abc' });                                                   // malformed print
    t.peers.send(b, { t: 'want', pid: 'not-a-pid' });                                              // malformed request
    t.peers.send(b, { t: 'need', fid: 'x', missing: 'all' });                                      // malformed resend request
    t.peers.send(b, { t: 'need', fid: fid, missing: Array(1000).fill(0) });                         // resend request that is too big
    t.peers.sendFile(b, fid, new Blob([junk]), [0], 24576);                                         // piece too short for a 50000-byte file
    t.peers.sendFile(b, fid, new Blob([full]), [0], 1024);                                          // piece size that isn't allowed
  }, [FID, ids.b]);
  await new Promise((r) => setTimeout(r, 2000));
  const after = await B.evaluate((fid) => { const t = window.__t, inc = t.incoming.get(fid); return { prints: t.prints.size, got: inc ? inc.got : -1, sent: t.sent }; }, FID);
  check(after.prints === before, 'malformed print ignored');
  check(after.got === 0, 'bad pieces for a real transfer were dropped');
  check(after.sent === 0, 'malformed requests caused no resend');
  // a late guest still gets photos B holds after A (the owner) leaves
  await A.context().close();
  const C = await device(390, 700);
  await until(C, () => window.__t && window.__t.prints.size >= 2, null, 45000);
  check(true, 'late guest sees the photos still held after the owner left');
  await until(B, () => Object.keys(window.__t.net.peers).length === 2, null, 45000);   // A has left B's view of the room
  await Promise.all([B.evaluate(() => window.__t.net.push('R', 300)), C.evaluate(() => window.__t.net.push('L', 300))]);
  await until(C, () => window.__t.net.joins.length === 1, null, 30000);
  await drag(B, 'photo-0.jpg', 390 + 150);                                          // B drags its copy onto C
  await until(C, () => window.__t.files.size === 1, null, 60000);
  const [cname, cbytes] = await C.evaluate(async () => { const f = [...window.__t.files.values()][0]; return [f.name, [...new Uint8Array(await f.arrayBuffer())]]; });
  const original = files.find((f) => f.name === cname);   // prints can overlap, so check whichever one was picked up
  check(!!original && sha(Buffer.from(cbytes)) === sha(original.buffer), `late guest downloaded ${cname} from B byte-identical`);
} catch (e) {
  check(false, e.message.split('\n')[0]);
} finally {
  await browser.close(); server.close();
}
process.exit(failed ? 1 : 0);

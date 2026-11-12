// The two-browser test: two browser windows play two devices. They join a room, join
// screens, one shares photos and a video, drags them onto the other screen, and the other
// must end up with byte-identical files. An iPhone-style JPEG must arrive with its location
// and camera details removed, still upright, unless "Keep details" is ticked (S6). Also checks a stranger's malformed messages are
// ignored, that a send to a device that never answers gives up after 10 s without holding up
// anyone else (S1.3), that a print dropped while a device's key was late is announced again
// once the key comes (S1.3) and that a late guest can still download photos after their owner leaves.
//
//   node tests/two-browser.mjs           direct device-to-device path (WebRTC)
//   node tests/two-browser.mjs --relay   force the end-to-end encrypted relay path
//
// Needs internet access (rooms run over Supabase Realtime). Serves web/ on 127.0.0.1 only.
import { chromium } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';
import { serve } from './serve.mjs';
import { iphoneJpeg, heicFile, exifr } from './jpeg-fixtures.mjs';

const RELAY = process.argv.includes('--relay');
const server = await serve(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => [...randomBytes(10)].map((b) => ALPHABET[b & 31]).join('');
const room = code();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed = true; };

const browser = await chromium.launch();
async function device(w, h, { at = room, init } = {}) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.on('pageerror', (e) => { console.log('page error:', e.message); failed = true; });
  if (init) await page.addInitScript(init);
  await page.goto(`${BASE}?room=${at}&auto${RELAY ? '&relay' : ''}`);
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
    { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: Buffer.from(iphoneJpeg()) },     // GPS, camera details, rotated 90°, gain map
    { name: 'IMG_0002.HEIC', mimeType: 'image/heic', buffer: Buffer.from(heicFile()) },
  ];
  const kept = { name: 'IMG_0003.JPG', mimeType: 'image/jpeg', buffer: Buffer.from(iphoneJpeg()) };   // sent with "Keep details"
  await A.setInputFiles('#pick', files);
  await until(A, () => document.getElementById('toast').textContent.includes('on the table'));
  const said = await A.evaluate(() => document.getElementById('toast').textContent);
  check(/Details not removed from .*clip\.mp4/.test(said) && said.includes('IMG_0002.HEIC') && !said.includes('IMG_0001'), `video and HEIC warned: "${said}"`);
  await A.check('#keep');
  await A.setInputFiles('#pick', [kept]);
  await A.uncheck('#keep');
  files.push(kept);

  // ticking "Keep details" while a batch is still being prepared changes nothing for that batch:
  // the choice is the one made when the files were picked
  const batch = ['IMG_0004.JPG', 'IMG_0005.JPG'];
  await A.evaluate(([bytes, names]) => {
    const pick = document.getElementById('pick'), dt = new DataTransfer();
    for (const n of names) dt.items.add(new File([new Uint8Array(bytes)], n, { type: 'image/jpeg' }));
    pick.files = dt.files;
    pick.dispatchEvent(new Event('change'));
    document.getElementById('keep').checked = true;   // ticked for the next pick, while this one is still running
  }, [[...iphoneJpeg()], batch]);
  await until(A, (names) => names.every((n) => [...window.__t.prints.values()].some((p) => p.name === n)), batch);
  await A.uncheck('#keep');
  const held = await A.evaluate((names) => Promise.all([...window.__t.prints.values()].filter((p) => names.includes(p.name))
    .map(async (p) => [p.name, [...new Uint8Array(await window.__t.files.get(p.pid).arrayBuffer())]])), batch);
  for (const [name, bytes] of held) check(await exifr.gps(Buffer.from(bytes)) === undefined, `${name} cleaned though "Keep details" was ticked mid-batch`);

  // the mirror: ticked when picked, unticked mid-batch. The batch keeps its details, as chosen at pick time
  const kbatch = ['IMG_0006.JPG', 'IMG_0007.JPG'];
  await A.check('#keep');
  await A.evaluate(([bytes, names]) => {
    const pick = document.getElementById('pick'), dt = new DataTransfer();
    for (const n of names) dt.items.add(new File([new Uint8Array(bytes)], n, { type: 'image/jpeg' }));
    pick.files = dt.files;
    pick.dispatchEvent(new Event('change'));
    document.getElementById('keep').checked = false;   // unticked for the next pick, while this one is still running
  }, [[...iphoneJpeg()], kbatch]);
  await until(A, (names) => names.every((n) => [...window.__t.prints.values()].some((p) => p.name === n)), kbatch);
  const kheld = await A.evaluate((names) => Promise.all([...window.__t.prints.values()].filter((p) => names.includes(p.name))
    .map(async (p) => [p.name, [...new Uint8Array(await window.__t.files.get(p.pid).arrayBuffer())]])), kbatch);
  for (const [name, bytes] of kheld) check(await exifr.gps(Buffer.from(bytes)) !== undefined, `${name} kept its details though "Keep details" was unticked mid-batch`);

  await until(B, () => window.__t.prints.size === 10);
  await until(B, () => [...window.__t.prints.values()].filter((p) => p.img).length === 8);
  check(true, 'the other device sees 10 prints with 8 thumbnails');

  // drag photo-0 and the video onto B's screen with the mouse: press on the print, move past
  // A's right edge (B's screen is joined there) and let go
  async function drag(page, name, toX) {   // toX: where to let go, in this page's screen x (beyond its right edge = the joined screen)
    const at = await page.evaluate((name) => {
      const t = window.__t, p = [...t.prints.values()].find((p) => p.name === name), [wx, wy] = t.world(p), me = t.layout.pos[t.id];
      t.prints.delete(p.pid); t.prints.set(p.pid, p);   // on top, so the press picks this print even where prints overlap
      return { x: wx - me[0] + p.w / 2, y: wy - me[1] + p.h / 2 };
    }, name);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(at.x + ((toX - at.x) * k) / 12, at.y);
    await page.mouse.up();
  }
  await drag(A, 'photo-0.jpg', 900 + 150);   // the middle of B's screen
  await drag(A, 'clip.mp4', 900 + 150);
  await drag(A, 'IMG_0001.JPG', 900 + 150);
  await drag(A, 'IMG_0003.JPG', 900 + 150);
  const before = await B.evaluate(() => window.__t.prints.size);
  await until(B, () => window.__t.files.size === 4, null, 90000);
  const got = await B.evaluate(() => Promise.all([...window.__t.files.entries()].map(async ([pid, f]) => {
    const bmp = await createImageBitmap(f).catch(() => null), shown = bmp && [bmp.width, bmp.height];
    return [f.name, [...new Uint8Array(await f.arrayBuffer())], window.__t.prints.get(pid).sha, shown];
  })));
  const expected = Object.fromEntries(files.map((f) => [f.name, sha(f.buffer)]));   // what a late guest should get
  for (const [name, bytes, announced, shown] of got) {
    const buf = Buffer.from(bytes);
    if (name !== 'IMG_0001.JPG') { check(sha(buf) === expected[name], `${name} arrived byte-identical`); continue; }
    const meta = (await exifr.parse(buf, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false })) || {};
    check(sha(buf) === announced, `${name} passed its fingerprint check`);
    check(await exifr.gps(buf) === undefined && !meta.Make && !meta.Model && !buf.includes('hdrgm'), `${name} arrived without GPS, camera details or gain map`);
    check(await exifr.orientation(buf) === 6 && shown?.[0] === 8 && shown?.[1] === 16, `${name} still upright (shown ${shown?.join(' x ')})`);
    expected[name] = sha(buf);
  }
  const keptGot = got.find(([name]) => name === 'IMG_0003.JPG');
  check(!!keptGot && await exifr.gps(Buffer.from(keptGot[1])) !== undefined, 'IMG_0003.JPG ("Keep details") still has its GPS');
  const path = await A.evaluate(() => { const t = window.__t; return t.peers.path(Object.keys(t.net.peers).find((k) => k !== t.id)); });
  check(RELAY ? path === 'relay (encrypted)' : path === 'direct', `went ${path}`);

  // a device that never sends its key asks A for a photo. A gives up after 10 s and says so,
  // while A and B keep transferring (S1.3)
  const GHOST = 'zzzzsilent';
  const asked = Date.now();
  await A.evaluate((ghost) => { const t = window.__t, p = [...t.prints.values()].find((p) => p.name === 'photo-1.jpg');
    t.onMessage(ghost, { t: 'want', pid: p.pid }); }, GHOST);
  await drag(A, 'photo-1.jpg', 900 + 150);
  await until(B, () => window.__t.files.size === 5, null, 60000);
  const gaveUpEarly = await A.evaluate(() => document.getElementById('toast').textContent.includes('Couldn’t send'));
  check(!gaveUpEarly, `photo-1.jpg reached B after ${((Date.now() - asked) / 1000).toFixed(1)} s, while A still waited on the silent device`);
  const toldSender = await A.waitForFunction(() => document.getElementById('toast').textContent.includes('Couldn’t send'), null, { timeout: 20000 }).then(() => true, () => false);
  const waited = (Date.now() - asked) / 1000;
  check(toldSender && waited >= 10 && waited < 20, `send to a silent device gave up and told the sender (after ${waited.toFixed(1)} s)`);
  // a send that fails for another reason (here the file can't be read) doesn't blame the device
  const why = await A.evaluate(async (ghost) => {
    const t = window.__t, p = [...t.prints.values()].find((p) => p.name === 'photo-1.jpg'), real = t.files.get(p.pid);
    t.files.set(p.pid, { size: real.size, slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('file changed', 'NotReadableError')) }) });
    t.onMessage(ghost, { t: 'want', pid: p.pid });
    await new Promise((r) => setTimeout(r, 500));
    t.files.set(p.pid, real);
    return document.getElementById('toast').textContent;
  }, GHOST);
  check(why.includes('Couldn’t send photo-1.jpg') && !why.includes('stopped answering'), `a read error isn't blamed on the other device ("${why}")`);

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
  await until(C, () => window.__t && window.__t.prints.size >= 2, null, 45000);   // C has been told about the photos B still holds
  await until(B, () => Object.keys(window.__t.net.peers).length === 2, null, 45000);   // A has left B's view of the room
  await Promise.all([B.evaluate(() => window.__t.net.push('R', 300)), C.evaluate(() => window.__t.net.push('L', 300))]);
  await until(C, () => window.__t.net.joins.length === 1, null, 30000);
  await drag(B, 'photo-0.jpg', 390 + 150);                                          // B drags its copy onto C
  await until(C, () => window.__t.files.size === 1, null, 60000);
  const [cname, cbytes] = await C.evaluate(async () => { const f = [...window.__t.files.values()][0]; return [f.name, [...new Uint8Array(await f.arrayBuffer())]]; });
  check(!!expected[cname] && sha(Buffer.from(cbytes)) === expected[cname], `late guest downloaded ${cname} from B byte-identical`);

  // a device whose key is late: in a fresh room, B holds back its key for 11 s after A's
  // arrives, so A's print to B is dropped at 10 s. When the key comes, A must announce the
  // print again and B must end up with it (S1.3)
  const KEY_LATE = 11000;
  const holdKey = (late) => {   // runs in B's page before the app: wrap the app's signal lane once it exists
    let t, heard = 0; const held = [];
    Object.defineProperty(window, '__t', { configurable: true, get: () => t, set(v) {
      t = v; const sig = v.net.signal, on = v.peers.onSignal;
      v.net.signal = (to, d) => (d?.pub && !window.__keySent ? held.push([to, d]) : sig(to, d));
      v.peers.onSignal = (from, d) => {
        if (d?.pub && !heard) { heard = Date.now(); setTimeout(() => { window.__keySent = Date.now(); v.net.signal = sig; held.splice(0).forEach(([to, x]) => sig(to, x)); }, late); }
        return on(from, d);
      };
    } });
  };
  const late = code();
  const A2 = await device(900, 600, { at: late });
  const dropped = [];
  A2.on('console', (m) => { if (m.text().startsWith('dropped message to')) dropped.push(m.text()); });
  await until(A2, () => window.__t && window.__t.net.status === 'live');
  await A2.setInputFiles('#pick', [files[0]]);
  await until(A2, () => window.__t.prints.size === 1);
  const pid = await A2.evaluate(() => [...window.__t.prints.keys()][0]);
  const B2 = await device(390, 700, { at: late, init: `(${holdKey})(${KEY_LATE})` });
  const b2id = await until(B2, () => window.__t && window.__t.id).then((h) => h.jsonValue());
  await until(B2, () => window.__keySent, null, KEY_LATE + 20000);
  const early = await B2.evaluate((pid) => window.__t.prints.has(pid), pid);
  check(!early && dropped.some((d) => d.includes(b2id)), `A dropped its print to B while B's key was late (${dropped.find((d) => d.includes(b2id)) || 'nothing dropped'})`);
  const heard = await until(B2, (pid) => window.__t.prints.has(pid), pid, 20000).then(() => true, () => false);
  const took = await B2.evaluate(() => ((Date.now() - window.__keySent) / 1000).toFixed(1));
  check(heard, `A announced the print again once B's key came, and B has it (${took} s after the key)`);
} catch (e) {
  check(false, e.message.split('\n')[0]);
} finally {
  await browser.close(); server.close();
}
process.exit(failed ? 1 : 0);

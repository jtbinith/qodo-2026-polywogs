// Unit tests for web/strip.js (S6): location and device details are removed from JPEG photos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripJpeg, prepareFile, isJpeg, isHeic } from '../web/strip.js';
import { plainJpeg, progressiveJpeg, iphoneJpeg, androidJpeg, iphoneImage, iccApp2, heicFile, exifApp1, concat, segment, exifr } from './jpeg-fixtures.mjs';

const everything = { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, makerNote: true };
const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text));
const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());

test('the iPhone fixture really carries GPS, camera details, XMP and a gain map', async () => {
  const b = iphoneJpeg();
  assert.ok(await exifr.gps(b), 'GPS readable before');
  assert.equal((await exifr.parse(b, everything)).Model, 'iPhone 15 Pro');
  assert.ok(has(b, 'hdrgm') && has(b, 'MPF\0'));
});

test('an iPhone JPEG loses GPS, camera details, XMP, MPF and the gain map but stays upright', async () => {
  const out = stripJpeg(iphoneJpeg());
  assert.ok(out, 'stripped');
  assert.equal(await exifr.gps(out), undefined, 'no GPS');
  const meta = (await exifr.parse(out, everything)) || {};
  for (const k of ['Make', 'Model', 'Software', 'DateTimeOriginal', 'latitude', 'GPSLatitude']) assert.equal(meta[k], undefined, k);
  assert.equal(await exifr.orientation(out), 6, 'orientation kept');
  for (const t of ['Apple', 'http://ns.adobe.com/xap', 'hdrgm', 'MPF\0']) assert.ok(!has(out, t), `no ${JSON.stringify(t)}`);
  assert.ok(has(out, iccApp2), 'colour profile kept unchanged');
  assert.deepEqual(out.subarray(out.length - iphoneImage().length), iphoneImage(), 'the picture itself is unchanged and nothing follows it');
});

test('an Android JPEG (little-endian EXIF, IPTC, comment, progressive) loses its details', async () => {
  const out = stripJpeg(androidJpeg());
  assert.ok(out, 'stripped');
  assert.equal(await exifr.gps(out), undefined, 'no GPS');
  const meta = (await exifr.parse(out, everything)) || {};
  for (const k of ['Make', 'Model', 'City']) assert.equal(meta[k], undefined, k);
  assert.equal(await exifr.orientation(out), 3, 'orientation kept');
  assert.ok(!has(out, 'Downing') && !has(out, 'Photoshop'), 'no comment or IPTC');
  assert.ok(has(out, iccApp2), 'colour profile kept');
  assert.deepEqual(out.subarray(out.length - (progressiveJpeg.length - 20)), progressiveJpeg.subarray(20), 'every scan kept');
});

test('a JPEG with GPS but no rotation gets no EXIF at all', () => {
  const upright = concat(plainJpeg.subarray(0, 20), exifApp1({ orientation: 1 }), plainJpeg.subarray(20));
  assert.deepEqual(stripJpeg(upright), plainJpeg);
});

test('JFIF and Adobe segments keep only their fixed fields', () => {
  const enc = (t) => new TextEncoder().encode(t), secret = enc('51.5005N 0.1245W at home');
  const jfif = plainJpeg.subarray(2, 20), fields = jfif.subarray(4, 18);
  const withThumb = segment(0xe0, concat(fields.subarray(0, 12), Uint8Array.of(1, 1), Uint8Array.of(9, 9, 9), secret));   // a 1 x 1 thumbnail, then extra bytes
  const other = segment(0xe0, concat(enc('PRIV\0'), secret));                                                            // an APP0 that isn't JFIF
  const adobe = segment(0xee, concat(enc('Adobe'), Uint8Array.of(0, 100, 0, 0, 0, 0, 1)));
  const adobeLong = segment(0xee, concat(adobe.subarray(4), secret));
  const out = stripJpeg(concat(plainJpeg.subarray(0, 2), withThumb, other, adobeLong, plainJpeg.subarray(20)));
  assert.ok(out, 'stripped');
  assert.ok(!has(out, secret) && !has(out, 'PRIV'), 'no extra bytes');
  assert.deepEqual(out, concat(plainJpeg.subarray(0, 20), adobe, plainJpeg.subarray(20)), 'JFIF without its thumbnail, Adobe with its 12 bytes');
});

test('a TEM marker (FF 01, no length) is kept and the photo still cleaned', async () => {
  const tem = Uint8Array.of(0xff, 0x01);
  const withTem = concat(plainJpeg.subarray(0, 2), tem, exifApp1(), plainJpeg.subarray(2));
  const out = stripJpeg(withTem);
  assert.ok(out, 'stripped, not given up on');
  assert.equal(await exifr.gps(out), undefined, 'no GPS');
  assert.equal(await exifr.orientation(out), 6, 'orientation kept');
  assert.ok(has(out, tem), 'TEM kept');
});

test('edge: a JPEG without metadata is unchanged', () => {
  assert.deepEqual(stripJpeg(plainJpeg), plainJpeg);
  assert.deepEqual(stripJpeg(progressiveJpeg), progressiveJpeg);
});

test('a broken JPEG is not guessed at', () => {
  assert.equal(stripJpeg(iphoneJpeg().subarray(0, 300)), null, 'cut off mid-file');
  assert.equal(stripJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff)), null, 'segment longer than the file');
});

test('file types are recognised from their contents', () => {
  assert.ok(isJpeg(iphoneJpeg()) && !isJpeg(heicFile()));
  assert.ok(isHeic(heicFile()) && !isHeic(plainJpeg));
});

test('prepareFile sends a cleaned copy with the same name and type', async () => {
  const f = new File([iphoneJpeg()], 'IMG_0001.JPG', { type: 'image/jpeg' });
  const { file, warn } = await prepareFile(f, false);
  assert.equal(warn, undefined);
  assert.equal(file.name, 'IMG_0001.JPG'); assert.equal(file.type, 'image/jpeg');
  assert.deepEqual(await bytesOf(file), stripJpeg(iphoneJpeg()));
  assert.equal(file.size, stripJpeg(iphoneJpeg()).length, 'the size announced is the cleaned size');
});

test('"Keep details" sends the original', async () => {
  const f = new File([iphoneJpeg()], 'IMG_0001.JPG', { type: 'image/jpeg' });
  const { file, warn } = await prepareFile(f, true);
  assert.equal(file, f); assert.equal(warn, undefined);
});

test('edge: a HEIC is sent unchanged with a "details not removed" warning', async () => {
  for (const f of [new File([heicFile()], 'IMG_0002.HEIC', { type: '' }), new File([heicFile()], 'IMG_0002.HEIC', { type: 'image/heic' })]) {
    const { file, warn } = await prepareFile(f, false);
    assert.equal(file, f); assert.equal(warn, 'details not removed');
  }
});

test('a JPEG named or typed as HEIC is still cleaned', async () => {
  const f = new File([iphoneJpeg()], 'IMG_0004.HEIC', { type: 'image/heic' });
  const { file, warn } = await prepareFile(f, false);
  assert.equal(warn, undefined);
  assert.deepEqual(await bytesOf(file), stripJpeg(iphoneJpeg()));
});

test('a JPEG that can\'t be read is sent with the same warning', async () => {
  const f = new File([iphoneJpeg().subarray(0, 300)], 'cut.jpg', { type: 'image/jpeg' });
  const { file, warn } = await prepareFile(f, false);
  assert.equal(file, f); assert.equal(warn, 'details not removed');
});

test('videos, PNGs and other files are sent unchanged with the same warning', async () => {
  const enc = (t) => new TextEncoder().encode(t);
  const files = [
    new File([concat(Uint8Array.of(0, 0, 0, 20), enc('ftypqt  '), new Uint8Array(1000))], 'IMG_0005.MOV', { type: 'video/quicktime' }),
    new File([concat(Uint8Array.of(0, 0, 0, 24), enc('ftypmp42'), new Uint8Array(1000))], 'clip.mp4', { type: 'video/mp4' }),
    new File([concat(Uint8Array.of(0x89), enc('PNG\r\n\x1a\n'), new Uint8Array(100))], 'shot.png', { type: 'image/png' }),
    new File([concat(enc('RIFF'), new Uint8Array(4), enc('WEBP'), new Uint8Array(100))], 'pic.webp', { type: 'image/webp' }),
  ];
  for (const f of files) {
    const { file, warn } = await prepareFile(f, false);
    assert.equal(file, f); assert.equal(warn, 'details not removed', f.name);
  }
});

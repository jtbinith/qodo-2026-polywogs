// JPEG fixtures for S6, built in code so no real photo (and no real location) is committed.
// The image data is a real 16 x 8 JPEG made with ImageMagick. The metadata around it copies
// the layout of an iPhone photo: EXIF with GPS and an Apple maker note, XMP, an ICC colour
// profile, an MPF index and an HDR gain map stored as a second JPEG after the main image.
// It is synthetic: it has not been checked against a photo from a real iPhone.

import { readFileSync } from 'node:fs';

// exifr (vendored for the site) reads metadata back, the way a stranger would.
const exifrSrc = readFileSync(new URL('../web/vendor/exifr.full.umd.js', import.meta.url), 'utf8');
const exifrMod = { exports: {} }; new Function('module', 'exports', exifrSrc)(exifrMod, exifrMod.exports);
export const exifr = exifrMod.exports;

const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
// 16 x 8, baseline, JFIF only. No metadata.
export const plainJpeg = b64('/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAWEAEBAQAAAAAAAAAAAAAAAAAAFWL/xAAVAQEBAAAAAAAAAAAAAAAAAAAFB//EABkRAAEFAAAAAAAAAAAAAAAAAAAFFlOR8P/aAAwDAQACEQMRAD8AjdnRZ0CtM1Jj1DLsU5NZ/9k=');
// The same picture saved progressive: many scans, with tables between them.
export const progressiveJpeg = b64('/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAIABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBv/aAAwDAQACEAMQAAABjRWs/8QAFRABAQAAAAAAAAAAAAAAAAAAABP/2gAIAQEAAQUCss//xAAXEQADAQAAAAAAAAAAAAAAAAAABBVS/9oACAEDAQE/AazOj//EABcRAAMBAAAAAAAAAAAAAAAAAAAEFVL/2gAIAQIBAT8BjKZP/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwI//8QAFRABAQAAAAAAAAAAAAAAAAAAAHH/2gAIAQEAAT8hpT//2gAMAwEAAgADAAAAEAf/xAAWEQADAAAAAAAAAAAAAAAAAAAA8PH/2gAIAQMBAT8QVT//xAAWEQADAAAAAAAAAAAAAAAAAAAA8PH/2gAIAQIBAT8QRD//xAAUEAEAAAAAAAAAAAAAAAAAAAAQ/9oACAEBAAE/ECv/2Q==');

const enc = (s) => new TextEncoder().encode(s);
export const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export function segment(marker, payload) {
  const s = new Uint8Array(4 + payload.length);
  s[0] = 0xff; s[1] = marker; s[2] = (payload.length + 2) >> 8; s[3] = (payload.length + 2) & 0xff; s.set(payload, 4);
  return s;
}

// A TIFF block (the body of an EXIF segment). ifds: { ifd0, exif, gps }, each a list of
// [tag, type, value]. Types: 2 ASCII (string), 3 SHORT (number), 4 LONG, 5 RATIONAL ([[n, d], ...]), 7 UNDEFINED (bytes).
function tiff(le, ifds) {
  const size = { 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const buf = new Uint8Array(4096), dv = new DataView(buf.buffer);
  const u16 = (o, v) => dv.setUint16(o, v, le), u32 = (o, v) => dv.setUint32(o, v, le);
  buf.set(enc(le ? 'II' : 'MM')); u16(2, 42); u32(4, 8);
  let end = 8;
  const write = (entries, at) => {      // returns offsets of each entry's value field
    entries.sort((a, b) => a[0] - b[0]);
    u16(at, entries.length);
    let data = at + 2 + entries.length * 12 + 4;
    const fields = [];
    entries.forEach(([tag, type, value], k) => {
      const e = at + 2 + k * 12, bytes = type === 2 ? enc(value + '\0') : type === 7 ? value : null;
      const count = bytes ? bytes.length : type === 5 ? value.length : 1;
      u16(e, tag); u16(e + 2, type); u32(e + 4, count);
      let vo = e + 8;
      if (size[type] * count > 4) { u32(e + 8, data); vo = data; data += size[type] * count + ((size[type] * count) & 1); }
      if (bytes) buf.set(bytes, vo);
      else if (type === 3) u16(vo, value);
      else if (type === 4) u32(vo, value);
      else if (type === 5) value.forEach(([n, d], j) => { u32(vo + j * 8, n); u32(vo + j * 8 + 4, d); });
      fields[k] = { tag, vo };
    });
    u32(at + 2 + entries.length * 12, 0);
    end = Math.max(end, data);
    return fields;
  };
  const ifd0 = [...ifds.ifd0];
  if (ifds.exif) ifd0.push([0x8769, 4, 0]);
  if (ifds.gps) ifd0.push([0x8825, 4, 0]);
  const f0 = write(ifd0, 8);
  for (const [name, tag] of [['exif', 0x8769], ['gps', 0x8825]]) {
    if (!ifds[name]) continue;
    const at = end; u32(f0.find((f) => f.tag === tag).vo, at);
    write([...ifds[name]], at);
  }
  return buf.slice(0, end);
}

// Big Ben, so the fixture never holds anyone's real location.
const GPS = [[1, 2, 'N'], [2, 5, [[51, 1], [30, 1], [2, 1]]], [3, 2, 'W'], [4, 5, [[0, 1], [7, 1], [28, 1]]]];
export function exifApp1({ le = false, orientation = 6, make = 'Apple', model = 'iPhone 15 Pro', gps = true } = {}) {
  const ifd0 = [[0x010f, 2, make], [0x0110, 2, model], [0x0131, 2, '18.1'], [0x0132, 2, '2026:11:01 10:00:00']];
  if (orientation) ifd0.push([0x0112, 3, orientation]);
  const exif = [[0x9003, 2, '2026:11:01 10:00:00'], [0x927c, 7, enc('Apple iOS\0\0\x01MM')]];
  return segment(0xe1, concat(enc('Exif\0\0'), tiff(le, { ifd0, exif, gps: gps ? GPS : null })));
}
const xmp = (body) => segment(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" ${body}/></rdf:RDF></x:xmpmeta>`));
export const xmpApp1 = xmp('exif:GPSLatitude="51,30.03N" exif:GPSLongitude="0,7.47W" hdrgm:Version="1.0"');
// ICC_PROFILE, chunk 1 of 1. The profile bytes are a stand-in: they only need to come through unchanged.
export const iccApp2 = segment(0xe2, concat(enc('ICC_PROFILE\0'), Uint8Array.of(1, 1), enc('Display P3 stand-in profile bytes')));
export const mpfApp2 = segment(0xe2, concat(enc('MPF\0'), enc('MM'), Uint8Array.of(0, 42, 0, 0, 0, 8, 0, 0, 0, 0)));
export const iptcApp13 = segment(0xed, concat(enc('Photoshop 3.0\0'), enc('8BIM'), Uint8Array.of(4, 4, 0, 0, 0, 0, 0, 16), Uint8Array.of(0x1c, 2, 90, 0, 6), enc('London'), Uint8Array.of(0, 0, 0, 0, 0)));
export const comment = segment(0xfe, enc('Taken at 10 Downing Street'));
const APP0 = 2 + 18;                                    // SOI + the JFIF segment in plainJpeg
const body = (j) => j.subarray(APP0);                   // tables, frame, scan and EOI
const SOI = Uint8Array.of(0xff, 0xd8);

// Laid out like an iPhone photo (no JFIF), orientation 6 (rotated 90°), with a gain map after the main image.
export const iphoneJpeg = () => concat(SOI, exifApp1(), xmpApp1, iccApp2, mpfApp2, body(plainJpeg),
  concat(SOI, xmp('hdrgm:Version="1.0" hdrgm:GainMapMax="2.0"'), body(plainJpeg)));
// Laid out like many Android photos: JFIF, little-endian EXIF, orientation 3, IPTC and a comment.
export const androidJpeg = () => concat(plainJpeg.subarray(0, APP0), exifApp1({ le: true, orientation: 3, make: 'Google', model: 'Pixel 9' }),
  iptcApp13, comment, iccApp2, body(progressiveJpeg));
// What the cleaned iPhone photo should be: the picture, its colour profile and nothing else but the orientation.
export const iphoneImage = () => body(plainJpeg);
// A HEIC file's first bytes: an ISO BMFF 'ftyp' box with the heic brand.
export const heicFile = () => concat(Uint8Array.of(0, 0, 0, 24), enc('ftypheic'), Uint8Array.of(0, 0, 0, 0), enc('mif1heic'), new Uint8Array(200));

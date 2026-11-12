// Removes location and camera details from JPEG photos before they are shared (S6).
// Anyone in the room can read a photo's metadata, and GPS can show where someone lives.
//
// Kept: the picture itself (tables, frame and scans), JFIF (without a thumbnail), the ICC colour
// profile, the fixed fields of Adobe's colour-transform segment and the EXIF Orientation,
// rewritten on its own so the photo stays upright. Removed: the rest of EXIF (GPS, camera,
// dates, maker notes, thumbnail), XMP, IPTC (APP13), comments, MPF and every other APPn
// segment, and anything after the main image ends, such as an iPhone's HDR gain map.
// The fingerprint is taken of the cleaned file.
// Other formats (HEIC, PNG, WebP, video) are sent unchanged with a warning for now (S17).

export const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
export const isHeic = (b) => b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && HEIF_BRANDS.includes(ascii(b, 8, 12));
const startsWith = (seg, text) => seg.length >= 4 + text.length && ascii(seg, 4, 4 + text.length) === text;

// The Orientation tag (1–8) from an EXIF segment, or 0 if it has none or can't be read.
function orientationOf(seg) {
  if (!startsWith(seg, 'Exif\0\0')) return 0;
  const t = seg.subarray(10), dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  if (t.length < 8) return 0;
  const le = ascii(t, 0, 2) === 'II';
  if (!le && ascii(t, 0, 2) !== 'MM') return 0;
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > t.length) return 0;
  const n = dv.getUint16(ifd, le);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return 0;
    if (dv.getUint16(e, le) === 0x0112 && dv.getUint16(e + 2, le) === 3) {
      const v = dv.getUint16(e + 8, le);
      return v >= 1 && v <= 8 ? v : 0;
    }
  }
  return 0;
}

// A minimal EXIF segment holding only Orientation.
function orientationSegment(v) {
  return Uint8Array.of(0xff, 0xe1, 0, 34, ...[...'Exif'].map((c) => c.charCodeAt(0)), 0, 0,
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8,            // big-endian TIFF header, IFD0 at 8
    0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0);   // one entry: Orientation, SHORT; no next IFD
}

// A segment's first n payload bytes, as a segment of their own.
function fixed(seg, n) {
  const s = seg.slice(0, 4 + n);
  s[2] = (n + 2) >> 8; s[3] = (n + 2) & 0xff;
  return s;
}

// What is kept of a segment, or null to drop it. JFIF and Adobe keep only their fixed fields,
// so nothing extra (a JFIF thumbnail or bytes tacked on the end) comes with them.
function keep(marker, seg) {
  if (marker === 0xe0) {                                              // JFIF, without its thumbnail
    if (!startsWith(seg, 'JFIF\0') || seg.length < 18) return null;
    const s = fixed(seg, 14); s[16] = 0; s[17] = 0;
    return s;
  }
  if (marker === 0xe2) return startsWith(seg, 'ICC_PROFILE\0') ? seg : null;   // colour profile (not MPF or FlashPix)
  if (marker === 0xee) return startsWith(seg, 'Adobe') && seg.length >= 16 ? fixed(seg, 12) : null;   // colour transform, needed to decode some CMYK/RGB files
  if (marker >= 0xe0 && marker <= 0xef) return null;                  // EXIF, XMP, IPTC and the rest
  return marker === 0xfe ? null : seg;                                // comments go, image tables stay
}

// The JPEG without its metadata, or null if it isn't a JPEG that can be read to the end.
export function stripJpeg(b) {
  if (!isJpeg(b)) return null;
  const out = [b.subarray(0, 2)];
  let i = 2, orientation = 0, at = 1;   // at: where the Orientation segment goes (after JFIF, if there is one)
  for (;;) {
    if (i + 2 > b.length || b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                                 // fill byte
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); break; }         // end of the main image: anything after it is dropped
    if (m === 0xd8 || m === 0x00 || (m >= 0xd0 && m <= 0xd7)) return null;
    if (m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }   // TEM: a marker with no length
    if (i + 4 > b.length) return null;
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (end < i + 4 || end > b.length) return null;
    const seg = b.subarray(i, end);
    if (m === 0xe1 && !orientation) orientation = orientationOf(seg);
    const kept = keep(m, seg);
    if (kept) { out.push(kept); if (m === 0xe0 && at === out.length - 1) at = out.length; }
    i = end;
    if (m === 0xda) {                                                  // a scan: its data runs to the next real marker
      let j = i;
      for (;;) {
        j = b.indexOf(0xff, j);
        if (j < 0 || j + 1 >= b.length) return null;
        const n = b[j + 1];
        if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7)) break;            // 00 is an escaped FF, D0–D7 are restart markers
        j += 2;
      }
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  if (orientation > 1) out.splice(at, 0, orientationSegment(orientation));
  const clean = new Uint8Array(out.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of out) { clean.set(p, o); o += p.length; }
  return clean;
}

// What to send for a picked file. keep: the sender ticked "Keep details".
// warn is set when the file still carries whatever details it had.
export async function prepareFile(file, keep) {
  if (keep) return { file };
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (isHeic(head) || /^image\/hei[cf]/i.test(file.type)) return { file, warn: 'details not removed' };
  if (!isJpeg(head)) return { file };
  const clean = stripJpeg(new Uint8Array(await file.arrayBuffer()));
  if (!clean) return { file, warn: 'details not removed' };
  return { file: new File([clean], file.name, { type: file.type || 'image/jpeg', lastModified: file.lastModified }) };
}

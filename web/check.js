// Checks for messages from other devices. Anyone who knows a room code can send anything,
// so nothing from the network is trusted until it passes these checks.

export const LIMITS = {
  fileBytes: 200 * 1024 * 1024,  // biggest file we'll accept (held in memory while it arrives)
  thumbBytes: 512 * 1024,
  chunkSizes: [24 * 1024, 64 * 1024], // the only piece sizes a sender may use
  incoming: 20,                  // transfers arriving at once
  prints: 500,
  missingPerAsk: 300,
};

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v, lim = 1e6) => Number.isFinite(v) && Math.abs(v) <= lim;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const isPid = (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
export const isDevId = (v) => isStr(v, 40);
export const isSha = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export function validPrint(m) {
  return !!m && isPid(m.pid) && isDevId(m.owner) && isDevId(m.anchor) &&
    isStr(m.name, 200) && typeof m.type === 'string' && m.type.length <= 100 &&
    isInt(m.size, 0, LIMITS.fileBytes) && isInt(m.thumbSize ?? 0, 0, LIMITS.thumbBytes) && isSha(m.sha) &&
    isNum(m.x) && isNum(m.y) && isNum(m.w, 400) && m.w >= 40 && isNum(m.h, 400) && m.h >= 40 &&
    isNum(m.rot, Math.PI) &&
    Array.isArray(m.holders) && m.holders.length <= 50 && m.holders.every(isDevId);
}

export const validMove = (m) => !!m && isPid(m.pid) && isDevId(m.anchor) && isNum(m.x) && isNum(m.y);

// Number of pieces a file of `size` bytes splits into at piece size `cs`.
export const pieceCount = (size, cs) => Math.ceil(size / cs) || 1;

// A piece is only accepted for a transfer we asked for, from the device we asked, with a
// piece size, count and index that fit the size we were told to expect, and exactly the
// length that piece must have (every piece is full except possibly the last).
export function validChunk(m, bytes, expect) {
  if (!expect || !LIMITS.chunkSizes.includes(m.cs)) return false;
  if (!isInt(m.n, 1, 1e6) || m.n !== pieceCount(expect.size, m.cs)) return false;
  if (!isInt(m.i, 0, m.n - 1)) return false;
  const want = m.i < m.n - 1 ? m.cs : expect.size - m.cs * (m.n - 1);
  return bytes instanceof Uint8Array && bytes.length === want;
}

// SHA-256 of a list of byte arrays (or a File/Blob), streamed so big files stay out of memory.
export async function sha256Hex(src) {
  const h = await hashwasm.createSHA256();
  h.init();
  if (Array.isArray(src)) for (const part of src) h.update(part);
  else for (let off = 0; off < src.size; off += 4 << 20) h.update(new Uint8Array(await src.slice(off, off + (4 << 20)).arrayBuffer()));
  return h.digest('hex');
}

export function validMissing(list) {
  return list === null || (Array.isArray(list) && list.length <= LIMITS.missingPerAsk && list.every((i) => isInt(i, 0, 1e6)));
}

// Room codes come from the "New room" button: 10 characters from a 32-letter alphabet
// (50 bits), so nobody can guess or list them. Hand-typed short codes are refused.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (c) => typeof c === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(c);

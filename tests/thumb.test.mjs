// Unit tests for S14: a thumbnail from another device is decoded only if its frame header
// says it is a JPEG no bigger than LIMITS.thumbSide on each side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbFits, LIMITS } from '../web/check.js';
import { plainJpeg, progressiveJpeg, sizedJpeg, twoFrameJpeg, smallPng } from './jpeg-fixtures.mjs';

test('the limit is 400 pixels a side', () => assert.equal(LIMITS.thumbSide, 400));
test('small JPEG thumbnails are decoded', () => {
  assert.ok(thumbFits(plainJpeg), 'baseline 16 x 8');
  assert.ok(thumbFits(progressiveJpeg), 'progressive 16 x 8');
  assert.ok(thumbFits(sizedJpeg(400, 400)), 'exactly 400 x 400');
});
test('a thumbnail over 400 x 400 is not decoded', () => {
  for (const [w, h] of [[401, 400], [400, 401], [401, 401], [30000, 30000], [65535, 65535]])
    assert.equal(thumbFits(sizedJpeg(w, h)), false, `${w} x ${h}`);
  assert.equal(thumbFits(sizedJpeg(30000, 30000, { from: progressiveJpeg })), false, 'progressive 30000 x 30000');
});
test('a thumbnail whose size can\'t be read is not decoded', () => {
  assert.equal(thumbFits(sizedJpeg(16, 0)), false, 'height given later (DNL)');
  assert.equal(thumbFits(sizedJpeg(0, 8)), false, 'zero width');
  assert.equal(thumbFits(twoFrameJpeg()), false, 'a small frame, then a huge one');
  assert.equal(thumbFits(sizedJpeg(16, 8, { marker: 0xc3 })), false, 'lossless, which we never send');
  assert.equal(thumbFits(smallPng()), false, 'not a JPEG');
  assert.equal(thumbFits(plainJpeg.subarray(0, 100)), false, 'cut off before the frame header');
  assert.equal(thumbFits(new Uint8Array(0)), false, 'empty');
  assert.equal(thumbFits(null), false, 'nothing');
});
test('a thumbnail with bytes after its end marker is not decoded', () => {
  // Ultra HDR keeps a second image (the gain map) after the first end marker, so a small
  // first image could carry a huge one behind it. Our own thumbnails end at the marker.
  const small = sizedJpeg(400, 400), after = (x) => { const o = new Uint8Array(small.length + x.length); o.set(small); o.set(x, small.length); return o; };
  assert.equal(small[small.length - 2], 0xff, 'fixture ends with its end marker');
  assert.equal(small[small.length - 1], 0xd9, 'fixture ends with its end marker');
  assert.equal(thumbFits(after(new Uint8Array(30000))), false, '400 x 400 followed by 30000 zero bytes');
  assert.equal(thumbFits(after(sizedJpeg(30000, 30000))), false, '400 x 400 followed by a 30000 x 30000 second image');
  assert.equal(thumbFits(after(new Uint8Array(1))), false, 'one stray byte');
});

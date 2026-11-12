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

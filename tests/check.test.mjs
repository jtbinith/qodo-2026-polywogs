// Unit tests for web/check.js: everything another device sends is checked before use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validPrint, validMove, validChunk, validMissing, isRoomCode, pieceCount, LIMITS } from '../web/check.js';

const print = { pid: '0123456789abcdef', owner: 'dev1', anchor: 'dev1', name: 'IMG_1.jpeg', type: 'image/jpeg', size: 10,
  sha: 'a'.repeat(64), x: 1, y: 2, w: 150, h: 150, rot: 0.1, holders: ['dev1'] };

test('a well-formed print passes', () => assert.ok(validPrint(print)));
test('prints with missing or bad fields are rejected', () => {
  for (const bad of [{ type: undefined }, { pid: 'abc' }, { sha: 'nope' }, { w: 1e9 }, { size: -1 }, { size: LIMITS.fileBytes + 1 }, { holders: 'all' }, { x: NaN }])
    assert.equal(validPrint({ ...print, ...bad }), false, JSON.stringify(bad));
});
test('moves need a real print id and finite numbers', () => {
  assert.ok(validMove({ pid: print.pid, anchor: 'dev1', x: 0, y: 0 }));
  assert.equal(validMove({ pid: print.pid, anchor: 'dev1', x: Infinity, y: 0 }), false);
});

const expect = { size: 50000 };
test('pieces must fit the file we asked for, at the exact length', () => {
  const cs = 24576, n = pieceCount(expect.size, cs);
  assert.equal(n, 3);
  assert.ok(validChunk({ cs, n, i: 0 }, new Uint8Array(cs), expect));
  assert.ok(validChunk({ cs, n, i: 2 }, new Uint8Array(expect.size - 2 * cs), expect));
  assert.equal(validChunk({ cs, n, i: 0 }, new Uint8Array(0), expect), false, 'empty piece');
  assert.equal(validChunk({ cs, n, i: 2 }, new Uint8Array(10), expect), false, 'short last piece');
  assert.equal(validChunk({ cs, n: 1e9, i: 0 }, new Uint8Array(cs), expect), false, 'huge count');
  assert.equal(validChunk({ cs: 1, n: expect.size, i: 0 }, new Uint8Array(1), expect), false, 'odd piece size');
  assert.equal(validChunk({ cs, n, i: 0 }, new Uint8Array(cs), null), false, 'not asked for');
});
test('resend requests are bounded', () => {
  assert.ok(validMissing(null));
  assert.ok(validMissing([0, 1, 2]));
  assert.equal(validMissing('all'), false);
  assert.equal(validMissing(Array(LIMITS.missingPerAsk + 1).fill(0)), false);
});
test('only full 10-character room codes are accepted', () => {
  assert.ok(isRoomCode('ABCDEFGHJK'));
  for (const bad of ['TEST', 'ABCDEFGHI1', 'abcdefghjk', 'ABCDEFGHJKL']) assert.equal(isRoomCode(bad), false, bad);
});

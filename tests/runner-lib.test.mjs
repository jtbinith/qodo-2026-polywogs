// Unit tests for the factory runner's helpers (scripts/runner-lib.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../scripts/runner-lib.mjs';   // a namespace: a helper that doesn't exist yet fails on an assertion, not the import

const diff = (...lines) => ['+++ b/tests/x.mjs', ...lines.map((l) => '+' + l)].join('\n');

test('a unit test name is found', () => {
  assert.deepEqual(lib.testNames(diff("test('a thumbnail over 400 x 400 is not decoded', () => {")), ['a thumbnail over 400 x 400 is not decoded']);
});
test('a check() message on the next line is found (the #41 round 1 case)', () => {
  const names = lib.testNames(diff(
    "  check(fullSaid === 'Too many photos arriving. Try again in a moment' && !fullAsked.wants,",
    '    `tapping while every incoming slot is taken says "${fullSaid}" and asks for nothing (${JSON.stringify(fullAsked)})`);'));
  assert.deepEqual(names, ['tapping while every incoming slot is taken says "']);
});
test('a string inside the check() condition is not taken as its name', () => {
  assert.deepEqual(lib.testNames(diff("check(said === 'Already yours', 'tapping your own print says Already yours');")), ['tapping your own print says Already yours']);
});
test('a template message counts up to its first ${…}', () => {
  assert.deepEqual(lib.testNames(diff('check(ok, `a 400 x 400 thumbnail is shown (${JSON.stringify(x)})`);')), ['a 400 x 400 thumbnail is shown (']);
});
test('removed lines and short names are ignored', () => {
  assert.deepEqual(lib.testNames(['-check(ok, "an old check that was removed");', "+check(ok, 'short');"].join('\n')), []);
});
test('a named FAIL line counts as red, a crash in a named unit test does not', () => {
  const names = ['tapping while every incoming slot is taken'];
  assert.equal(lib.assertionFailures('FAIL tapping while every incoming slot is taken says "Receiving…"', names).length, 1);
  const crash = '✖ tapping while every incoming slot is taken (1ms)\n  ReferenceError: x is not defined\nℹ tests 1';
  assert.equal(lib.assertionFailures(crash, names).length, 0);
  const assertion = '✖ tapping while every incoming slot is taken (1ms)\n  AssertionError [ERR_ASSERTION]: no\nℹ tests 1';
  assert.equal(lib.assertionFailures(assertion, names).length, 1);
});
test("Qodo's escaped titles are decoded", () => {
  assert.equal(lib.decodeEntities?.('Taps can claim a photo is arriving when it isn&#x27;t'), "Taps can claim a photo is arriving when it isn't");
});
test('/agent retry is told apart from an instruction', () => {
  assert.deepEqual(lib.parseAsk?.('/agent retry'), { retry: true });
  assert.deepEqual(lib.parseAsk?.('/agent  say "Getting it…" instead'), { retry: false, text: 'say "Getting it…" instead' });
});

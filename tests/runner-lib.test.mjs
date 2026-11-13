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

// from Qodo's review of 416e751 and the reviewer's notes
test('a regular expression with a bracket in the condition is skipped', () => {
  assert.deepEqual(lib.testNames(diff("check(/foo\\)/.test(value), 'a meaningful assertion about foo');")), ['a meaningful assertion about foo']);
});
test('a check() in one hunk is not closed by an unrelated hunk', () => {
  const d = ['@@ -1,0 +1,1 @@', '+  check(ok,', '@@ -40,0 +41,1 @@', "+    'an unrelated string here');"].join('\n');
  assert.deepEqual(lib.testNames(d), []);
});
test('a comment inside a wrapped check() is skipped', () => {
  assert.deepEqual(lib.testNames(diff('check(ok, // the second tap', "  'tapping again asks only once');")), ['tapping again asks only once']);
});
test('a retry pushes only when there is something new, otherwise it waits for Qodo again', () => {
  assert.equal(lib.retryPlan?.('abc1234', 'def5678'), 'push');
  assert.equal(lib.retryPlan?.('abc1234', 'abc1234'), 'wait');
});
test('an /agent instruction the agent makes no change for stops and asks the owner, retry or not (Qodo on 0191b36)', () => {
  const plan = (o) => lib.afterOwnerRound?.(o);
  assert.equal(plan({ committed: true, retryAsked: true }), 'check');
  assert.equal(plan({ committed: true, retryAsked: false }), 'check');
  assert.equal(plan({ committed: false, retryAsked: true }), 'stop');    // not 'wait': that could mark the run done with the request undone
  assert.equal(plan({ committed: false, retryAsked: false }), 'stop');
});
test('an old stop file is cleared before each agent run and when the owner reopens a run (#41 at 09:28)', () => {
  assert.deepEqual(lib.staleFiles?.('agent-run'), ['stop.md']);                       // test-output.txt is written just before a fix-tests run, so it stays
  assert.deepEqual(lib.staleFiles?.('reopen'), ['stop.md', 'test-output.txt']);
});
test('proofs not yet posted are found, including on a run saved before this was tracked (#41 at 09:51)', () => {
  assert.deepEqual(lib.unpublished?.(['p1', 'p2'], 1), ['p2']);
  assert.deepEqual(lib.unpublished?.(['p1', 'p2'], 2), []);
  assert.deepEqual(lib.unpublished?.(['p1', 'p2'], undefined, true), ['p2']);   // an older run: its first proof went into the PR when it was opened
  assert.deepEqual(lib.unpublished?.(['p1'], undefined, false), ['p1']);
});
test('every page is read, so a list past 100 is complete', () => {
  const pages = { 1: Array(100).fill('a'), 2: Array(100).fill('b'), 3: ['c'] };
  assert.equal(lib.allPages?.((p) => pages[p] || []).length, 201);
});
test('a retry has its own limit, separate from instructions', () => {
  assert.equal(lib.roundKind?.({ retry: true }), 'retry');
  assert.equal(lib.roundKind?.({ retry: false, text: 'x' }), 'instruction');
});

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
test('what to publish is read from the PR itself, so old runs and half-finished posts are not repeated (Qodo on 829263e)', () => {
  const p1 = '**Red → green, checked by the runner** (not the agent) for main..aaa:\n- a', p2 = '**Red → green, checked by the runner** (not the agent) for aaa..bbb:\n- b';
  const p3 = '**Red → green, checked by the runner** (not the agent) for bbb..ccc:\n- c';
  const plan = (body, comments) => lib.publishPlan?.([p1, p2, p3], body, comments);
  // #41 at 09:51: opened with p1, p2 pushed but never posted
  assert.deepEqual(plan('Closes #41\n\n' + p1, []), { updateBody: true, comment: [p2, p3] });
  // an older run that posted p2 as a comment already: only p3 is missing
  assert.deepEqual(plan('Closes #41\n\n' + p1, [p2]), { updateBody: true, comment: [p3] });
  // interrupted after the description and p2: only p3 is posted again
  assert.deepEqual(plan('Closes #41\n\n' + [p1, p2, p3].join('\n\n'), [p2]), { updateBody: false, comment: [p3] });
  assert.deepEqual(plan('Closes #41\n\n' + [p1, p2, p3].join('\n\n'), [p2, p3]), { updateBody: false, comment: [] });
});
test('a comment over a limit is still marked read, so it cannot stop the run again on every tick (Qodo on 829263e)', () => {
  const L = { commentRounds: 3, retryRounds: 5 };
  const plan = (asked, c, r) => lib.askPlan?.({ asked, commentRounds: c, retryRounds: r, limits: L });
  assert.deepEqual(plan([{ retry: true }], 0, 5), { consume: true, kind: 'retry', stop: 'The /agent retry limit (5) is used up.', commentRounds: 0, retryRounds: 5 });
  assert.deepEqual(plan([{ retry: true }], 3, 1), { consume: true, kind: 'retry', commentRounds: 3, retryRounds: 2 });
  assert.deepEqual(plan([{ retry: false, text: 'x' }, { retry: true }], 1, 0), { consume: true, kind: 'instruction', commentRounds: 2, retryRounds: 0 });
  assert.deepEqual(plan([{ retry: false, text: 'x' }], 3, 0), { consume: true, kind: 'instruction', stop: 'The /agent instruction limit (3) is used up.', commentRounds: 3, retryRounds: 0 });
});
test('every page is read, so a list past 100 is complete', () => {
  const pages = { 1: Array(100).fill('a'), 2: Array(100).fill('b'), 3: ['c'] };
  assert.equal(lib.allPages?.((p) => pages[p] || []).length, 201);
});
test('a retry has its own limit, separate from instructions', () => {
  assert.equal(lib.roundKind?.({ retry: true }), 'retry');
  assert.equal(lib.roundKind?.({ retry: false, text: 'x' }), 'instruction');
});

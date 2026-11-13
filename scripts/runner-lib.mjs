// Pure helpers for scripts/agent-watch.mjs: no GitHub, git or files, so they can be unit tested.

// The names of the tests a commit adds: test('…') in unit files, check(…, '…') in the two-browser test.
// Template literals count up to their first ${…}.
export function testNames(diff) {
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const names = new Set();
  for (const l of added) {
    for (const m of l.matchAll(/\btest\(\s*(['"`])((?:(?!\1).)+?)\1/g)) names.add(m[2].split('${')[0]);
    for (const m of l.matchAll(/\bcheck\(.*?,\s*(['"`])((?:(?!\1).)+?)(?:\1|\$\{)/g)) names.add(m[2].split('${')[0]);
  }
  return [...names].map((x) => x.split('\\')[0].trim()).filter((x) => x.length >= 8);
}
// Failures of the named tests that are assertions, not crashes: a unit test's ✖ block must hold an
// AssertionError. A two-browser FAIL line comes from check(), which is an assertion by construction.
export function assertionFailures(out, names) {
  const lines = out.split('\n'), hits = [];
  lines.forEach((l, i) => {
    if (!names.some((nm) => l.includes(nm))) return;
    if (/^FAIL /.test(l)) return hits.push(l);
    if (!/^\s*✖ /.test(l)) return;
    const end = lines.findIndex((x, j) => j > i && /^\s*(✖|✔|ℹ) /.test(x));
    if (lines.slice(i + 1, end < 0 ? i + 20 : end).some((x) => /AssertionError/.test(x))) hits.push(l.trim());
  });
  return [...new Set(hits)];
}

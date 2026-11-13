// Pure helpers for scripts/agent-watch.mjs: no GitHub, git or files, so they can be unit tested
// (tests/runner-lib.test.mjs).

// The names of the tests a diff adds: test('…') in unit files, and the message of check(…, '…') in
// the two-browser test. A check() call can wrap across lines and its condition can hold strings,
// so the message is its last argument, found by reading the call to its closing bracket.
// Template literals count up to their first ${…}.
export function testNames(diff) {
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  const text = added.join('\n'), names = new Set();
  for (const m of text.matchAll(/\btest\(\s*(['"`])((?:(?!\1)[^\n])+?)\1/g)) names.add(m[2]);
  for (const m of text.matchAll(/\bcheck\(/g)) {
    const last = lastArgument(text, m.index + m[0].length);
    const q = last && /^(['"`])/.exec(last);
    if (q) names.add(last.slice(1).split(q[1])[0]);
  }
  return [...names].map((x) => x.split('${')[0].split('\\')[0].trim()).filter((x) => x.length >= 8);
}
// the text of the last top-level argument of a call whose arguments start at `from`
function lastArgument(text, from) {
  let depth = 1, quote = null, start = from;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (--depth === 0) return text.slice(start, i).trim(); }
    else if (c === ',' && depth === 1) start = i + 1;
  }
  return null;
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

// Qodo's titles come HTML-escaped (isn&#x27;t)
export const decodeEntities = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// An owner's /agent comment: `/agent retry` re-runs the runner's checks with no agent run.
// Anything else is an instruction for the agent.
export const parseAsk = (body) => (/^\/agent\s+retry\s*$/i.test(body.trim()) ? { retry: true } : { retry: false, text: body.trim().replace(/^\/agent\s+/i, '') });

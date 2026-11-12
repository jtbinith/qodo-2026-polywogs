#!/usr/bin/env node
// Runs one ticket through the factory without anyone opening a session.
//
// A systemd timer runs this every 2 minutes (scripts/systemd/), from the copy on origin/main.
// Each run does at most one step:
//   1. pick up: an open issue written by jtbinith and labelled `ready-for-agent` by jtbinith.
//      A Claude Code subagent works it with the work-ticket skill in its own worktree.
//   2. check and push: the script (not the agent) checks what the agent changed, runs `npm test`,
//      proves every `test:` commit fails on its own, then pushes `agent/<N>-…` and opens the PR.
//   3. review loop: once Qodo has reviewed the pushed commit, its open findings (or a `/agent …`
//      comment from jtbinith) go to a new subagent run, then step 2 again.
//   4. stop: `agent-done` when Qodo has no open findings, `agent-needs-help` otherwise.
// Nothing merges. Only jtbinith merges, and main is protected by a ruleset.
//
// The agent never sees GitHub. The script writes the ticket and the review to .agent/ for it,
// from text written by jtbinith and qodo-code-review only (the repo is public).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync, openSync, closeSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Measured on PRs #39-#47: Qodo's first review took 0:25-3:19, re-reviews about 1 min.
const LIMITS = {
  testAttempts: 2,          // agent runs allowed to get `npm test` green per round
  reviewRounds: 3,          // Qodo review rounds the agent may answer
  commentRounds: 3,         // rounds started by a `/agent` comment from the owner
  reviewWaitMin: 10,        // minutes to wait for Qodo after a push (about 3x the slowest seen)
  agentRunMin: 45,          // one subagent run
  testRunMin: 15,           // one `npm test`
};
const REPO = 'jtbinith/qodo-hack-2026', OWNER = 'jtbinith', QODO = 'qodo-code-review[bot]';
const MAIN = join(homedir(), 'qodo-hack-2026');
const HOME = join(homedir(), '.local/state/qodo-agent'), WORK = join(homedir(), 'qodo-agent');
const L = { ready: 'ready-for-agent', working: 'agent-working', done: 'agent-done', help: 'agent-needs-help' };
// paths the agent must never change: the factory itself
const GUARDED = [/^package(-lock)?\.json$/, /^scripts\//, /^\.claude\//, /^\.github\//, /^AGENTS\.md$/, /^\.gitignore$/, /^node_modules/];
mkdirSync(join(HOME, 'logs'), { recursive: true }); mkdirSync(WORK, { recursive: true });

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const event = (n, msg) => { const line = `${now()} #${n} ${msg}`; appendFileSync(join(HOME, 'events.log'), line + '\n'); console.log(line); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gh = (...args) => sh('gh', args);
const ghJson = (...args) => JSON.parse(gh(...args) || 'null');
const notify = (msg) => spawnSync('notify-send', ['Qodo factory', msg]);
const stateFile = (n) => join(HOME, `${n}.json`);
const load = (n) => existsSync(stateFile(n)) ? JSON.parse(readFileSync(stateFile(n), 'utf8')) : null;
const save = (n, s) => writeFileSync(stateFile(n), JSON.stringify(s, null, 2));
const fence = (t) => '```\n' + t.slice(0, 3000) + '\n```';

// one run at a time: a second timer tick while an agent is working just exits
const LOCK = join(HOME, 'lock');
let lockFd;
try { lockFd = openSync(LOCK, 'wx'); } catch {
  const age = (Date.now() - Number(readFileSync(LOCK, 'utf8') || 0)) / 60000;
  if (age < LIMITS.agentRunMin * 3 + LIMITS.testRunMin * 6) process.exit(0);
  unlinkSync(LOCK); lockFd = openSync(LOCK, 'wx');                       // left over from a crash
}
writeFileSync(LOCK, String(Date.now()));
process.on('exit', () => { try { closeSync(lockFd); unlinkSync(LOCK); } catch {} });

// ---- GitHub, read and written only by the script ----
const issue = (n) => ghJson('api', `repos/${REPO}/issues/${n}`);
const issueComments = (n) => ghJson('api', `repos/${REPO}/issues/${n}/comments?per_page=100`);
function labelledByOwner(n) {
  const events = ghJson('api', `repos/${REPO}/issues/${n}/events?per_page=100`).filter((e) => e.event === 'labeled' && e.label?.name === L.ready);
  return events.length > 0 && events.at(-1).actor.login === OWNER;
}
const setLabels = (n, add, remove) => gh('issue', 'edit', String(n), '-R', REPO, ...add.flatMap((l) => ['--add-label', l]), ...remove.flatMap((l) => ['--remove-label', l]));
const comment = (n, body) => gh('issue', 'comment', String(n), '-R', REPO, '--body', body);
function moveCard(n, column) {
  try {
    const P = gh('project', 'view', '7', '--owner', OWNER, '--format', 'json', '-q', '.id');
    const ITEM = gh('project', 'item-list', '7', '--owner', OWNER, '--limit', '200', '--format', 'json', '-q', `.items[] | select(.content.number==${n}) | .id`);
    const FIELD = gh('project', 'field-list', '7', '--owner', OWNER, '--format', 'json', '-q', '.fields[] | select(.name=="Status") | .id');
    const OPT = gh('project', 'field-list', '7', '--owner', OWNER, '--format', 'json', '-q', `.fields[] | select(.name=="Status") | .options[] | select(.name=="${column}") | .id`);
    if (ITEM) gh('project', 'item-edit', '--project-id', P, '--id', ITEM, '--field-id', FIELD, '--single-select-option-id', OPT);
  } catch (e) { event(n, `card not moved to ${column}: ${e.message.split('\n')[0]}`); }
}
// Qodo's review comment ends with the commit it reviewed. Open findings are the numbered
// findings not struck through as resolved.
function qodoReview(pr) {
  const c = issueComments(pr).filter((x) => x.user.login === QODO && /Code Review by Qodo/.test(x.body)).at(-1);
  if (!c) return null;
  const reviewed = [...c.body.matchAll(/commit\/([0-9a-f]{40}) -->/g)].at(-1)?.[1];
  const open = [...c.body.matchAll(/<summary>\s+\d+\.\s+(.*?)<\/summary>/g)].map((m) => m[1])
    .filter((t) => !t.startsWith('<s>') && !/Resolved/.test(t)).map((t) => t.replace(/<[^>]+>/g, '').trim());
  return { reviewed, open, body: c.body };
}
const ownerAsks = (s) => issueComments(s.pr).filter((x) => x.user.login === OWNER && /^\/agent\s/.test(x.body) && x.id > (s.lastAsk || 0));
// what the owner's account did on GitHub: compared before and after every agent run
const footprint = (s) => JSON.stringify({
  refs: sh('git', ['ls-remote', '--heads', 'origin'], { cwd: MAIN }),
  issue: issueComments(s.n).filter((c) => c.user.login === OWNER).length,
  issueEvents: ghJson('api', `repos/${REPO}/issues/${s.n}/events?per_page=100`).length,
  pr: s.pr ? issueComments(s.pr).filter((c) => c.user.login === OWNER).length : 0,
  prs: ghJson('pr', 'list', '-R', REPO, '--state', 'all', '--limit', '5', '--json', 'number').map((p) => p.number).join(),
});

// ---- the agent: no GitHub, no MCP, no user settings; only file tools, tests and local git ----
const AGENT_SETTINGS = join(HOME, 'agent-settings.json');
{ // sign-in only (Bedrock). No permissions, plugins, hooks or MCP from the user's settings.
  const user = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'));
  writeFileSync(AGENT_SETTINGS, JSON.stringify(Object.fromEntries(['awsCredentialExport', 'env', 'model'].filter((k) => k in user).map((k) => [k, user[k]]))));
}
const TOOLS = 'Read,Edit,Write,Glob,Grep,Bash,Skill';
const ALLOW = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill',
  'Bash(npm test)', 'Bash(npm run test:*)', 'Bash(node --test:*)', 'Bash(node tests/:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];
const DENY = ['Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git reset:*)', 'Bash(git remote:*)', 'Bash(gh:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(ssh:*)', 'WebFetch', 'WebSearch'];
class Stop extends Error {}
function agent(n, s, what, prompt) {
  const log = join(HOME, 'logs', `${n}-${s.runs + 1}-${what}.log`), before = footprint(s), from = head(s);
  event(n, `agent run ${s.runs + 1} (${what}) started`);
  const r = spawnSync('claude', ['-p', prompt, '--setting-sources', 'project', '--settings', AGENT_SETTINGS, '--strict-mcp-config',
    '--tools', TOOLS, '--allowedTools', ...ALLOW, '--disallowedTools', ...DENY, '--output-format', 'text'],
    { cwd: s.dir, encoding: 'utf8', timeout: LIMITS.agentRunMin * 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENT_RUN: '1' } });
  writeFileSync(log, `$ claude -p ${JSON.stringify(prompt)}\n\n${r.stdout || ''}\n${r.stderr || ''}\nexit ${r.status}${r.error ? ' ' + r.error.message : ''}\n`);
  s.runs++; save(n, s);
  event(n, `agent run ${s.runs} (${what}) ended: exit ${r.status}${r.error ? ' (' + r.error.code + ')' : ''}`);
  if (r.status !== 0) throw new Stop(`Agent run ${s.runs} (${what}) didn't finish: exit ${r.status}${r.error ? ', ' + r.error.code : ''}. Log: \`${log}\``);
  // don't take the agent's word for it: check what actually changed
  const after = footprint(s);
  if (after !== before) throw new Stop(`Something changed on GitHub during agent run ${s.runs} (${what}). The agent isn't allowed to touch GitHub.\n\n${fence(before + '\n→\n' + after)}`);
  const touched = sh('git', ['diff', '--name-only', `${from}..HEAD`], { cwd: s.dir }).split('\n').filter(Boolean);
  const guarded = touched.filter((f) => GUARDED.some((g) => g.test(f)));
  if (guarded.length) throw new Stop(`Agent run ${s.runs} changed files the factory guards: ${guarded.join(', ')}.`);
  const dirty = sh('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: s.dir }).split('\n').filter((l) => l && !/ \.agent\//.test(l));
  if (dirty.length) event(n, `uncommitted after run ${s.runs}: ${dirty.join(' | ')}`);
}

function npmTest(dir) {
  const r = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: LIMITS.testRunMin * 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { ok: r.status === 0 && !/^FAIL /m.test(out), out, fails: out.split('\n').filter((l) => /^FAIL |^✖ |AssertionError/.test(l)) };
}
const head = (s) => sh('git', ['rev-parse', 'HEAD'], { cwd: s.dir });
const agentFile = (s, f) => { const p = join(s.dir, '.agent', f); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
const putAgentFile = (s, f, text) => { mkdirSync(join(s.dir, '.agent'), { recursive: true }); writeFileSync(join(s.dir, '.agent', f), text); };

// The names of the tests a commit adds: test('…') in unit files, check(…, '…') in the two-browser test.
// Template literals count up to their first ${…}.
function testNames(s, sha) {
  const added = sh('git', ['show', '--format=', '-U0', sha], { cwd: s.dir }).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const names = new Set();
  for (const l of added) {
    for (const m of l.matchAll(/\btest\(\s*(['"`])((?:(?!\1).)+?)\1/g)) names.add(m[2].split('${')[0]);
    for (const m of l.matchAll(/\bcheck\(.*?,\s*(['"`])((?:(?!\1).)+?)(?:\1|\$\{)/g)) names.add(m[2].split('${')[0]);
  }
  return [...names].map((x) => x.split('\\')[0].trim()).filter((x) => x.length >= 8);
}
// Every `test:` commit since `base` must change only tests and must fail on its own new tests.
function proveRed(n, s, base) {
  const commits = sh('git', ['log', '--reverse', '--format=%H %s', `${base}..HEAD`], { cwd: s.dir }).split('\n').filter(Boolean)
    .map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) })).filter((c) => /^test(\(.+\))?:/.test(c.subject));
  if (!commits.length) throw new Stop(`No \`test:\` commit since ${base.slice(0, 7)}. Every change starts with a failing test.`);
  const lines = [];
  for (const c of commits) {
    const files = sh('git', ['show', '--name-only', '--format=', c.sha], { cwd: s.dir }).split('\n').filter(Boolean);
    const other = files.filter((f) => !f.startsWith('tests/'));
    if (other.length) throw new Stop(`\`${c.sha.slice(0, 7)} ${c.subject}\` changes more than tests: ${other.join(', ')}.`);
    const dir = join(WORK, `${n}-red`);
    rmSync(dir, { recursive: true, force: true }); sh('git', ['worktree', 'prune'], { cwd: MAIN });
    sh('git', ['worktree', 'add', '--detach', dir, c.sha], { cwd: MAIN });
    symlinkSync(join(MAIN, 'node_modules'), join(dir, 'node_modules'));
    const t = npmTest(dir);
    writeFileSync(join(HOME, 'logs', `${n}-red-${c.sha.slice(0, 7)}.log`), t.out);
    sh('git', ['worktree', 'remove', '--force', dir], { cwd: MAIN });
    if (t.ok) throw new Stop(`\`${c.sha.slice(0, 7)} ${c.subject}\` passes on its own, so its tests don't prove anything.`);
    // a red that doesn't name one of the new tests could be a syntax error or the relay being down
    const names = testNames(s, c.sha), named = t.fails.filter((l) => names.some((nm) => l.includes(nm)));
    if (!named.length) throw new Stop(`\`${c.sha.slice(0, 7)} ${c.subject}\` fails, but no failing line names one of its new tests (${names.slice(0, 5).map((x) => `"${x}"`).join(', ') || 'none found'}). It may have failed for another reason.\n\n${fence(t.fails.slice(0, 15).join('\n'))}`);
    lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}: **fails on its own new tests** (${named.length} of ${t.fails.length} failing lines), for example \`${named[0].slice(0, 120)}\``);
    event(n, `red checked: ${c.sha.slice(0, 7)} fails on its own (${t.fails.length} failing lines)`);
  }
  return lines;
}

function stop(n, s, label, why) {
  if (s) { s.phase = label === L.done ? 'done' : 'help'; save(n, s); }
  setLabels(n, [label], [L.working]);
  const report = s ? agentFile(s, 'report.md') : '';
  comment(n, `**Factory run ${label === L.done ? 'finished' : 'stopped and needs you'}.** ${why}\n\n` +
    (s ? `Agent runs: ${s.runs} · review rounds: ${s.round}/${LIMITS.reviewRounds} · comment rounds: ${s.commentRounds}/${LIMITS.commentRounds}` + (s.pr ? ` · PR #${s.pr}` : '') : '') +
    (report ? `\n\n<details><summary>Agent report</summary>\n\n${report}\n</details>` : ''));
  event(n, `${label}: ${why.split('\n')[0]}`); notify(`#${n}: ${label}. ${why.split('\n')[0]}`);
}

// Gets the agent's commits green, proves the red, then pushes. Throws Stop when it can't.
function checkAndPush(n, s, why) {
  for (let attempt = 1; ; attempt++) {
    if (agentFile(s, 'stop.md')) throw new Stop('The agent stopped instead of guessing:\n\n' + agentFile(s, 'stop.md'));
    if (head(s) === (s.head || s.base)) throw new Stop('The agent made no new commits.');
    const t = npmTest(s.dir);
    writeFileSync(join(HOME, 'logs', `${n}-${s.runs}-npm-test.log`), t.out);
    event(n, `npm test ${t.ok ? 'passed' : 'FAILED'} on ${head(s).slice(0, 7)}`);
    if (t.ok) break;
    if (attempt >= LIMITS.testAttempts) throw new Stop(`\`npm test\` still fails after ${attempt} attempts:\n\n${fence(t.fails.join('\n'))}`);
    agent(n, s, 'fix-tests', `Unattended run. \`npm test\` fails on your branch for ticket #${n}. Fix the cause, not the test, following AGENTS.md and the work-ticket skill. Commit the fix. The failing lines:\n${t.fails.join('\n')}`);
  }
  const red = proveRed(n, s, s.head || s.base);
  sh('git', ['push', '-u', 'origin', `HEAD:refs/heads/${s.branch}`], { cwd: s.dir });
  const pushed = head(s);
  const proof = `**Red → green, checked by the runner** (not the agent) for ${s.head ? s.head.slice(0, 7) : 'main'}..${pushed.slice(0, 7)}:\n${red.join('\n')}\n- \`${pushed.slice(0, 7)}\` (head): \`npm test\` **passes**, direct and relay.`;
  s.head = pushed; s.pushedAt = Date.now();
  if (!s.pr) {
    const body = (agentFile(s, 'pr-body.md') || `Closes #${n}`) + '\n\n' + proof;
    writeFileSync(join(HOME, `${n}-pr-body.md`), body);
    const url = gh('pr', 'create', '-R', REPO, '--head', s.branch, '--base', 'main', '--title', agentFile(s, 'pr-title.txt').trim() || `Ticket #${n}`, '--body-file', join(HOME, `${n}-pr-body.md`));
    s.pr = Number(url.split('/').pop());
    event(n, `pushed ${pushed.slice(0, 7)} and opened PR #${s.pr} (${why})`);
  } else {
    gh('pr', 'comment', String(s.pr), '-R', REPO, '--body', proof);
    event(n, `pushed ${pushed.slice(0, 7)} to PR #${s.pr} (${why})`);
  }
  s.phase = 'review'; save(n, s);
}

// The review, from Qodo and the owner only, written to .agent/review.md for the agent to read.
function writeReview(s, q, asks) {
  const inline = ghJson('api', `repos/${REPO}/pulls/${s.pr}/comments?per_page=100`).filter((c) => c.user.login === QODO)
    .map((c) => `### ${c.path}:${c.line ?? c.original_line ?? ''}\n${c.body}`);
  putAgentFile(s, 'review.md', `# Review of PR #${s.pr} at ${s.head.slice(0, 7)}\n\n` +
    (q ? `## Qodo's open findings\n${q.open.map((t) => `- ${t}`).join('\n') || 'none'}\n\n## Qodo's review comment\n${q.body}\n\n## Qodo's inline comments\n${inline.join('\n\n') || 'none'}\n\n` : '') +
    (asks.length ? `## From jtbinith (/agent)\n${asks.map((a) => a.body.slice(7)).join('\n\n')}\n` : ''));
}

// ---- one step per tick ----
let current = null;
try {
  const working = ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', L.working, '--json', 'number');
  if (working.length) {
    const n = working[0].number, s = load(n); current = { n, s };
    if (!s || s.phase !== 'review') throw new Stop(`Found #${n} labelled ${L.working} with no run in progress (phase: ${s?.phase ?? 'none'}). A run probably crashed.`);
    const asks = ownerAsks(s), q = qodoReview(s.pr);
    if (asks.length) {
      if (s.commentRounds >= LIMITS.commentRounds) throw new Stop(`The /agent comment limit (${LIMITS.commentRounds}) is used up.`);
      s.commentRounds++; s.lastAsk = asks.at(-1).id; save(n, s);
      event(n, `owner asked on PR #${s.pr}: ${asks.map((a) => a.body.slice(7, 80)).join(' | ')}`);
      writeReview(s, q && q.reviewed === s.head ? q : null, asks);
      agent(n, s, 'owner-comment', `Unattended run. jtbinith commented on PR #${s.pr} for ticket #${n}. The comment is in .agent/review.md. Make that change test first (a test: commit, then a fix: commit), following AGENTS.md and the work-ticket skill. Update .agent/report.md.`);
      checkAndPush(n, s, 'owner comment');
    } else if (!q || q.reviewed !== s.head) {
      if ((Date.now() - s.pushedAt) / 60000 > LIMITS.reviewWaitMin) throw new Stop(`Qodo hasn't reviewed ${s.head.slice(0, 7)} after ${LIMITS.reviewWaitMin} min.`);
    } else if (!q.open.length) {
      stop(n, s, L.done, `Qodo has no open findings on ${s.head.slice(0, 7)}. PR #${s.pr} is ready for you to review and merge.`);
    } else if (s.round >= LIMITS.reviewRounds) {
      throw new Stop(`${q.open.length} Qodo findings still open after ${LIMITS.reviewRounds} review rounds: ${q.open.join('; ')}`);
    } else {
      s.round++; save(n, s);
      event(n, `Qodo round ${s.round}: ${q.open.length} open (${q.open.join('; ')})`);
      writeReview(s, q, []);
      const before = head(s);
      agent(n, s, `review-${s.round}`, `Unattended run. Handle the review of PR #${s.pr} using step 7 of the skill at .claude/skills/work-ticket/SKILL.md. The review is in .agent/review.md.`);
      if (head(s) === before) throw new Stop(`The agent checked Qodo's ${q.open.length} open findings and judged none of them real (see its report). PR #${s.pr} needs your call.`);
      checkAndPush(n, s, `review round ${s.round}`);
    }
    process.exit(0);
  }

  const ready = ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', L.ready, '--json', 'number,title').sort((a, b) => a.number - b.number);
  for (const { number: n, title } of ready) {
    if (!labelledByOwner(n)) { event(n, `ignored: ${L.ready} wasn't added by ${OWNER}`); continue; }
    const openPrs = ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--json', 'number');
    if (openPrs.length) { event(n, `waiting: PR #${openPrs[0].number} is still open`); break; }
    current = { n, s: null };
    const t = issue(n);
    if (t.user.login !== OWNER) throw new Stop(`#${n} was written by ${t.user.login}, not ${OWNER}. The factory only works the owner's tickets.`);
    const blockers = ghJson('api', `repos/${REPO}/issues/${n}/dependencies/blocked_by`).filter((b) => b.state === 'open');
    if (blockers.length) throw new Stop(`#${n} is blocked by ${blockers.map((b) => '#' + b.number).join(', ')}.`);
    const slug = title.toLowerCase().replace(/^[^·]*·\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    let branch = `agent/${n}-${slug}`;
    for (let k = 2; sh('git', ['ls-remote', '--heads', 'origin', branch], { cwd: MAIN }); k++) branch = `agent/${n}-${slug}-${k}`;   // a re-run gets a new branch
    const s = { n, branch, dir: join(WORK, String(n)), runs: 0, round: 0, commentRounds: 0, phase: 'work', startedAt: now() };
    current.s = s;
    setLabels(n, [L.working], [L.ready, L.help, L.done].filter((l) => t.labels.some((x) => x.name === l))); moveCard(n, 'In Progress');
    comment(n, `Picked up by the factory at ${s.startedAt}. Branch \`${s.branch}\`. Limits: ${LIMITS.testAttempts} test attempts, ${LIMITS.reviewRounds} Qodo rounds, ${LIMITS.commentRounds} \`/agent\` rounds.`);
    event(n, `picked up (${title})`); notify(`Picked up #${n}`);
    sh('git', ['fetch', 'origin', 'main'], { cwd: MAIN });
    if (existsSync(s.dir)) { try { sh('git', ['worktree', 'remove', '--force', s.dir], { cwd: MAIN }); } catch { rmSync(s.dir, { recursive: true, force: true }); } }
    sh('git', ['worktree', 'prune'], { cwd: MAIN });
    sh('git', ['worktree', 'add', '-B', s.branch, s.dir, 'origin/main'], { cwd: MAIN });
    symlinkSync(join(MAIN, 'node_modules'), join(s.dir, 'node_modules'));
    s.base = head(s); save(n, s);
    putAgentFile(s, 'ticket.md', `# #${t.number} ${t.title}\n${t.html_url}\nWritten by ${t.user.login}. Labels: ${t.labels.map((l) => l.name).join(', ')}\n\n${t.body}\n`);
    agent(n, s, 'work', `Work ticket #${n} using the skill at .claude/skills/work-ticket/SKILL.md. This is an unattended run: follow its "Unattended runs" section. The ticket is in .agent/ticket.md.`);
    checkAndPush(n, s, 'first push');
    break;
  }
} catch (e) {
  if (!current) throw e;
  const why = e instanceof Stop ? e.message : `The runner crashed: ${e.message.split('\n').slice(0, 6).join('\n')}`;
  try { stop(current.n, current.s, L.help, why); } catch (e2) { event(current.n, `couldn't report the stop: ${e2.message.split('\n')[0]}`); notify(`#${current.n}: runner failed`); }
}

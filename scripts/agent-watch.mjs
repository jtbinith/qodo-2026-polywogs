#!/usr/bin/env node
// Runs one ticket through the factory without anyone opening a session.
//
// A systemd timer runs this every 10 minutes (scripts/systemd/), from the copy on origin/main.
// Once it picks a ticket up, it stays until the run is done or stopped:
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
import { testNames as namesInDiff, assertionFailures, decodeEntities, parseAsk, retryPlan, afterOwnerRound, staleFiles, unpublished, allPages, roundKind } from './runner-lib.mjs';

// Measured on PRs #39-#47: Qodo's first review took 0:25-3:19, re-reviews about 1 min.
const LIMITS = {
  testAttempts: 2,          // agent runs allowed to get `npm test` green per round
  reviewRounds: 3,          // Qodo review rounds the agent may answer
  commentRounds: 3,         // rounds started by an `/agent <instruction>` comment from the owner
  retryRounds: 5,           // `/agent retry` comments: they start no agent, so they have their own limit
  reviewWaitMin: 10,        // minutes to wait for Qodo after a push (about 3x the slowest seen)
  reviewPollSec: 30,        // how often to look for Qodo's review while waiting (re-reviews take about 1 min)
  agentRunMin: 45,          // one subagent run
  testRunMin: 15,           // one `npm test`
  commandMin: 5,            // one gh or git command
};
const REPO = 'jtbinith/qodo-hack-2026', OWNER = 'jtbinith', QODO = 'qodo-code-review[bot]';
const MAIN = join(homedir(), 'qodo-hack-2026');
// QODO_STATE points a rehearsal at a copy of the state. QODO_DRY_RUN=1 logs every GitHub write and
// push instead of doing it, and stops before any agent run or wait: the runner rehearsed, read-only.
const HOME = process.env.QODO_STATE || join(homedir(), '.local/state/qodo-agent'), WORK = join(homedir(), 'qodo-agent');
const DRY = process.env.QODO_DRY_RUN === '1';
const L = { ready: 'ready-for-agent', working: 'agent-working', done: 'agent-done', help: 'agent-needs-help', manual: 'needs-manual-check',
  blocked: 'agent-refused: blocked', notOwner: 'agent-refused: not owner\'s ticket' };
// paths the agent must never change: the factory itself
const GUARDED = [/^package(-lock)?\.json$/, /^scripts\//, /^\.claude\//, /^\.github\//, /^AGENTS\.md$/, /^\.gitignore$/, /^node_modules/];
mkdirSync(join(HOME, 'logs'), { recursive: true }); mkdirSync(WORK, { recursive: true });

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const event = (n, msg) => { const line = `${now()} #${n} ${msg}`; appendFileSync(join(HOME, 'events.log'), line + '\n'); console.log(line); };
// every gh and git call has a deadline: a hung network call becomes an error and the run stops with agent-needs-help
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: LIMITS.commandMin * 60000, killSignal: 'SIGKILL', ...opts }).trim();
const gh = (...args) => sh('gh', args);
const ghJson = (...args) => JSON.parse(gh(...args) || 'null');
const notify = (msg) => (DRY ? console.log(`DRY RUN would notify: ${msg}`) : spawnSync('notify-send', ['Qodo factory', msg]));
// every GitHub write and push goes through here, so a dry run can log it instead
const write = (what, fn, fake) => { if (!DRY) return fn(); console.log(`DRY RUN would ${what}`); return fake; };
const stateFile = (n) => join(HOME, `${n}.json`);
const load = (n) => existsSync(stateFile(n)) ? JSON.parse(readFileSync(stateFile(n), 'utf8')) : null;
const save = (n, s) => writeFileSync(stateFile(n), JSON.stringify(s, null, 2));
const fence = (t) => '```\n' + t.slice(0, 3000) + '\n```';

// One run at a time. The script re-runs itself under flock(1): the kernel holds the lock, a second
// copy (timer or by hand) exits at once, and the lock goes away with the process, even after a crash.
if (!process.env.QODO_FLOCKED) {
  const r = spawnSync('flock', ['-n', '-E', '75', join(HOME, 'run.lock'), process.execPath, process.argv[1], ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, QODO_FLOCKED: '1' } });
  process.exit(r.status === 75 ? 0 : r.status ?? 1);             // 75: another run holds the lock
}

// ---- GitHub, read and written only by the script ----
const issue = (n) => ghJson('api', `repos/${REPO}/issues/${n}`);
// every page: anyone can comment on a public repo, and a long run collects many events
const issueComments = (n) => allPages((page) => ghJson('api', `repos/${REPO}/issues/${n}/comments?per_page=100&page=${page}`));
const issueEvents = (n) => allPages((page) => ghJson('api', `repos/${REPO}/issues/${n}/events?per_page=100&page=${page}`));
function labelledByOwner(n) {
  const latest = issueEvents(n).filter((e) => (e.event === 'labeled' || e.event === 'unlabeled') && e.label?.name === L.ready).at(-1);
  return latest?.event === 'labeled' && latest.actor.login === OWNER;
}
const setLabels = (n, add, remove) => write(`label #${n}: +${add.join(', +') || '-'} −${remove.join(', −') || '-'}`, () => gh('issue', 'edit', String(n), '-R', REPO, ...add.flatMap((l) => ['--add-label', l]), ...remove.flatMap((l) => ['--remove-label', l])));
const comment = (n, body) => write(`comment on #${n}: ${body.split('\n')[0].slice(0, 100)}`, () => gh('issue', 'comment', String(n), '-R', REPO, '--body', body));
const LABEL_INFO = {
  [L.ready]: ['0e8a16', 'Owner only: the factory works this ticket unattended'], [L.working]: ['fbca04', 'The factory is working this ticket'],
  [L.done]: ['1d76db', 'The factory finished; waiting for the owner to merge'], [L.help]: ['d93f0b', 'The factory stopped and needs the owner'],
  [L.manual]: ['c5def5', 'The factory finished, but some acceptance needs the owner to check by hand'],
  [L.blocked]: ['5319e7', "Refused before starting: an issue it's blocked by is still open"], [L.notOwner]: ['5319e7', "Refused before starting: the ticket wasn't written by the owner"],
};
function ensureLabels() {   // a fresh repo has none of these: create what's missing before using any
  const have = ghJson('label', 'list', '-R', REPO, '--limit', '200', '--json', 'name').map((l) => l.name);
  for (const [name, [color, desc]] of Object.entries(LABEL_INFO)) if (!have.includes(name)) write(`create label ${name}`, () => gh('label', 'create', name, '-R', REPO, '--color', color, '--description', desc));
}
// a ticket whose refusal couldn't be reported is skipped for an hour, so it can't block the queue
const SKIP = join(HOME, 'skip.json');
const skipped = () => existsSync(SKIP) ? JSON.parse(readFileSync(SKIP, 'utf8')) : {};
const skip = (n) => writeFileSync(SKIP, JSON.stringify({ ...skipped(), [n]: Date.now() }));
function moveCard(n, column) {
  try {
    const P = gh('project', 'view', '7', '--owner', OWNER, '--format', 'json', '-q', '.id');
    const ITEM = gh('project', 'item-list', '7', '--owner', OWNER, '--limit', '200', '--format', 'json', '-q', `.items[] | select(.content.number==${n}) | .id`);
    const FIELD = gh('project', 'field-list', '7', '--owner', OWNER, '--format', 'json', '-q', '.fields[] | select(.name=="Status") | .id');
    const OPT = gh('project', 'field-list', '7', '--owner', OWNER, '--format', 'json', '-q', `.fields[] | select(.name=="Status") | .options[] | select(.name=="${column}") | .id`);
    if (ITEM) write(`move #${n}'s card to ${column}`, () => gh('project', 'item-edit', '--project-id', P, '--id', ITEM, '--field-id', FIELD, '--single-select-option-id', OPT));
  } catch (e) { event(n, `card not moved to ${column}: ${e.message.split('\n')[0]}`); }
}
// Qodo's review comment ends with the commit it reviewed. Open findings are the numbered
// findings not struck through as resolved.
function qodoReview(pr) {
  const c = issueComments(pr).filter((x) => x.user.login === QODO && /Code Review by Qodo/.test(x.body)).at(-1);
  if (!c) return null;
  const reviewed = [...c.body.matchAll(/commit\/([0-9a-f]{40}) -->/g)].at(-1)?.[1];
  const open = [...c.body.matchAll(/<summary>\s+\d+\.\s+(.*?)<\/summary>/g)].map((m) => m[1])
    .filter((t) => !t.startsWith('<s>') && !/Resolved/.test(t)).map((t) => decodeEntities(t.replace(/<[^>]+>/g, '').trim()));
  return { reviewed, open, body: c.body, at: Date.parse(c.updated_at) };   // when Qodo last updated its review
}
const ownerAsks = (s) => issueComments(s.pr).filter((x) => x.user.login === OWNER && /^\/agent\s/.test(x.body) && x.id > (s.lastAsk || 0));
// what the owner's account did on GitHub: compared before and after every agent run
const footprint = (s) => JSON.stringify({
  refs: sh('git', ['ls-remote', '--heads', 'origin'], { cwd: MAIN }),
  issue: issueComments(s.n).filter((c) => c.user.login === OWNER).length,
  issueEvents: issueEvents(s.n).length,
  pr: s.pr ? issueComments(s.pr).filter((c) => c.user.login === OWNER).length : 0,
  prs: ghJson('pr', 'list', '-R', REPO, '--state', 'all', '--limit', '5', '--json', 'number').map((p) => p.number).join(),
});

// ---- the agent: no GitHub, no MCP, no user settings; only file tools, tests and local git ----
const AGENT_SETTINGS = join(HOME, 'agent-settings.json'), BIN = join(HOME, 'bin'), SANDBOX = join(HOME, 'sandbox.sh');
const IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';   // matches package.json's playwright
// Code the agent writes runs only in a throwaway container that sees the worktree and node_modules:
// no home directory, so no gh login, SSH keys, AWS or Claude settings. Network stays (the relay test).
writeFileSync(SANDBOX, `#!/bin/sh
WD="$(pwd -P)"; NM="${join(MAIN, 'node_modules')}"
exec docker run --rm -i --init --network bridge --dns 1.1.1.1 --user "$(id -u):$(id -g)" \\
  --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:exec --shm-size 1g \\
  -e HOME=/tmp -e CI=1 -v "$WD:$WD" -v "$NM:$NM:ro" -w "$WD" ${IMAGE} "$@"
`, { mode: 0o755 });
mkdirSync(BIN, { recursive: true });
for (const tool of ['node', 'npm', 'npx']) writeFileSync(join(BIN, tool), `#!/bin/sh\nexec ${SANDBOX} ${tool} "$@"\n`, { mode: 0o755 });
{ // sign-in only (Bedrock). No permissions, plugins, hooks or MCP from the user's settings.
  const user = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'));
  const keep = Object.fromEntries(['awsCredentialExport', 'env', 'model'].filter((k) => k in user).map((k) => [k, user[k]]));
  keep.permissions = { deny: ['.ssh', '.config', '.aws', '.claude', '.kiro', '.local', '.midway', '.toolbox', '.gnupg', 'Documents', 'Pictures'].map((d) => `Read(~/${d}/**)`) };
  writeFileSync(AGENT_SETTINGS, JSON.stringify(keep));
}
const TOOLS = 'Read,Edit,Write,Glob,Grep,Bash,Skill';
const ALLOW = ['Skill',   // Read, Glob, Grep and Edit are allowed only inside the worktree (in agent())
  // A prefix rule only matches when a space follows the prefix ("npm run test:*" never matched
  // "npm run test:unit"), so test commands that don't take arguments are listed exactly.
  'Bash(npm test:*)', 'Bash(npm run test:unit)', 'Bash(npm run test:browsers)', 'Bash(node --test:*)',
  'Bash(node tests/two-browser.mjs)', 'Bash(node tests/two-browser.mjs --relay)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];
const DENY = ['Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git reset:*)', 'Bash(git remote:*)', 'Bash(gh:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(ssh:*)', 'WebFetch', 'WebSearch'];
class Stop extends Error {}
// refused before any agent starts: the label says why, the comment says the detail
class Refuse extends Error { constructor(label, msg) { super(msg); this.label = label; } }
function agent(n, s, what, prompt) {
  const log = join(HOME, 'logs', `${n}-${s.runs + 1}-${what}.log`), before = footprint(s), from = head(s);
  if (DRY) throw new Stop(`DRY RUN stops here: it would start agent run ${s.runs + 1} (${what}).`);
  clearStale(s, 'agent-run');
  event(n, `agent run ${s.runs + 1} (${what}) started`);
  const r = spawnSync('claude', ['-p', prompt, '--setting-sources', 'project', '--settings', AGENT_SETTINGS, '--strict-mcp-config',
    '--tools', TOOLS, '--allowedTools', ...ALLOW, `Read(/${s.dir}/**)`, `Edit(/${s.dir}/**)`, '--disallowedTools', ...DENY, '--output-format', 'text'],
    { cwd: s.dir, encoding: 'utf8', timeout: LIMITS.agentRunMin * 60000, stdio: ['ignore', 'pipe', 'pipe'],
      // a small environment: the agent's node and npm are the container ones in BIN
      env: { PATH: `${BIN}:${process.env.PATH}`, HOME: homedir(), USER: process.env.USER || '', LANG: process.env.LANG || 'C.UTF-8', AWS_REGION: process.env.AWS_REGION || '', AGENT_RUN: '1' } });
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
  const dirty = uncommitted(s);
  if (dirty.length) throw new Stop(`Agent run ${s.runs} left uncommitted changes, so the tested code wouldn't be the pushed code: ${dirty.join(', ')}`);
}

const uncommitted = (s) => sh('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: s.dir }).split('\n').filter((l) => l && !/ \.agent\//.test(l) && !/ node_modules$/.test(l));
function npmTest(dir) {
  const r = spawnSync(SANDBOX, ['npm', 'test'], { cwd: dir, encoding: 'utf8', timeout: LIMITS.testRunMin * 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { ok: r.status === 0 && !/^FAIL /m.test(out), out, fails: out.split('\n').filter((l) => /^FAIL |^✖ |AssertionError/.test(l)) };
}
const head = (s) => sh('git', ['rev-parse', 'HEAD'], { cwd: s.dir });
const agentFile = (s, f) => { const p = join(s.dir, '.agent', f); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
const clearStale = (s, when) => staleFiles(when).forEach((f) => write(`remove .agent/${f}`, () => rmSync(join(s.dir, '.agent', f), { force: true })));
const putAgentFile = (s, f, text) => { mkdirSync(join(s.dir, '.agent'), { recursive: true }); writeFileSync(join(s.dir, '.agent', f), text); };

const testNames = (s, sha) => namesInDiff(sh('git', ['show', '--format=', '-U0', sha], { cwd: s.dir }));
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
    const names = testNames(s, c.sha), named = assertionFailures(t.out, names);
    if (!named.length) throw new Stop(`\`${c.sha.slice(0, 7)} ${c.subject}\` fails, but no assertion fails in one of its new tests (${names.slice(0, 5).map((x) => `"${x}"`).join(', ') || 'none found'}). It may have failed for another reason.\n\n${fence(t.fails.slice(0, 15).join('\n'))}`);
    lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}: **fails on its own new tests** (${named.length} of ${t.fails.length} failing lines), for example \`${named[0].slice(0, 120)}\``);
    event(n, `red checked: ${c.sha.slice(0, 7)} fails on its own (${t.fails.length} failing lines)`);
  }
  return lines;
}

// the agent's Assumptions section from its report, shown in the open (not folded away)
const assumptions = (report) => (report.match(/^#+\s*Assumptions\s*\n([\s\S]*?)(?=^#+\s|(?![\s\S]))/m)?.[1] || '').trim();
// acceptance the agent couldn't check itself: unticked boxes in its PR description
const uncheckedCriteria = (body) => body.split('\n').filter((l) => /^\s*[-*]\s*\[ \]/.test(l)).map((l) => l.replace(/^\s*[-*]\s*\[ \]\s*/, '').trim());
// a one-line reason for the popup: the first list item, else the first plain sentence (no headings or links)
function shortReason(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const item = lines.find((l) => /^[-*]\s/.test(l)), plain = lines.find((l) => !/^(#|>|https?:)/.test(l) && !l.endsWith(':'));
  return ((item || plain || '').replace(/^[-*]\s+/, '').replace(/[*_`]/g, '').split(/(?<=\.)\s/)[0] || '').slice(0, 110);
}
function stop(n, s, label, why) {
  if (s) { s.phase = label === L.done ? 'done' : 'help'; save(n, s); }
  const has = issue(n).labels.map((l) => l.name);
  const report = s ? agentFile(s, 'report.md') : '', unchecked = label === L.done && s ? uncheckedCriteria(agentFile(s, 'pr-body.md')) : [];
  setLabels(n, [label, ...(unchecked.length ? [L.manual] : [])], [L.working, L.ready].filter((l) => has.includes(l)));
  const assumed = assumptions(report);
  comment(n, `**Factory run ${label === L.done ? 'finished' : 'stopped and needs you'}.** ${why}\n\n` +
    (unchecked.length ? `**Needs your check by hand** (the agent couldn't check these itself):\n${unchecked.map((u) => `- [ ] ${u}`).join('\n')}\n\n` : '') +
    (assumed ? `**Assumptions the agent made** (the ticket didn't say):\n${assumed}\n\n` : '') +
    (s ? `Agent runs: ${s.runs} · review rounds: ${s.round}/${LIMITS.reviewRounds} · instruction rounds: ${s.commentRounds}/${LIMITS.commentRounds} · retries: ${s.retryRounds || 0}/${LIMITS.retryRounds}` + (s.pr ? ` · PR #${s.pr}` : '') : '') +
    (s?.pr ? `\n\nOn PR #${s.pr}: comment \`/agent <what to change>\` for another round (up to ${LIMITS.commentRounds}), or \`/agent retry\` if the runner itself was wrong (up to ${LIMITS.retryRounds}).` : '') +
    (report ? `\n\n<details><summary>Agent report</summary>\n\n${report}\n</details>` : ''));
  const extra = unchecked.length ? ` ${unchecked.length} check${unchecked.length > 1 ? 's need' : ' needs'} you.` : '';
  const first = why.split('\n')[0], rest = why.split('\n').slice(1).join('\n');
  const reason = rest.trim() ? `${first.replace(/:$/, '.')} ${shortReason(rest)}` : first;
  if (label === L.help && s && !s.pr) moveCard(n, 'Ready');   // nothing was opened: back to Ready, with the label saying why
  event(n, `${label}: ${reason}${extra}`); notify(`#${n}: ${label}.${extra} ${reason}`);
}

// Gets the agent's commits green, proves the red, then pushes. Throws Stop when it can't.
function checkAndPush(n, s, why) {
  for (let attempt = 1; ; attempt++) {
    if (agentFile(s, 'stop.md')) throw new Stop('The agent stopped instead of guessing:\n\n' + agentFile(s, 'stop.md'));
    if (head(s) === (s.head || s.base)) throw new Stop('The agent made no new commits.');
    if (uncommitted(s).length) throw new Stop(`Uncommitted changes before testing: ${uncommitted(s).join(', ')}`);
    const t = npmTest(s.dir);
    writeFileSync(join(HOME, 'logs', `${n}-${s.runs}-npm-test.log`), t.out);
    event(n, `npm test ${t.ok ? 'passed' : 'FAILED'} on ${head(s).slice(0, 7)}`);
    if (t.ok) break;
    if (attempt >= LIMITS.testAttempts) throw new Stop(`\`npm test\` still fails after ${attempt} attempts:\n\n${fence(t.fails.join('\n'))}`);
    putAgentFile(s, 'test-output.txt', t.out.split('\n').slice(-150).join('\n'));
    agent(n, s, 'fix-tests', `Unattended run. \`npm test\` fails on your branch for ticket #${n}. The last 150 lines of the runner's run are in .agent/test-output.txt. Fix the cause, not the test, following AGENTS.md and the work-ticket skill. Commit the fix. If it isn't caused by this branch, stop as the skill says and say why. The failing lines:\n${t.fails.join('\n')}`);
  }
  const red = proveRed(n, s, s.head || s.base);
  write(`push ${head(s).slice(0, 7)} to ${s.branch}`, () => sh('git', ['push', '-u', 'origin', `HEAD:refs/heads/${s.branch}`], { cwd: s.dir }));
  const pushed = head(s);
  const proof = `**Red → green, checked by the runner** (not the agent) for ${s.head ? s.head.slice(0, 7) : 'main'}..${pushed.slice(0, 7)}:\n${red.join('\n')}\n- \`${pushed.slice(0, 7)}\` (head): \`npm test\` **passes**, direct and relay.`;
  s.head = pushed; s.pushedAt = s.waitFrom = Date.now(); s.proofs = [...(s.proofs || []), proof];
  if (!s.pr) {
    writeFileSync(join(HOME, `${n}-pr-body.md`), prBody(n, s));
    const url = write(`open a PR from ${s.branch}`, () => gh('pr', 'create', '-R', REPO, '--head', s.branch, '--base', 'main', '--title', agentFile(s, 'pr-title.txt').trim() || `Ticket #${n}`, '--body-file', join(HOME, `${n}-pr-body.md`)), 'https://github.com/x/pull/0');
    s.pr = Number(url.split('/').pop()); s.posted = s.proofs.length;
    event(n, `pushed ${pushed.slice(0, 7)} and opened PR #${s.pr} (${why})`);
  } else event(n, `pushed ${pushed.slice(0, 7)} to PR #${s.pr} (${why})`);
  s.phase = 'review'; save(n, s);
  publish(n, s);
}

// the PR description is always the agent's latest description plus every proof so far,
// so the PR and the finished-run comment read from the same text
const prBody = (n, s) => (agentFile(s, 'pr-body.md') || `Closes #${n}`) + '\n\n' + (s.proofs || []).join('\n\n');
// Posts what's pushed but not yet on the PR: the description, and each new proof as a comment.
// It's resumable: a crash between push and post is caught up on the next step or /agent retry.
// (gh api, not gh pr edit: gh pr edit fails on this repo with a classic-projects error.)
function publish(n, s) {
  const todo = unpublished(s.proofs || [], s.posted, !!s.pr);
  if (!s.pr || !todo.length) return;
  writeFileSync(join(HOME, `${n}-pr-body.md`), prBody(n, s));
  write(`update PR #${s.pr}'s description`, () => gh('api', '-X', 'PATCH', `repos/${REPO}/pulls/${s.pr}`, '-F', `body=@${join(HOME, `${n}-pr-body.md`)}`, '--jq', '.number'));
  for (const p of todo) comment(s.pr, p);   // a PR is an issue, so this is the same call as ticket comments
  s.posted = s.proofs.length; save(n, s);   // in a dry run this is the copy of the state
  event(n, `published ${todo.length} proof${todo.length > 1 ? 's' : ''} on PR #${s.pr}`);
}

// The review, from Qodo and the owner only, written to .agent/review.md for the agent to read.
function writeReview(s, q, asks) {
  const inline = ghJson('api', `repos/${REPO}/pulls/${s.pr}/comments?per_page=100`).filter((c) => c.user.login === QODO)
    .map((c) => `### ${c.path}:${c.line ?? c.original_line ?? ''}\n${c.body}`);
  putAgentFile(s, 'review.md', `# Review of PR #${s.pr} at ${s.head.slice(0, 7)}\n\n` +
    (q ? `## Qodo's open findings\n${q.open.map((t) => `- ${t}`).join('\n') || 'none'}\n\n## Qodo's review comment\n${q.body}\n\n## Qodo's inline comments\n${inline.join('\n\n') || 'none'}\n\n` : '') +
    (asks.length ? `## From jtbinith (/agent)\n${asks.map((a) => a.body.slice(7)).join('\n\n')}\n` : ''));
}

function refuse(n, t, e) {
  try {
    setLabels(n, [e.label], [L.ready, L.help, L.done, L.manual].filter((l) => t.labels.some((x) => x.name === l)));
    comment(n, `**Factory refused this ticket before starting.** ${e.message}\n\nRemove the reason and label it \`${L.ready}\` again to retry.`);
    event(n, `refused (${e.label}): ${e.message}`); notify(`#${n}: refused. ${e.message}`);
  } catch (e2) {
    skip(n); event(n, `couldn't report the refusal, skipping it for an hour: ${e2.message.split('\n')[0]}`);
    notify(`#${n}: refused (${e.label}), but the label couldn't be set. Skipped for an hour.`);
  }
}

// After a push the runner waits for Qodo itself, checking every 30 s (re-reviews were measured at
// about 1 min), then answers the review. It ends the tick only when the run is done or stopped.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function continueRun(n, s) {
  for (;;) {
    publish(n, s);   // anything pushed but not posted yet (after a crash or a retry)
    const asks = ownerAsks(s), q = qodoReview(s.pr);
    if (asks.length) {
      const asked = asks.map((a) => parseAsk(a.body)), told = asked.filter((a) => roundKind(a) === 'instruction');
      if (told.length && s.commentRounds >= LIMITS.commentRounds) throw new Stop(`The /agent instruction limit (${LIMITS.commentRounds}) is used up.`);
      if (!told.length && (s.retryRounds || 0) >= LIMITS.retryRounds) throw new Stop(`The /agent retry limit (${LIMITS.retryRounds}) is used up.`);
      if (told.length) s.commentRounds++; else s.retryRounds = (s.retryRounds || 0) + 1;
      s.lastAsk = asks.at(-1).id; save(n, s);
      event(n, `owner asked on PR #${s.pr}: ${asks.map((a) => a.body.slice(7, 80)).join(' | ')}`);
      if (!told.length) {   // only /agent retry: the runner was wrong, so re-check without an agent run
        if (retryPlan(head(s), s.head) === 'push') checkAndPush(n, s, 'owner retry');
        else { s.waitFrom = Date.now(); save(n, s); event(n, `owner retry: nothing new to push, waiting for Qodo's review of ${s.head.slice(0, 7)} again`); }   // pushedAt stays: it times Qodo's review
        continue;
      }
      // instructions go to the agent. A retry alongside them is covered by the checks that follow.
      // If the agent changes nothing, the run stops and asks the owner (afterOwnerRound)
      writeReview(s, q && q.reviewed === s.head ? q : null, asks.filter((a, i) => !asked[i].retry));
      const before = head(s);
      agent(n, s, 'owner-comment', `Unattended run. jtbinith commented on PR #${s.pr} for ticket #${n}. The comment is in .agent/review.md. Make that change test first (a test: commit, then a fix: commit), following AGENTS.md and the work-ticket skill. Update .agent/report.md.`);
      if (afterOwnerRound({ committed: head(s) !== before }) === 'stop')
        throw new Stop(`The agent made no change for your /agent request. Its reasons are in the report below. Comment \`/agent retry\` on its own on PR #${s.pr} to re-run the checks.`);
      checkAndPush(n, s, 'owner comment');
    } else if (!q || q.reviewed !== s.head) {
      if ((Date.now() - (s.waitFrom || s.pushedAt)) / 60000 > LIMITS.reviewWaitMin) throw new Stop(`Qodo hasn't reviewed ${s.head.slice(0, 7)} after ${LIMITS.reviewWaitMin} min.`);
      if (DRY) { console.log(`DRY RUN would wait for Qodo's review of ${s.head.slice(0, 7)} (reviewed so far: ${q?.reviewed?.slice(0, 7) ?? 'none'})`); process.exit(0); }
      sleep(LIMITS.reviewPollSec * 1000);
    } else if (!q.open.length) {
      event(n, `Qodo reviewed ${s.head.slice(0, 7)} ${Math.round((q.at - s.pushedAt) / 1000)} s after the push: no open findings`);
      return stop(n, s, L.done, `Qodo has no open findings on ${s.head.slice(0, 7)}. PR #${s.pr} is ready for you to review and merge.`);
    } else if (s.round >= LIMITS.reviewRounds) {
      throw new Stop(`${q.open.length} Qodo findings still open after ${LIMITS.reviewRounds} review rounds: ${q.open.join('; ')}`);
    } else {
      s.round++; save(n, s);
      event(n, `Qodo reviewed ${s.head.slice(0, 7)} ${Math.round((q.at - s.pushedAt) / 1000)} s after the push. Round ${s.round}: ${q.open.length} open (${q.open.join('; ')})`);
      writeReview(s, q, []);
      const before = head(s);
      agent(n, s, `review-${s.round}`, `Unattended run. Handle the review of PR #${s.pr} using step 7 of the skill at .claude/skills/work-ticket/SKILL.md. The review is in .agent/review.md.`);
      if (head(s) === before) throw new Stop(`The agent checked Qodo's ${q.open.length} open findings and judged none of them real (see its report). PR #${s.pr} needs your call.`);
      checkAndPush(n, s, `review round ${s.round}`);
    }
  }
}

// ---- one step per tick ----
let current = null;
try {
  // the labels must exist before the owner can apply ready-for-agent: create them on the first run
  const LABELS_OK = join(HOME, 'labels-ok');
  const labelSet = Object.keys(LABEL_INFO).sort().join('|');   // re-checked whenever the set of labels changes
  if (!existsSync(LABELS_OK) || readFileSync(LABELS_OK, 'utf8') !== labelSet) { ensureLabels(); writeFileSync(LABELS_OK, labelSet); }
  const working = ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', L.working, '--json', 'number');
  if (working.length) {
    const n = working[0].number, s = load(n); current = { n, s };
    if (!s || s.phase !== 'review') throw new Stop(`Found #${n} labelled ${L.working} with no run in progress (phase: ${s?.phase ?? 'none'}). A run probably crashed.`);
    continueRun(n, s);
    process.exit(0);
  }

  // a finished or stopped run whose PR is still open: an /agent comment from the owner starts another round
  const finished = [L.done, L.help].flatMap((l) => ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', l, '--json', 'number'));
  for (const { number: n } of finished) {
    const s = load(n);
    if (!s?.pr || ghJson('pr', 'view', String(s.pr), '-R', REPO, '--json', 'state').state !== 'OPEN' || !ownerAsks(s).length) continue;
    current = { n, s };
    const has = issue(n).labels.map((l) => l.name);
    setLabels(n, [L.working], [L.done, L.help, L.manual].filter((l) => has.includes(l)));
    s.phase = 'review'; save(n, s); clearStale(s, 'reopen');   // the owner's comment overrides the last stop
    event(n, `reopened by an /agent comment on PR #${s.pr}`); notify(`#${n}: working on your /agent comment`);
    continueRun(n, s);
    process.exit(0);
  }

  const ready = ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', L.ready, '--json', 'number,title').sort((a, b) => a.number - b.number);
  for (const { number: n, title } of ready) {
    if (Date.now() - (skipped()[n] || 0) < 3600000) continue;
    if (!labelledByOwner(n)) { event(n, `ignored: ${L.ready} wasn't added by ${OWNER}`); continue; }
    const openPrs = ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--json', 'number');
    if (openPrs.length) { event(n, `waiting: PR #${openPrs[0].number} is still open`); break; }
    const t = issue(n);
    const blockers = ghJson('api', `repos/${REPO}/issues/${n}/dependencies/blocked_by`).filter((b) => b.state === 'open');
    const refusal = t.user.login !== OWNER ? new Refuse(L.notOwner, `#${n} was written by ${t.user.login}, not ${OWNER}. The factory only works the owner's tickets.`)
      : blockers.length ? new Refuse(L.blocked, `#${n} is blocked by ${blockers.map((b) => '#' + b.number).join(', ')}, which ${blockers.length > 1 ? 'are' : 'is'} still open. Nothing was started.`) : null;
    if (refusal) { refuse(n, t, refusal); continue; }   // the next ticket can still start this tick
    current = { n, s: null };
    const slug = title.toLowerCase().replace(/^[^·]*·\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    let branch = `agent/${n}-${slug}`;
    for (let k = 2; sh('git', ['ls-remote', '--heads', 'origin', branch], { cwd: MAIN }); k++) branch = `agent/${n}-${slug}-${k}`;   // a re-run gets a new branch
    const s = { n, branch, dir: join(WORK, String(n)), runs: 0, round: 0, commentRounds: 0, phase: 'work', startedAt: now() };
    current.s = s;
    setLabels(n, [L.working], [L.ready, L.help, L.done, L.manual, L.blocked, L.notOwner].filter((l) => t.labels.some((x) => x.name === l))); moveCard(n, 'In Progress');
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
    continueRun(n, s);
    break;
  }
} catch (e) {
  if (!current) throw e;
  const why = e instanceof Stop ? e.message : `The runner crashed: ${e.message.split('\n').slice(0, 6).join('\n')}`;
  try { stop(current.n, current.s, L.help, why); } catch (e2) { event(current.n, `couldn't report the stop: ${e2.message.split('\n')[0]}`); notify(`#${current.n}: runner failed`); }
}

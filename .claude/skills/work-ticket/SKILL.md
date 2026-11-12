---
name: work-ticket
description: Work one ticket from the GitHub backlog end to end. Read it with gh, branch, write failing tests from its acceptance, implement, verify and open a PR. Use when asked to work, pick up or implement ticket #N.
---

# Work a ticket

You get an issue number. Read the ticket from GitHub with `gh issue view`, never from a pasted copy.

## 1. Read
- Run `gh issue list --state open --limit 50`, then `gh issue view <N> --json number,title,url,state,labels,body,comments`. Use `--json`: the plain `--comments` form fails on this repo with a classic-projects error.
- Start your report with the ticket's title, link and acceptance, copied from that output.
- Read its PRD row in `docs/PRD.md` and its threat rows in `docs/THREAT-MODEL.md`.
- Stop and report instead of guessing if:
  - the acceptance has no result you can observe
  - it contradicts AGENTS.md or the PRD
  - any issue listed by `gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` is still open

## 2. Start
- Review changes from the last ticket must be merged first. If `gh pr list --state open` shows another ticket's PR, stop and say so.
- `git switch main && git pull`, then `git switch -c <id>-<short-name>`, for example `s6-strip-jpeg-metadata`.
- Move the card to **In Progress** (see Board).

## 3. Test first
- Write a test for every acceptance criterion and edge case before changing the code: `tests/*.test.mjs` for units, `tests/two-browser.mjs` for device behaviour.
- Run them and keep the failing output for the PR's **Red** section. Red must be an assertion failure, not an import or syntax error: add a stub first if the code doesn't exist yet.

## 4. Implement
- Follow every rule in AGENTS.md. Make the smallest change that meets the acceptance. Nothing unrelated.
- Run `npm test`: unit tests and the two-browser test, direct and relay. Keep the passing output for the PR's **Tested** section. If a run couldn't happen, say so. Never claim a pass you didn't see.

## 5. Update the docs
- `docs/THREAT-MODEL.md`: move the requirement ID from Planned to In place for each threat it closes.
- `docs/ARCHITECTURE.md`: update the message, key or check tables if they changed.
- `docs/TESTING.md`: change "(to write)" to "(exists)" for each test the ticket adds.

## 6. Stop before pushing
- Commit using Conventional Commits in plain English, for example `fix: drop setup from unknown devices`.
- **Do not push.** End with your report and the PR description, filled in from `.github/pull_request_template.md`: ticket, PRD and threat IDs, each criterion with its result, the edge case, Red and Tested.
- Push only after the user says yes in the main session. Then: `git push -u origin <branch>`, `gh pr create --body-file <description>` and move the card to **In Review**.

## 7. Handle the review
Started separately, for example "handle the review of #N".
- Read the findings: `gh pr view <PR> --json comments,reviews` for Qodo's summary and `gh api repos/{owner}/{repo}/pulls/<PR>/comments` for inline comments. Use `--json`: the plain `--comments` form fails here and can print nothing while still exiting 0.
- For each Qodo finding, say whether it is confirmed, wrong or out of scope, checked against the code and the ticket. Note anything the ticket asked for that the review didn't check.
- Fix confirmed findings test first. Rerun `npm test`. Stop before pushing, as in step 6.
- Say whether the ticket itself was wrong.
- Decide whether a finding calls for a rule in AGENTS.md, a change to this skill or more context for the reviewer. Propose it. It merges before the next ticket starts.
- After the merge, move the card to **Done**.

## Board
Project 7 (owner jtbinith). To move ticket `<N>` to a column such as `In Progress`:
```sh
P=$(gh project view 7 --owner jtbinith --format json -q .id)
ITEM=$(gh project item-list 7 --owner jtbinith --limit 200 --format json -q '.items[] | select(.content.number==<N>) | .id')
FIELD=$(gh project field-list 7 --owner jtbinith --format json -q '.fields[] | select(.name=="Status") | .id')
OPT=$(gh project field-list 7 --owner jtbinith --format json -q '.fields[] | select(.name=="Status") | .options[] | select(.name=="In Progress") | .id')
gh project item-edit --project-id "$P" --id "$ITEM" --field-id "$FIELD" --single-select-option-id "$OPT"
```

## Report
End with the ticket, branch and PR, red and green test output, each criterion with its result, the edge case result, the docs updated and anything you're unsure of.

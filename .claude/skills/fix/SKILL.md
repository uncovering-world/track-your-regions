---
name: fix
description: "Fix a Bug: Work on a bug fix from a GitHub issue."
---

# Fix a Bug

Work on a bug fix from a GitHub issue. This is a streamlined workflow for bugs — read the issue, understand the problem, find the code, fix it, and verify.

## Arguments

$ARGUMENTS — required: GitHub issue number.

## Prerequisites

Before starting, read `docs/tech/development-guide.md` — it defines the project's code organization conventions, file size rules, reuse-first principle, commit format, and documentation requirements. All work must follow these rules.

## Instructions

### 1. Load the issue

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,comments,state,issueType,subIssues,blockedBy,parent
```

If the issue doesn't exist or `state` is not `OPEN`, tell the user and stop. Two more gates, with the same precedence `/feature` § 1 states: an **Epic** is never fixed directly — when it has a slice list (wherever its body keeps it) and every listed slice carries its ledger mark (`→ #N`, `→ merged into #N` or `→ dropped: …` — `→ #N` written at filing by `/issue-create` § 4 and `/issue-upload` § 5, all three by `/feature` § 1 when it decomposes or reconciles), point at the open sub-issues; otherwise — no list yet (#469), no marks, or unmarked slices (#497: eight listed, none marked yet, and its one sub-issue #264 covers none of them, so all eight remain to file) — hand it to `/feature <number>`, whose § 1 reconciles the existing sub-issues onto the ledger and then decomposes or resumes from the first unmarked slice, blocked or not, each slice created the `/issue-create` §§ 2–5 way with `--parent`, the Epic's milestone and `--blocked-by` its open blockers. For any other issue, an entry with `state == OPEN` in `blockedBy` means it is not ready — name the blocker and stop (on 2026-09-02 #549 was the bug in that position, blocked by #522). A `parent` means this bug is one slice of a larger issue: read the parent's body too.

### 2. Understand the problem

- Read the issue title, description, and **every comment on it** — the thread is part of the issue, not decoration. A later comment can update the premise the body rests on, retriage the work, or record that half of it already shipped; where the two disagree, the newest statement that names its evidence wins and the body is what went stale. #521 is the measured case: the body called the defect unreachable until #500 gated a source, and a comment eleven days later recorded that the gate had shipped in #534 and was on for all three categories
- Extract the specific bug behavior described
- Identify reproduction steps if provided
- Note any files or areas of code mentioned

### 3. Create a branch

First, read the issue's board Status (`project` scope; when it cannot be read, say so and go on as for a new start):

```bash
gh issue view $ARGUMENTS --json projectItems --jq '.projectItems[].status.name'
```

If it is ⏳ Waiting, the issue was started already and what it waited on has now arrived. Resume it, never re-start it: read the issue's thread and its queue item for where it stopped, reuse its branch when one is open (skip the checkout below), and move it back to 🏗 In progress. Otherwise:

```bash
git checkout main
git pull
git checkout -b fix/$ARGUMENTS-<short-slug>
```

Use a short slug derived from the issue title (e.g., `fix/42-login-crash`).

Mark the issue as being worked on:

```bash
scripts/board.sh status $ARGUMENTS "In progress"
```

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself.

### 4. Investigate

- **Read area-specific docs** for the affected area before diving into code:

  | Area | Read |
  |------|------|
  | Map rendering, tiles, interactions | `docs/tech/maplibre-patterns.md` |
  | Map UI (markers, hover, selection) | `docs/tech/experience-map-ui.md` |
  | Geometry, triggers, simplification | `docs/tech/geometry-columns.md` |
  | Shared frontend components/utils | `docs/tech/shared-frontend-patterns.md` |
  | Experience system (sync, sources) | `docs/tech/experiences.md` |
  | Auth flows (JWT, OAuth, tokens) | `docs/tech/authentication.md` |

- **Find the ADRs this issue is built to**, as `/feature` § 4 does, and read them the way it says:

  ```bash
  scripts/adr-issues.sh for $ARGUMENTS <parent>   # with no parent: scripts/adr-issues.sh for $ARGUMENTS
  ```

  "Is built to" is the issue's design; "is mentioned by" is a text search that also prints ADRs naming the bug in passing, which are not its design. Read each one's Status first: a Superseded ADR is followed to its replacement, and one narrowed by another is read with it. Code that does what no ADR and no issue asks is the bug, and the fix restores what was decided. When instead the **issue** and an **ADR** say different things, stop: neither outranks the other. Analyse it the way `/feature` § 4 lists (a real named case and what each side would show the person; what decides it, in the code, the linked issues, the ADR's alternatives, the vision or a read-only measurement; the traveller's, the product manager's and the engineer's judgement; one verdict with its confidence and the strongest argument against it). Then tell the user at once with both sentences quoted and that verdict, post the same as a comment on the issue, and wait for the decision. Then the side it names changes (the issue's body, or the ADR in this fix's pull request), with the decision and its reason recorded on the issue. Do not rewrite either to match the other without it; a missing `**Built to:**` line where the two agree is added without asking
- **Temporary — transition regime, removed by #2646 (`docs/tech/model-transition.md`).** When the bug is in the catalogue model (a table or column of `db/target/model.sql` or an old table it replaces, its schema, a writer or a reader), read the area's owners in `db/target/owners.json` and the area's slice issue (#2648 to #2653) before choosing a fix. A fix in an area not yet moved stays small: no new table, column, owner, format or trigger. A fix that needs one is not built in a vacuum: it is folded into the area's slice, with that slice's area review (DELETE, SIMPLIFY or KEEP for each construct) and owners, and built as part of it, or it is asked of the owner of queue #2458
- Search the codebase for the relevant code based on the issue description
- Read the files involved to understand the current behavior
- Identify the root cause of the bug
- Check related tests if they exist

### 5. Explain your findings

Before making any changes, briefly explain:
- What the bug is
- Where in the code it occurs (file:line references)
- What the root cause is
- What the fix will be

Ask the user to confirm before proceeding with the fix.

### 6. Implement the fix

- Make the minimal change needed to fix the bug
- Follow existing code patterns and the conventions in `docs/tech/development-guide.md`
- **Search for existing utilities** before writing new helper code — reuse shared code
- Do NOT refactor surrounding code or add unrelated improvements
- Update any relevant tests

### 7. Verify

Run the gates this change asks for — `npm run check` is the fast tier, and it
reads `scripts/gates.mjs` to decide which of them the diff touched (ADR-0062):

```bash
npm run check                  # the fast gates this change asks for
npm run gates -- run test      # the unit lanes it asks for
```

Fix any lint or type errors introduced by the change. A bug fix that is only a
test plus a one-line guard still runs both, because both read what it changed.

### 8. Update docs if needed

If the fix changes user-facing behavior:
- Update `docs/vision/vision.md`
- Update relevant `docs/tech/` files

### 9. Commit and summarize

Commit the fix following the conventions in `docs/tech/development-guide.md`:
- **Title + body** — every commit needs an imperative title and a body explaining what and why
- **Granular commits** — if the fix touches multiple layers, split into separate commits
- **Docs in dedicated commits** — documentation updates are separate from code commits

Then summarize what was done and suggest:
- **To create a PR**: run `/commit`, then `/pr-create` — it enforces the clean-history gate, includes `Fixes #$ARGUMENTS` in the description, and moves the issue to 👀 In review on the board

### 10. Babysit the PR

Once a PR exists, the work is not done until it is mergeable. Follow `/pr-create` § "Babysit the PR until it is mergeable": watch the checks, answer every review thread (reply, don't resolve), fold fixes into their owning commits via `/pr-changes-amend`, and rebase when main moves — until checks are green and reviews are addressed.

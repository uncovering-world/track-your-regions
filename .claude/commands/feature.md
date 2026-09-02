# Work on a Feature

Work on a feature or enhancement from a GitHub issue. Features require proper planning before implementation — this command reads the issue, explores the codebase, and produces a plan for approval.

## Arguments

$ARGUMENTS — required: GitHub issue number.

## Prerequisites

Before starting, read `docs/tech/development-guide.md` — it defines the project's code organization conventions, file size rules, reuse-first principle, commit format, and documentation requirements. All work must follow these rules.

## Instructions

### 1. Load the issue

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,comments
```

If the issue doesn't exist or isn't open, tell the user and stop.

Also glance at its type, fields and place in the hierarchy — Size calibrates how much planning the work deserves, AI fit says whether product/design calls should be expected mid-way (Pair) or the issue is specced end-to-end (Agent-ready), and the type says whether this is a thing to build at all:

```bash
gh api repos/uncovering-world/track-your-regions/issues/$ARGUMENTS/issue-field-values \
  --jq '.[] | "\(.issue_field_name): \(.single_select_option.name)"'
gh issue view $ARGUMENTS --json state,issueType,parent,subIssues,blockedBy,milestone
```

The fields live on the issue itself (`repo` scope), so this read never depends on the project. `state` is the open-issue gate from step 1 made checkable: stop unless it is `OPEN`. An **Epic** is an umbrella and is never worked on directly, and the first thing to do with one is to read its slice list and the ledger on it. The slice list is the Epic's checkbox list wherever the body keeps it — under **Requirements** when there is one, otherwise the section that holds it (#575 and #576 keep theirs under *Wishes*) — read whole, body and thread: where the Epic groups its items under headings, each group is one slice and carries whatever field the Epic states for it (#714: five stages over fourteen checkboxes → five slices, four of them with a Size and the fifth, *Community locations*, with an AI fit); where the items are flat, each item is one slice (#628: six); only a body with no list at all (#469 on 2026-09-02) takes the propose branch — 2–6 slices you propose and write into a Requirements section first. The ledger is the mark at the end of each slice's line — `→ #N` once its sub-issue exists (every number when several cover one slice: #237's location editing carries `→ #583 #762`; readers test for the arrow, not for one number), `→ merged into #N`, or `→ dropped: <reason>` — and it is written with one discipline, since an issue body has no partial edit: read the current body (`gh issue view N --json body -q .body`), append the mark to that slice's line, write the whole body back otherwise unchanged (`gh issue edit N --body-file <edited copy>`, or `--body-file -` from stdin), one rewrite per mark as each outcome happens — the counterpart of the `→ #N` marks `/issue-upload` § 5 keeps in its source file. Reconcile before anything else, because the ledger arrives after the sub-issues did (on 2026-09-02 no Epic carried a mark while eight held twenty sub-issues between them): read the Epic's sub-issues **whole, closed ones included** — their bodies, not their titles: `gh issue view <sub#> --json title,body,state` for each number `subIssues` lists, or one GraphQL pass over `subIssues(first: 100) { nodes { number title body state } }` (the connection refuses to answer without a bound, and 100 is GitHub's own cap on sub-issues per parent, so one page is the whole set) — a slice whose sub-issue already shipped is covered, not missing (#574 lists #570 and #571, both closed, in its own slice text) — match each against the slice list **by what it covers, never by title or count** (what makes #766 cover #587's first slice, the same branch and tables, is in #766's body), show the user the matches, and only then write `→ #N` on every slice a sub-issue covers, **skipping any sub-issue whose number is already anywhere in the list** (keyed on the number, never on the line, the same guard `/issue-create` § 4 and `/issue-upload` § 5 use when they file a slice: a later judgement may match #641 to a different slice than the run that marked it, and a second `→ #641` would retire a slice that issue does not cover) and appending to a mark the line already carries rather than being stopped by it (`→ #583` becomes `→ #583 #762` when #762 is matched to that slice later — a sub-issue added by hand on github.com, say — which is how the multi-number form arises) — when every sub-issue's number is already in the list the pass is skipped entirely, so a second run (a later session, a `/fix` hand-over) never rewrites the body or accretes `→ #583 #762 → #583 #762`; *open* is the right filter only for what to point the user at afterwards. Three live shapes: #237's "edit experience locations" is covered by #583 and #762 and its "edit content items" by #731; #587's first slice, *Land slice 1: disputed-territories schema + sync on main*, is covered by #766 (the same branch and tables) while its other six sub-issues are decisions spun out of the umbrella and match no slice — so one mark, not zero and not seven; #497's one sub-issue #264 (a component assigned to a country its object does not name) covers none of its eight heuristics, so nothing is marked and all eight remain to file. An unmatched sub-issue never gets a line appended by reconciliation — whether it was a new slice or a spin-off was the question its creator answered at filing (`/issue-create` § 3), and the list changes only on a person's say-so there. With every slice marked after that, tell the user and point at the open sub-issues. Otherwise — unmarked slices left, because a decomposition that stopped short is resumed from the first unmarked slice, never refused — the work *is* the decomposition. Say which reading you took before creating anything; a slice you merge or drop gets its `→ merged into #N` / `→ dropped: <reason>` mark on the Epic, so the reason outlives the session. Each slice is made the way `/issue-create` §§ 2–5 make one — the repo's body shape, `--type`, area labels, a proposed Priority / Size / Theme / AI fit confirmed by the user, `scripts/board.sh add` for the fields and the board — created with `--parent $ARGUMENTS`, with the Epic's milestone when it has one, and `--blocked-by` every open blocker the Epic carries (a sub-issue does not inherit its parent's dependencies, and #628 — blocked by the category decision #758 — must not mint unblocked slices), and its `→ #N` mark on the Epic's item written by that same `/issue-create` § 4 step right after each `gh issue create` — the one owner of that write; this branch never appends it a second time — never in a batch at the end, so an interrupted run leaves an accurate ledger. File the whole list in one run; stop after that, and let the user pick a slice — no branch, no code, from an Epic. For any other issue, an entry with `state == OPEN` in `blockedBy` means it is not ready: name the blocker and stop. Precedence, in one line: an Epic is decomposed (blocked or not, its slices carrying its blockers); everything else that is blocked stops. A `parent` means the work is one slice of a larger issue; read the parent's body too, since the shape of the whole decides the shape of the slice.

### 2. Understand the requirements

- Read the issue title, description, and **all comments** carefully — the thread is part of the issue, not decoration. A later comment can add a requirement, narrow the scope, or update the premise the body rests on; where the two disagree, the newest statement that names its evidence wins and the body is what went stale
- Extract specific requirements and acceptance criteria
- Note any subtasks or checkboxes in the issue body
- Identify which parts of the system are affected (frontend, backend, database, etc.)

### 3. Create a branch

```bash
git checkout main
git pull
git checkout -b feature/$ARGUMENTS-<short-slug>
```

Use a short slug derived from the issue title (e.g., `feature/200-dark-mode`).

Mark the issue as being worked on:

```bash
scripts/board.sh status $ARGUMENTS "In progress"
```

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself.

### 4. Enter plan mode

This is a feature — it requires proper planning. Enter plan mode to:

- **Read `docs/tech/development-guide.md`** to understand where new code should live and how to organize it
- **Read area-specific docs** based on what the feature touches:

  | Area | Read |
  |------|------|
  | Map rendering, tile layers, map interactions | `docs/tech/maplibre-patterns.md` |
  | Map UI (markers, hover, selection, context layers) | `docs/tech/experience-map-ui.md` |
  | Geometry, triggers, simplification, hull | `docs/tech/geometry-columns.md` |
  | Shared frontend components/utils | `docs/tech/shared-frontend-patterns.md` |
  | Experience system (sync, sources, assignment) | `docs/tech/experiences.md` |
  | Auth flows (JWT, OAuth, tokens, email) | `docs/tech/authentication.md` |
  | Security (new endpoints, input surfaces) | `docs/security/SECURITY.md` |

  Read **all** docs that apply — most features touch 2-3 areas. Skip only areas that are clearly irrelevant.

- **Check `docs/decisions/`** for existing ADRs that apply to this feature — mention them in the plan ("This follows ADR-0004")
- Explore the relevant parts of the codebase
- Understand existing patterns and architecture
- **Search for existing code to reuse** — check shared utilities, hooks, and components before planning new ones (see "Reuse Before You Create" in the development guide)
- Check `docs/tech/planning/` for any existing plans related to this feature
- Check `docs/vision/vision.md` for relevant user stories
- Check `frontend/src/components/shared/` for reusable components
- Design the implementation approach
- Identify files to create/modify — **flag any file that would exceed ~500 lines** and plan how to split it
- Consider edge cases and security implications
- **If the feature involves an architectural choice** (new library, schema pattern, API convention, or hard-to-reverse decision) — include a new ADR in the plan (see `CLAUDE.md` § Architecture Decision Records)

Present the plan to the user for approval before writing any code.

### 5. After plan approval — implement

Once the user approves the plan:

- Implement the feature following the approved plan
- Follow the code organization conventions in `docs/tech/development-guide.md`:
  - **Reuse first** — use existing utilities, hooks, and shared components
  - **Keep files small** — extract hooks/sub-components proactively if a file approaches ~500 lines
  - **Barrel exports** — if adding to a controller directory, update `index.ts`
  - **Co-locate** — keep extracted hooks/types near the component they serve
- Add proper input validation (Zod schemas for new endpoints)
- Add auth middleware where needed

### 6. Verify

Run the project checks:

```bash
npm run check
```

Fix any lint or type errors.

### 7. Update documentation

Features always require doc updates:

- **`docs/tech/`** — create or update technical documentation for the feature
- **`docs/vision/vision.md`** — update if the feature is user-facing
- **`docs/tech/planning/`** — if there was an existing plan, trim it to only remaining ideas
- **`docs/security/`** — update if the feature touches auth, new endpoints, or input surfaces
- **`docs/decisions/`** — if the plan included a new ADR, create the file and update the index

### 8. Commit and summarize

Commit the changes following the conventions in `docs/tech/development-guide.md`:
- **Granular commits** — split into multiple well-scoped commits (backend, frontend, docs separately)
- **Title + body** — every commit needs an imperative title and a body explaining what and why
- **Docs in dedicated commits** — documentation updates are separate from code commits

Then summarize what was built and suggest:
- **To create a PR**: run `/pr-create` — it fills the template, references the issue (`Closes #$ARGUMENTS`, or `Part of #$ARGUMENTS` if partial), enforces the clean-history gate, and moves every referenced issue to 👀 In review on the board
- **To continue work**: list any remaining items from the issue that weren't addressed

### 9. Babysit the PR

Once a PR exists, the work is not done until it is mergeable. Follow `/pr-create` § "Babysit the PR until it is mergeable": watch the checks, answer every review thread (reply, don't resolve), fold fixes into their owning commits via `/pr-changes-amend`, and rebase when main moves — until checks are green and reviews are addressed.

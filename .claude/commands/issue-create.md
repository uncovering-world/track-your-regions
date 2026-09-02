# Create GitHub Issue

Create a new GitHub issue from a text description. Determines the issue type (Bug / Feature / Task / Epic), drafts the body in the repo's shape, proposes area labels, fields and hierarchy, and places the issue on the board.

## Arguments

$ARGUMENTS — required: a description of the issue or feature request, in plain language.

## Instructions

### 1. Parse the description

Read the text in $ARGUMENTS. It may be informal, contain typos, or be brief — that's fine.

Determine the GitHub issue type:
- **Bug** if it describes something broken, wrong, or not working as expected
- **Feature** if it describes something new to build, add, or improve that a visitor, curator or admin can see
- **Task** for restructuring existing code without changing behavior (add the `refactoring` label), process and CI work, documentation, or a decision to take
- **Epic** only for an umbrella that will be decomposed into sub-issues and never worked on directly

### 2. Draft the issue

Create a well-structured GitHub issue from the description. The canonical structures are the issue forms in `.github/ISSUE_TEMPLATE/` — `bug-report.yml`, `feature-request.yml`, `task.yml` — and each form sets the type; follow their sections, not an ad-hoc shape. A refactoring is a Task and uses the Task form's sections. An **Epic** has no form of its own: it uses the Feature form's sections, its Requirements list the intended slices as checkbox items phrased as slice titles — each becomes a sub-issue when the Epic is decomposed, so an item is a piece of work with a name, not an acceptance criterion a single PR could tick — and it is created with `--type Epic`.

**Voice**: issues are read by any developer who may join the project. English only, neutral tone — never mention people by name, never quote chat messages (especially not untranslated ones); attribute decisions as "the product review" or "the maintainer". Ground claims in real data: name actual sites, museums, regions, files, and measured numbers from the live database — never `Foo`/`X` placeholders.

**Title**: one sentence stating the rule or the defect ("A refused museum does not keep the Iconic badge", "A parent region's geometry is never recomputed when a child's arrives"); the named real example opens the Description, never the title.

**Body**: Structure the body based on type:

For **bugs** (the sections of `.github/ISSUE_TEMPLATE/bug-report.yml` — use all of them):
```markdown
## Description
{Clear description of the bug, expanded from the user's text}

## Steps to Reproduce
{If the user mentioned steps, list them. Otherwise write "To be determined."}

## Expected Behavior
{What should happen}

## Actual Behavior
{What happens instead}

## Commit Version
{Commit or branch where the bug reproduces}

## Environment
{OS / browser, when relevant — or "any"}

## Additional Context
{Logs, screenshots, patterns — redacted first: no tokens, secrets,
credentials, or personal data; omit material that cannot be safely redacted}

## Possible Solution
{If a fix shape is already known}
```

For **features** (the sections of `.github/ISSUE_TEMPLATE/feature-request.yml`):
```markdown
## Description
{The product-first story: who hits this and why it matters, then the current state
in the code with real anchors — files, symbols, PRs, ADRs, measured numbers.}

## Requirements
{Specific, verifiable checkboxes — each one checkable from a Pull Request.}

- [ ] Requirement 1
- [ ] Requirement 2

## Additional Information
{Dependencies and sequencing (which issues first and why), related issues,
source docs, open product decisions, licence or security notes.}
```

For **tasks** — refactoring, process, CI, docs, a decision to take (the sections of `.github/ISSUE_TEMPLATE/task.yml`):
```markdown
## Description
{What should be restructured, measured or decided, and why — with real anchors:
files, symbols, PRs, ADRs, measured numbers}

## Requirements
{Specific, verifiable items — each checkable from a Pull Request or a written decision.}

- [ ] Item 1
- [ ] Item 2

## Additional Information
{Dependencies, related issues, source docs.}
```

**Labels**: area labels only — `front`, `back`, `deploy`, `python`, `security`, `documentation`, `process`, `refactoring`. The type carries what `bug` / `enhancement` used to; sub-issues carry what `eipc` did; the `Epic` type carries what `roadmap` did.

**Fields**: propose Priority (Urgent/High/Medium/Low), Size (Tiny/Small/Medium/Large/X-Large), Theme (product area), AI fit (`Agent-ready` / `Pair` / `Human-led`). They are org issue fields on the issue itself; `scripts/board.sh` sets them by the literal option words (Size: `Tiny`/`Small`/`Medium`/`Large`/`X-Large`, not single letters). Semantics live in the board README (`uncovering-world/projects/2`).

**Hierarchy**: say whether the issue is a slice of an open epic (then it is created as that epic's sub-issue), whether it cannot start before another issue closes (a blocked-by dependency), and whether it belongs to the open milestone. For a slice, read the Epic's body first — `gh issue view <epic#> --json body -q .body` — and say which of its listed slices the new issue covers, or that it covers none: then it is either a new slice of the Epic's own work (a checkbox item is appended to the Epic's list and marked) or a spin-off the umbrella produced (a bug, a decision — the list is left alone and no mark is written), and the user decides which at confirmation.

### 3. Show the draft to the user

Display the full issue (title, type, body, labels) **and the proposed fields and hierarchy** (Priority, Size, Theme, AI fit; parent, blockers, milestone — and, for a slice of an epic, which of the Epic's listed slices it covers — or, when it covers none, whether it is a new slice, appended to the Epic's list and marked, or a spin-off left off the list, which is the user's call to make here) and **ask for confirmation** before creating it: the Epic mark is terminal and lands on another issue's body, so that judgement is shown here, not made afterwards. The user may want to adjust the wording — or the fields, since they land on the shared board exactly as proposed.

### 4. Create the issue

After the user confirms:

```bash
gh issue create --title "<title>" --type "<Bug|Feature|Task|Epic>" --label "<area labels>" --body "<body>"
```

Use a HEREDOC for the body to handle multi-line content and special characters; add `--parent <epic#>`, `--milestone "<title>"` and `--blocked-by <n>` when the hierarchy calls for them — every blocker the draft named, comma-separated when there are several (`--blocked-by 758,759`). A slice filed with `--parent` also gets its ledger mark on the Epic right after the create and before `scripts/board.sh add`: append `→ #N` to the line of the listed slice it covers in the Epic's body the way `/feature` § 1 does (read the body, edit that line, write it back whole — and only when no line of the Epic's list already carries `→ #N` for that number — keyed on the number, not on the line, so a retry after a failed placement never doubles it wherever it lands); when it covers no listed slice, do what the user confirmed in § 3 — a new slice gets a checkbox item appended under the same list first and marked (or, when the Epic has no list at all, #469, a `## Requirements` section holding that one item), a spin-off (#696 under #237: a bug the umbrella produced, not a piece of its list) gets no line and no mark — never a line it does not cover, since a mark is terminal. This step is the one owner of that write — `/feature` § 1 delegates slice creation here and never appends the mark again. The Epic's own list then says the slice exists:

```bash
gh issue create --title "<title>" --type Feature --label "front,back" --parent 237 \
  --milestone "A catalogue worth travelling for" --body "$(cat <<'EOF'
<body content>
EOF
)"
```

### 5. Add to the board

Every new issue goes on the org board with its fields set:

```bash
scripts/board.sh add <number> "<priority>" "<size>" "<theme>" "<ai-fit>" Backlog
# e.g. scripts/board.sh add 631 High Large "UX & Frontend" Pair Backlog
```

Placement is best-effort and separable from the fields: `board.sh add` writes the four fields first (`repo` scope) and places the issue and sets Status second (`project` scope). When the board is unreadable it says so on stderr and exits 2 with the fields already set; on that exit, run `gh auth refresh -s project` and retry only `scripts/board.sh add` — never re-create the issue (the retry is idempotent) — or note the miss and continue: it must not block the work itself. Any other non-zero exit means the fields were **not** written — a value the org's fields do not have, or a token without `repo` / `read:org` — and refreshing `project` repairs nothing: read the message, fix the cause, rerun `add`, and report in § 6 only what was actually set. A miss that survives the turn is not lost: `/issues` reconciles the board against open issues and surfaces off-board ones.

### 6. Report

Show the created issue number, URL, the type and fields that were set, the parent / blockers / milestone if any, whether it was placed on the board (a `board.sh add` exit of 2 means the fields are set and the placement is not), and — for a slice of an epic — the Epic-body write: which slice line now carries `→ #N`, or that an item was appended and marked, or that the write failed and the Epic's list still lacks it. That last line is the only record of that write, since this command keeps no ledger: a placement miss is caught later by `/issues`, a missing mark on a listed slice by `/feature`'s reconcile pass, but a missing *new-slice* append by nothing else.

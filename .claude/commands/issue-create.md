# Create GitHub Issue

Create a new GitHub issue from a text description. Automatically determines whether it's a bug or a feature and applies appropriate labels.

## Arguments

$ARGUMENTS — required: a description of the issue or feature request, in plain language.

## Instructions

### 1. Parse the description

Read the text in $ARGUMENTS. It may be informal, contain typos, or be brief — that's fine.

Determine the type:
- **Bug** if it describes something broken, wrong, or not working as expected
- **Feature** if it describes something new to build, add, or improve
- **Refactoring** if it describes restructuring existing code without changing behavior

### 2. Draft the issue

Create a well-structured GitHub issue from the description. For bugs and features the canonical structures live in `.github/ISSUE_TEMPLATE/` — follow them, not an ad-hoc shape; refactoring has no repo template, so its Description/Scope shape below is this command's own convention.

**Voice**: issues are read by any developer who may join the project. English only, neutral tone — never mention people by name, never quote chat messages (especially not untranslated ones); attribute decisions as "the product review" or "the maintainer". Ground claims in real data: name actual sites, museums, regions, files, and measured numbers from the live database — never `Foo`/`X` placeholders.

**Title**: A clear, concise title (imperative form for features: "Add X", "Support Y"; descriptive for bugs: "X fails when Y", "Broken Z on page W")

**Body**: Structure the body based on type:

For **bugs** (full template: `.github/ISSUE_TEMPLATE/bug-report.md` — use all of it):
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

For **features** (full template: `.github/ISSUE_TEMPLATE/feature-request.md`):
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

For **refactoring**:
```markdown
## Description
{Clear description of what should be restructured and why}

## Scope
- [ ] Item 1
- [ ] Item 2
```

**Labels**: Pick from existing labels:
- Type: `bug`, `enhancement`, or `refactoring`
- Area (if obvious): `front`, `back`, `deploy`, `python`, `security`, `documentation`, `process`
- `roadmap` — only for long-horizon vision epics (a map of intent, not the next sprint)

**Board fields**: propose values for the org board — Priority (Urgent/High/Medium/Low), Size (Tiny/Small/Medium/Large/X-Large), Theme (product area), AI fit (`Agent-ready` / `Pair` / `Human-led`). Values passed to `scripts/board.sh` are the literal option words as shown on the board (Size: `Tiny`/`Small`/`Medium`/`Large`/`X-Large`, not single letters). Semantics live in the board README (`uncovering-world/projects/2`).

### 3. Show the draft to the user

Display the full issue (title, body, labels) **and the proposed board fields** (Priority, Size, Theme, AI fit) and **ask for confirmation** before creating it. The user may want to adjust the wording — or the fields, since they land on the shared board exactly as proposed.

### 4. Create the issue

After the user confirms:

```bash
gh issue create --title "<title>" --body "<body>" --label "<label1>,<label2>"
```

Use a HEREDOC for the body to handle multi-line content and special characters:

```bash
gh issue create --title "<title>" --label "<labels>" --body "$(cat <<'EOF'
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

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself. If board placement fails for an already-created issue, retry only `scripts/board.sh add` — never re-create the issue. A miss that survives the turn is not lost: `/issues` reconciles the board against open issues and surfaces off-board ones.

### 6. Report

Show the created issue number, URL, and the board fields that were set.

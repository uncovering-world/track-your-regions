# Sweep Local Documents

List what has drifted from `docs/README.md` § Where things live (ADR-0079): local plans whose work is over, local files no issue owns, stale drafts and session files, an inbox nobody emptied, and agent memory that holds project status. Propose one action per item, and act only on what the user confirms.

## Arguments

$ARGUMENTS — optional: a part to sweep (`plans`, `research`, `sessions`, `inbox`, `archive`, `memory`, `links`). Without one, sweep all of them.

## Instructions

### 1. Check that nothing local is published

```bash
git ls-files docs/local docs/tech/planning docs/inbox
```

Any output is a defect, not a sweep item: a file under a local path is tracked. Report it first and propose `git rm --cached` on a branch of its own. It is never folded into another change.

### 2. Read the local tree and the issues it names

```bash
find docs/local -type f -printf '%TY-%Tm-%Td %p\n' | sort
gh issue list --state all --limit 2000 --json number,state,title --jq '.[] | "\(.number) \(.state) \(.title)"'
```

The issue list is read once, with a limit above the repository's issue count (raise it if the count passes it), and every number below is looked up in it.

### 3. Classify

| Where | Item | Proposed action |
|---|---|---|
| `docs/local/plans/` | `<N>-*` whose issue is **closed** | Archive it, after filing as issues anything it holds that was not built. Read the plan against the merged PR first; never assume it was all built |
| `docs/local/plans/` | a file with **no issue number**, or a number that is not an issue | File the issue and rename the plan to its number, or move it to `research/` (a study) or `archive/` (dead) |
| `docs/local/plans/` | `<N>-*` whose issue is open but untouched for more than 60 days | Keep; name it, so the user sees a plan older than the work |
| `docs/local/research/` | a draft untouched for more than 60 days | Ask: publish it (finished, in English, to `docs/research/YYYY-MM-DD-slug.md`, cited by an issue or ADR), fold its conclusion into the issue that needs it, or archive it |
| `docs/local/sessions/` | a session file older than 7 days | Delete it. What it decided is in issues; what it planned and did not do is filed or dropped |
| `docs/local/inbox/` | any file | Run `/issue-upload` on it, or move it where it belongs; an empty file is deleted |
| `docs/local/archive/` | a file archived more than 90 days ago | Delete it (the user confirms; it is not in git, so this cannot be undone) |
| `docs/local/` | anything outside the five folders above | Move it into one of them |
| memory | an entry that records project status (what a slice shipped, a roadmap, "next steps", a design's progress), which git, the PRs and the issues already hold | Delete it, and drop its line from the memory index. Feedback, gotchas and references stay |
| links | `docs/tech/planning` and `docs/inbox`, the symlinks into `docs/local/` | Remove them once no session or command uses the old paths. `git grep -n "docs/tech/planning\|docs/inbox"` then finds only records plus the files that name the links themselves: `.gitignore`, `docs/README.md` § Where things live, and this file. Those three are edited in the same change that removes the links. § 1 keeps checking the old paths afterwards, since a file tracked there would still be a defect |

The memory directory is the agent's own, where it has one. For Claude Code it is `~/.claude/projects/<repository path>/memory/`, with its index `MEMORY.md`. An agent with no memory skips that row.

### 4. Present, then act

Show one table: the item, its age, the evidence (the issue's state, the last change), and the proposed action. Ask the user to confirm the whole table or to strike rows. Then:
- **Deletion** of a local file is permanent, because nothing under `docs/local/` is in git. Delete only rows the user confirmed.
- **Filing** goes through `/issue-create`, one issue per unbuilt piece, each named in the summary.
- **Publishing** a research draft is a branch and a pull request of its own (`/feature` on the issue that cites it), never a side effect of the sweep.

### 5. Summary

Report what was archived, deleted, filed (with issue numbers) and left in place, and anything from § 1.

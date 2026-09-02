# Upload Issues from File

Parse issues/features from a markdown file, create GitHub issues for each, and remove the uploaded items from the source file.

## Arguments

$ARGUMENTS — optional: path to the file. If not provided, show both known files and let the user pick:
- `docs/inbox/found-issues.md` — bugs and issues found during development
- `docs/inbox/new-features.md` — feature ideas and enhancement proposals

## Instructions

### 1. Read the source file

If $ARGUMENTS is provided, read that file. Otherwise, list both files and ask the user which one to process (or both).

Read the file contents.

### 2. Parse items

Items in these files follow this format:
- Numbered lines: `1. Description of the issue or feature`
- Some items may be struck through with `~~...~~` and/or marked **Done** — **skip these entirely**, with one carve-out: a struck-through item carrying an appended `→ #N` is this command's own ledger mark from an earlier interrupted run — do **not** re-create its issue, but do retry its board placement (§ 5) — and, for an item whose confirmed hierarchy called for an Epic mark (a listed slice it covers, or a new slice appended to the Epic's list; a spin-off calls for none), that mark, which sits between the file mark and the placement and may have been the step that failed — and, before both, the hierarchy, the labels and the type the table confirmed (`gh issue edit N --parent … --milestone … --add-blocked-by … --add-label … --remove-label …`, `scripts/board.sh type N <Type>`), which an adopted issue gets only after its file mark and which can therefore be the step that failed too. The retry applies *this* run's classification of the source line, not what an earlier run wrote (the file records neither): for a created item that is normally the same values its create wrote and a no-op, and a re-reading that drifts — a `Feature` re-read as `Task` — is caught on the § 4 retry line, which shows the proposal beside what the issue carries now and is what the user confirms, never by the retry itself — and let § 6 clean its line up. The mark is the same whether this command created the issue or adopted it (§ 4), and so is the retry: the Status it passes is the one the issue has on the board when § 3 reads it, or 📋 Backlog when it has none, so a rerun never resets a Status the issue already carries
- Items may be informal, contain typos, or be brief

Extract each non-done item as a separate issue to create.

### 3. Classify each item

For each item, determine:
- **Type**: the GitHub issue type — `Bug` (a defect against intended behaviour), `Feature` (a new or changed capability a visitor, curator or admin can see), `Task` (refactoring, process, docs, CI, a decision to take), or `Epic` only for an umbrella that will be decomposed into sub-issues and never worked on directly
- **Title**: A clear, concise title derived from the description — a sentence stating the rule, with the named example in the body
- **Body**: Expand the description into a proper issue body following the issue forms in `.github/ISSUE_TEMPLATE/` (features and tasks, refactoring included: Description / Requirements / Additional Information; bugs: the full bug form with Steps to Reproduce, Expected/Actual; an Epic: the Feature sections, with the intended slices under Requirements); `/issue-create` § 2 shows the shapes
- **Labels**: area labels only — `front`, `back`, `python`, `security`, `process`, `refactoring`, `deploy`, `documentation`; the type replaces `bug` / `enhancement`, sub-issues replace `eipc`, and the `Epic` type replaces `roadmap`
- **Fields**: proposed Priority, Size, Theme, and AI fit — org issue fields on the issue itself (semantics in the board README, `uncovering-world/projects/2`)
- **Hierarchy**: a parent issue when the item is one slice of an open epic — and, with a parent, read the Epic's body (`gh issue view <epic#> --json body -q .body`) and say which of its listed slices the item covers, or that it covers none and is therefore either a new slice (a checkbox item will be appended to the Epic's list and marked) or a spin-off the umbrella produced (the list is left alone, no mark) — the mark § 5 writes is terminal, so this is decided in the open; a blocker when it cannot start before another issue closes; the open milestone when it belongs to the next goal

- **Already filed?**: a create can succeed while the file mark fails, and a rerun re-drafts the title, so look each item up the way a rerun can reproduce — `gh issue list --state open --limit 500 --json number,title,createdAt` (a list, not the search index, which is eventually consistent), narrowed to issues created since the source file was last edited, compared by title exactly and by meaning (the same rule stated in other words), and for each candidate read what an adoption would overwrite or add — its type, parent, blockers, labels and milestone (`gh issue view N --json issueType,parent,blockedBy,labels,milestone`; every open issue carries a type, some already sit under an Epic, and a blocker added to a pickable issue takes it out of `/issues`' picks) and its four fields, which `gh issue view --json` does not expose — the `issueFieldValues(first: 10)` fragment of `/issues` § 1's repository query — since every open issue carries all four and the adoption rewrites them from the batch — and whether it is on the board and with which Status (the project query of `/issues` § 1). Nothing is adopted here: a candidate is shown at § 4, with that state, for the user to decide

Classify **resumed ledger items** (§ 2 carve-out) too — they need the same type, labels and four proposed fields, classified from the source line the way a new item is, since their § 5 retry re-applies the hierarchy, the labels and the type, rewrites those fields on the issue, places it on the board and, where the confirmed hierarchy called for an Epic mark, writes it; only issue creation is skipped for them. Every resumed item also gets the full read an adoption candidate gets in the bullet above, made now rather than remembered from an earlier run — the board state, and the issue's current type, parent, blockers, labels, milestone and four fields — because the retry writes every one of them: the Status it passes is the one the issue has, or 📋 Backlog when it has none; its `--remove-label` list is every area label on the issue that the table does not name; `scripts/board.sh type` replaces whatever type the issue has; `--parent` re-parents, and a re-reading of the source line that lands the item under a different Epic would put a second `→ #N` on that Epic's list while the first keeps its mark; and `board.sh add` rewrites the four fields. A resumed line cannot tell a created item from an adopted one whose hierarchy edit was the step that failed, so the two paths read the same state before the same writes, and § 4's retry line carries all of it in its `now:` suffix beside the proposal — a classification that drifted from what the issue carries is decided there by the user, not applied by the retry.

**Voice**: issues are read by any developer who may join. English only, neutral tone — no personal names, no quoted chat messages; attribute decisions as "the product review" or "the maintainer". Real examples from the live data over placeholders.

### 4. Present the batch for review

Show ALL items in a numbered table before creating anything:

```
## Items to upload from {filename}

| # | Type    | Title                              | Labels | Priority | Size   | Theme         | AI fit      | Parent / blockers / milestone |
|---|---------|------------------------------------|--------|----------|--------|---------------|-------------|-------------------------------|
| 1 | Feature | A curator can add a point to ...   | front  | High     | Medium | Curation      | Pair        | ↳ #237 covers slice 2 · M1    |
| 2 | Feature | A work a traveller goes to a ...   | back   | High     | Large  | Experiences   | Pair        | ⛔ #758 · M1                   |
| 3 | Bug     | A refused museum does not keep ... | back   | Medium   | Tiny   | Data & Sync   | Agent-ready | M1                            |

Skipped (done/struck-through): item 5
Retry: #641 (item 4) — Feature · front · High / Medium / Curation / Pair · ↳ #237 covers slice 2 · M1 · now: Feature · front · ↳ #237 · no blockers · M1 · High / Medium / Curation / Pair · not on the board · owed: placement
Retry: #798 (item 6) — Task · back · Low / Small / Curation / Pair · ↳ #237 new slice · M1 · now: Bug · back, process · no parent · no blockers · no milestone · Medium / Small / Curation / Pair · already on the board, 🏗 In progress · owed: type, labels (−process), parent, milestone, fields, Epic mark
Possibly already filed: item 3 ≈ #802 "A refused museum keeps the Iconic badge" (created 14 min ago; Bug · back · no parent · no blockers · no milestone · Urgent / Large / Data & Sync / Pair; not on the board) — adopt #802, or create?

Ready to create 3 issues?
```

A "possibly already filed" line is the user's call, never a silent adoption: adopting rewrites that issue's type, parent, labels, milestone and four fields from this batch, adds the blockers the table named (which takes a pickable issue out of `/issues`' picks and stops `/feature` and `/fix` on it), and may append a terminal `→ #N` to an Epic's list for it, so an unrelated issue that happens to share the wording must be refused here. The line carries what § 3 read and the adoption would overwrite or add to — the issue's current type, labels, parent, blockers, milestone and four fields — so a `Bug` about to be retyped `Task`, an `Urgent / Large` issue about to be demoted to the batch's `Medium / Tiny`, an issue already under another Epic whose mark would land on a second Epic's list (normally a refusal, not an adoption), or a pickable issue about to be blocked, is refused knowingly; and its board state — `not on the board`, or `on the board, 🏗 In progress` — because § 5 acts on it: an adopted issue is placed with the Status it has and gets 📋 Backlog only when it has none, so the confirmation shows which it is before an 🏗 In progress issue can be adopted. An adopted item leaves the "Ready to create N" count, joins the retry lines with the same hierarchy suffix, and is handled in § 5 as an adopted item.

The "Ready to create N issues?" count covers only genuinely new items. Resumed ledger items (struck through with `→ #N`, per § 2) get their own line — their issues already exist and are never re-created; only their hierarchy, labels and type, their board placement — and, where the confirmed hierarchy called for an Epic mark, that mark — are retried in § 5, so the retry line carries what a table row carries — the type, the labels, the four fields — and the same hierarchy suffix (its `owed:` list — what the retry will actually write — is read from the current state: every difference between the proposal and the `now:` read, the mark's absence from the Epic's list, the issue's absence from the board; never from which run wrote the line or whether it created or adopted the issue, since the file records neither — so an item whose hierarchy edit was the step that failed, already on the board and owing no mark, still gets a line that names what is outstanding): which slice the item covers, or that it is a new slice or a spin-off — and, in its `now:` suffix, everything § 3 read on the issue this run — type, labels, parent, blockers, milestone, four fields, board state — since the retry writes each of them: the Status it passes is the one the issue has, or 📋 Backlog when it has none, the labels it removes are the area labels on the issue that the row does not name, and a parent, milestone or fields that differ from the proposal are the user's to settle here before the retry rewrites them.

**Ask the user to confirm.** They may want to skip some items, adjust titles, change types — or correct the proposed fields and hierarchy: what this table shows is exactly what lands on the issues and the shared board, and a mis-proposed Priority reorders the backlog for everyone.

### 5. Create issues

After confirmation, create each issue one at a time:

```bash
gh issue create --title "<title>" --type Feature --label "front,back" --body "$(cat <<'EOF'
<body content>
EOF
)"
```

Add `--parent 237` when the item is a slice of an open epic, `--milestone "A catalogue worth travelling for"` when it belongs to the open milestone, and `--blocked-by 758` when it cannot start before another issue closes — every blocker the table named, comma-separated when there are several (`--blocked-by 758,759`) — each only when the review table said so.

Record each created issue's number **immediately** (before board placement) by marking the item in the source file right away — strike it through and append the created number (`~~…~~ → #641`) after each successful `gh issue create`, not in a batch at the end. A mid-batch failure then leaves an accurate ledger in the file itself, and a rerun continues from the first unmarked item instead of duplicating the created ones. The create and the file edit are still two operations, so the one gap left is a create that succeeded and a file edit that did not; § 3's lookup and § 4's "possibly already filed" line exist for that gap, and an item the user adopted there is not created — its source line is marked `→ #N` first, and then, because that issue was created by something else and carries none of what this batch confirmed, the confirmed hierarchy, labels and type are applied to it *before* any mark: `gh issue edit N --parent <epic#> --milestone "<title>" --add-blocked-by 758,759 --add-label "front,back"` as the table said — every blocker it named, comma-separated when there are several, the same rule as the create above, and the area labels the table's column shows, which the create passes as `--label`; `--add-label` unions, so every area label § 3 read on the issue that the table did not name goes in `--remove-label` in the same edit, leaving its area labels as the table said and any label outside the area set untouched — and `scripts/board.sh type N <Type>` (two writes that follow the file mark and can be the step that fails, which is why a resumed line re-applies them first — § 2); only then the Epic mark where the hierarchy called for one — a terminal mark must never point at an issue that is not the Epic's sub-issue — and then the same placement as a created item's, `scripts/board.sh add N "<priority>" "<size>" "<theme>" "<ai-fit>" "<status>"`, with one difference: the Status argument is the one § 3's lookup read on the board and § 4 showed on the line — `"In progress"` for an 🏗 In progress issue, so it is not reset — or `Backlog` when the issue has none, the usual case, since the gap this path covers is a run that stopped before placement. One command, so the four fields are resolved together before the first write (a value the org's fields lack leaves a pre-existing issue untouched rather than half-rewritten), the placement carries the exit contract below, and § 6's gate reads the same placement for an adopted issue as for a created one. The fieldless `add` is never used here: it would put the issue on the board with no Status at all, outside every listing.

Only then — **after** the source-file mark, so a failure in this network write is never the reason a created issue is missing from the file, and **before** `scripts/board.sh add` — a slice filed with `--parent` gets its ledger mark on the Epic: append `→ #N` to the line of the listed slice it covers in the Epic's body the way `/feature` § 1 does (read the body, edit that line, write it back whole — and only when no line of the Epic's list already carries `→ #N` for that number — keyed on the number, not on the line, because a resumed line is re-classified from scratch and a rerun may judge the item to cover a different slice than the run that marked it; the mark is done once the number is anywhere in the list, so the § 2 resume after a failed placement never doubles it); when it covers no listed slice, do what the § 4 table (or the retry line, for a resumed item) showed and the user confirmed — a new slice gets a checkbox item appended under the same list first and marked (or, when the Epic has no list at all, #469, a `## Requirements` section holding that one item), a spin-off (#696 under #237: a bug the umbrella produced, not a piece of its list) gets no line and no mark — never a line it does not cover, since a mark is terminal. The Epic's own list then says the slice exists and `/feature` never has to re-derive it.

Then put the issue on the org board with its proposed fields:

```bash
scripts/board.sh add <number> "<priority>" "<size>" "<theme>" "<ai-fit>" Backlog
```

Placement is best-effort and separable from the fields: `board.sh add` writes the four fields first (`repo` scope) and places the issue and sets Status second (`project` scope). When the board is unreadable it says so on stderr and exits 2 with the fields already set — judge placement by that exit status, not by the fields line. Exit 2 is the only status that means "retry the placement": run `gh auth refresh -s project` (or note the miss and continue — it must not block the work itself) and, on a rerun, retry `scripts/board.sh add` for the recorded numbers only — never re-create their issues (it rewrites the same field values and reuses an existing board item, so the retry is safe; the Status it passes is the one the issue has on the board when § 3 reads it, or `Backlog` when it has none, so a retry never resets a Status the issue already carries). Any other non-zero exit means the fields were **not** written — a value the org's fields do not have, or a token without `repo` / `read:org` — and refreshing `project` repairs nothing: read the message, fix the cause, and rerun `add` for that issue before treating it as placed.

Report each created issue's number and URL as you go.

### 6. Clean up the source file

After all issues are created successfully:
- **Remove** every struck-through line carrying a `→ #N` ledger mark whose hierarchy, **area** labels and type are on the issue as the table said (atomic with the create for a created item; separate writes after the file mark for an adopted one, and on a resumed line for both; a label outside the area set, and a parent, milestone or blocker the issue already carried that the table did not name, are left untouched by § 5 — `--add-blocked-by` unions, an omitted `--parent` or `--milestone` leaves the existing one standing — and are not part of this check: § 4 shows them so the adoption can be refused for them, and the check asks only that what the table named is on the issue), whose board placement has succeeded **and**, where the confirmed hierarchy called for an Epic mark, whose mark is on the Epic's list (a spin-off called for none) — whether the issue was created by this run, adopted, or resumed from an earlier one (delete those lines, mark and all); a line where a required write still failed keeps its mark for the next rerun, so a placement that succeeded cannot bury a mark — or a hierarchy edit — that did not
- **Keep** struck-through / done items that carry **no** `→ #N` mark (they're historical record; the mark alone decides — nothing in the file records which run wrote it)
- **Keep** any remaining items that were skipped by user choice
- Re-number the remaining items if needed to keep the list clean
- If the file becomes empty (or only has done items), leave the done items as a record

Use the Edit tool to modify the file — do NOT rewrite the entire file if only removing a few lines.

### 7. Summary

Report:
- How many issues were created (with numbers and URLs), and how many source items were adopted onto issues that already existed (with the numbers they were adopted onto)
- The writes made on issues this run did not create, the way `/issue-create` § 6 reports them: for every slice filed or adopted under an Epic, the Epic-body write — which slice line now carries `→ #N`, or that an item was appended and marked, or that a `## Requirements` section was created for it, or that the write failed and the line is kept for a rerun; and for every issue this run adopted or resumed — an issue an earlier run created is one this run did not — what the retry or adoption rewrote or added on it: type, parent, blockers, labels, milestone, the four fields, and the Status it was placed with. § 6 deletes the ledger line once these land, so this report is the one record of them after a clean run
- What was removed from the source file
- What remains in the file (if anything)

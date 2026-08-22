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
- Some items may be struck through with `~~...~~` and/or marked **Done** — **skip these entirely**, with one carve-out: a struck-through item carrying an appended `→ #N` is this command's own ledger mark from an earlier interrupted run — do **not** re-create its issue, but do retry its board placement (§ 5) and let § 6 clean its line up
- Items may be informal, contain typos, or be brief

Extract each non-done item as a separate issue to create.

### 3. Classify each item

For each item, determine:
- **Type**: bug, enhancement, or refactoring (based on the description)
- **Title**: A clear, concise title derived from the description
- **Body**: Expand the description into a proper issue body following `.github/ISSUE_TEMPLATE/` (features: Description / Requirements / Additional Information; bugs: the full bug template with Steps to Reproduce, Expected/Actual; refactoring has no repo template — use `/issue-create`'s Description / Scope convention)
- **Labels**: Pick appropriate labels (`bug`/`enhancement`/`refactoring` + area labels like `front`, `back`, `python`, `security`, `process`; `roadmap` only for long-horizon vision epics)
- **Board fields**: proposed Priority, Size, Theme, and AI fit for the org board (semantics in the board README, `uncovering-world/projects/2`)

Classify **resumed ledger items** (§ 2 carve-out) too — they need the same four proposed board fields, since their § 5 retry writes those fields to the shared board; only issue creation is skipped for them.

**Voice**: issues are read by any developer who may join. English only, neutral tone — no personal names, no quoted chat messages; attribute decisions as "the product review" or "the maintainer". Real examples from the live data over placeholders.

### 4. Present the batch for review

Show ALL items in a numbered table before creating anything:

```
## Items to upload from {filename}

| # | Type        | Title                              | Labels            | Priority | Size   | Theme    | AI fit |
|---|-------------|------------------------------------|-------------------|----------|--------|----------|--------|
| 1 | enhancement | Add full content curation for ...  | enhancement, front | High     | Medium | Curation | 🤝 Pair |
| 3 | enhancement | Sync navigation between Map and... | enhancement, front | Medium   | Small  | UX & Frontend | 🤖 Agent-ready |

Skipped (done/struck-through): items 2
Board placement to retry (created earlier): #641 (item 4) — High / Medium / Curation / 🤝 Pair

Ready to create 2 issues?
```

The "Ready to create N issues?" count covers only genuinely new items. Resumed ledger items (struck through with `→ #N`, per § 2) get their own line — their issues already exist and are never re-created; only their board placement is retried in § 5.

**Ask the user to confirm.** They may want to skip some items, adjust titles, change types — or correct the proposed board fields: what this table shows is exactly what lands on the shared board, and a mis-proposed Priority reorders the backlog for everyone.

### 5. Create issues

After confirmation, create each issue one at a time:

```bash
gh issue create --title "<title>" --label "<labels>" --body "$(cat <<'EOF'
<body content>
EOF
)"
```

Record each created issue's number **immediately** (before board placement) by marking the item in the source file right away — strike it through and append the created number (`~~…~~ → #641`) after each successful `gh issue create`, not in a batch at the end. A mid-batch failure then leaves an accurate ledger in the file itself, and a rerun continues from the first unmarked item instead of duplicating the created ones. Then put the issue on the org board with its proposed fields:

```bash
scripts/board.sh add <number> "<priority>" "<size>" "<theme>" "<ai-fit>" Backlog
```

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself. On a rerun after a partial failure, retry board placement for the recorded numbers only — never re-create their issues (`scripts/board.sh add` reuses an existing board item, so the retry is safe).

Report each created issue's number and URL as you go.

### 6. Clean up the source file

After all issues are created successfully:
- **Remove** every struck-through line carrying a `→ #N` ledger mark whose board placement has succeeded — whether the issue was created by this run or resumed from an earlier one (delete those lines, mark and all); a line whose board placement still failed keeps its mark for the next rerun
- **Keep** struck-through / done items that carry **no** `→ #N` mark (they're historical record; the mark alone decides — nothing in the file records which run wrote it)
- **Keep** any remaining items that were skipped by user choice
- Re-number the remaining items if needed to keep the list clean
- If the file becomes empty (or only has done items), leave the done items as a record

Use the Edit tool to modify the file — do NOT rewrite the entire file if only removing a few lines.

### 7. Summary

Report:
- How many issues were created (with numbers and URLs)
- What was removed from the source file
- What remains in the file (if anything)

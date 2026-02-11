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
- Some items may be struck through with `~~...~~` and/or marked **Done** — **skip these entirely**
- Items may be informal, contain typos, or be brief

Extract each non-done item as a separate issue to create.

### 3. Classify each item

For each item, determine:
- **Type**: bug, enhancement, or refactoring (based on the description)
- **Title**: A clear, concise title derived from the description
- **Body**: Expand the description into a proper issue body (see format below)
- **Labels**: Pick appropriate labels (`bug`/`enhancement`/`refactoring` + area labels like `front`, `back`, `API` if obvious)

Issue body format for **features**:
```markdown
## Description
{Expanded description}

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2
```

Issue body format for **bugs**:
```markdown
## Description
{Expanded description}

## Expected Behavior
{What should happen}

## Actual Behavior
{What happens instead}
```

### 4. Present the batch for review

Show ALL items in a numbered table before creating anything:

```
## Items to upload from {filename}

| # | Type        | Title                              | Labels              |
|---|-------------|------------------------------------|----------------------|
| 1 | enhancement | Add full content curation for ...  | enhancement, front   |
| 3 | enhancement | Sync navigation between Map and... | enhancement, front   |

Skipped (done/struck-through): items 2

Ready to create 2 issues?
```

**Ask the user to confirm.** They may want to skip some items, adjust titles, or change types.

### 5. Create issues

After confirmation, create each issue one at a time:

```bash
gh issue create --title "<title>" --label "<labels>" --body "$(cat <<'EOF'
<body content>
EOF
)"
```

Report each created issue's number and URL as you go.

### 6. Clean up the source file

After all issues are created successfully:
- **Remove** the uploaded items from the source file (delete those numbered lines)
- **Keep** struck-through / done items as-is (they're historical record)
- **Keep** any remaining items that were skipped by user choice
- Re-number the remaining items if needed to keep the list clean
- If the file becomes empty (or only has done items), leave the done items as a record

Use the Edit tool to modify the file — do NOT rewrite the entire file if only removing a few lines.

### 7. Summary

Report:
- How many issues were created (with numbers and URLs)
- What was removed from the source file
- What remains in the file (if anything)

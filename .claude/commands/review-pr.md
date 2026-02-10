# Review PR Comments (Quick)

Shortcut that runs the full PR review workflow: analyze, then ask what to do next.

## Arguments

$ARGUMENTS — optional: PR number. If not provided, auto-detect from current branch.

## Instructions

Run the `/pr-comments-analyze` workflow with the given arguments.

The full PR review workflow is three commands:
1. `/pr-comments-analyze` — Analyze comments and create categorized action plan
2. _(user makes code changes)_
3. `/pr-comments-reply` — Post replies to each comment explaining what was done
4. `/pr-changes-amend` — Fold fixes into original commits for clean history

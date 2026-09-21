# Reply to PR Comments

After code changes have been made to address PR review comments, post replies explaining what was done or why a suggestion was declined.

## Arguments

$ARGUMENTS — optional: PR number. If not provided, auto-detect from current branch.

## Prerequisites

Run `/pr-comments-analyze` first to produce the action plan. Code changes should already be committed.

## Instructions

### 1. Find the PR

- If a PR number was given in $ARGUMENTS, use that: `gh pr view <number> --json number,title,url,body,state`
- Otherwise, detect from the current branch: `gh pr view --json number,title,url,body,state`
- Extract the owner/repo from `gh repo view --json nameWithOwner`

### 2. Gather context

Collect the information needed to compose replies:

```bash
# Fetch all inline review comments (need their IDs for replying)
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

# See what changed since the PR was opened (or since the review)
git log --oneline main..HEAD
git diff main..HEAD --stat
```

### 3. Match comments to changes

For each review comment:
- **Check if the referenced code was modified** — use `git diff main..HEAD -- {file}` to see if the lines mentioned in the comment were changed
- **Categorize the response**:
  - **Fixed** — the code was changed to address the comment. Explain what was done
  - **Declined** — the suggestion was not adopted. Explain why with codebase-specific reasoning
  - **Acknowledged** — valid point tracked as tech debt or future work. Say so explicitly
  - **Already addressed** — was fixed before this round. Note which commit
- **Group related comments** — if multiple comments are about the same fix (e.g., 4 comments about CI permissions all fixed by one change), reply to the first one and reference it from the others

### 4. Compose replies

For each comment, write a concise reply:

- **Fixed items**: Lead with "Fixed — " and briefly describe the change. Include relevant technical detail (e.g., "added `&&` bounding-box pre-filter for GiST index usage")
- **Declined items**: Be polite and specific. Explain the codebase context that makes the suggestion unnecessary or incorrect. Acknowledge any valid sub-points even when declining the main suggestion
- **Acknowledged items**: "Valid point — tracking as tech debt. {Brief reason it's out of scope for this PR}."
- **Do NOT be defensive or dismissive** — every reply should show that the comment was carefully investigated
- **Keep replies concise** — 1-3 sentences is ideal. Longer only if the technical reasoning requires it

### 5. Present replies for approval

Show all planned replies in a table before posting:

```
| Comment ID | File | Category | Reply |
|-----------|------|----------|-------|
| {id} | {file}:{line} | Fixed | "Fixed — {reply text}" |
| {id} | {file}:{line} | Declined | "{reply text}" |
...
```

Ask the user to confirm before posting. The user may want to edit individual replies. One carve-out: inside `/pr-create` § "Babysit the PR until it is mergeable" this gate is waived — the loop posts replies anchored to verified fixes or stated reasons without waiting.

### 6. Post replies

Use the GitHub API to post each reply. For inline review comments, reply in the comment thread:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies -f body="..."
```

For PR-level or issue-style comments:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments -f body="..."
```

**Post one at a time** and report progress. If any post fails, report the error and continue with the rest.

Replies first, then the round: a reply alone brings no re-review, and neither does the push that carried the fixes (`claude-review.yml`, #796). Once every reply is posted and any fixes are pushed — a wave with no push, every finding declined with a reason, is a wave too — ask for the round as `/pr-create` § 8 "The next round" says: `gh pr comment <number> --body '/review'`, so the re-review reads the replies — the bot verifies each fix at the head, accepts a reasoned decline, and resolves its own threads it finds addressed or reasonably declined. On a PR labelled `review-on-push` a push already brought the round; `/review` there follows a reply-only wave only. Inside `/pr-create` § "Babysit the PR until it is mergeable" the loop posts it after the replies; outside it, remind the user.

### 7. Summary

After posting, show a summary: how many replies posted, any failures, and the PR URL.

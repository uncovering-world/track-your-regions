# Analyze PR Comments

Analyze review comments on a pull request and produce a categorized action plan.

## Arguments

$ARGUMENTS — optional: PR number. If not provided, auto-detect from current branch.

## Instructions

### 1. Find the PR

- If a PR number was given in $ARGUMENTS, use that: `gh pr view <number> --json number,title,url,body,state`
- Otherwise, detect from the current branch: `gh pr view --json number,title,url,body,state`
- If no PR exists for this branch, tell the user and stop

### 2. Fetch all comments

Gather every type of feedback on the PR:

```bash
# Review comments (inline code comments from reviewers)
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

# PR-level review bodies (the top-level text of each review: approved, changes requested, etc.)
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate

# Issue-style comments (conversation comments on the PR itself)
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
```

Extract the owner/repo from `gh repo view --json nameWithOwner`.

### 3. Analyze and categorize

For each comment or review (including comments from review bots):
- **Skip** CI status messages and auto-generated deployment notifications
- **Skip** comments that are purely praise/acknowledgment with no actionable request
- **Include** comments from review bots (e.g. code review bots, linting bots) — treat their suggestions like reviewer comments
- **Identify** the author and whether they are a human reviewer, bot, or the PR author
- **Categorize** each actionable comment:
  - **Must fix** — explicit change request from a reviewer, blocking approval
  - **Should fix** — reasonable suggestion that improves quality, not explicitly blocking
  - **Consider** — opinion, style preference, or optional idea
  - **Question** — reviewer asking for clarification (may need a reply, code change, or both)
  - **Disagree** — the reviewer's suggestion is based on a misunderstanding of the codebase context, project conventions, or requirements. The comment does not warrant a code change
  - **Already addressed** — if the comment thread is resolved or the code already changed
- **NEVER dismiss security bot comments** (e.g., CodeQL, github-advanced-security, Snyk, Dependabot) — always investigate them thoroughly. Even if the flagged line looks safe, trace the full data flow (function returns, exception messages, error handlers) to verify. Security findings that appear to be false positives often reveal real issues in adjacent code (e.g., exception messages leaking credentials, hardcoded defaults)

### 4. Map comments to code

For inline review comments:
- Note the exact file and line(s) referenced
- Read the relevant code to understand the current state
- Check if the comment has already been addressed in subsequent commits
- **Record each comment's `id`** (from the API response) — this is needed later by `/pr-comments-reply`

### 5. Verify consequences of proposed changes

Before recommending any code change, verify it won't break existing logic:
- **Read the actual code** surrounding each comment — don't rely solely on the reviewer's snippet
- **Check data types and schemas** — e.g., verify column types before suggesting spatial operator changes
- **Trace callers and consumers** — understand how the code being changed is used elsewhere
- **Consider the project vision** — read `docs/vision/vision.md` to understand user-facing impact
- **Test assumptions against reality** — if a reviewer claims X is better than Y, verify that X actually behaves differently from Y in our specific context (column types, data shapes, hierarchy depth, etc.)
- **For security findings** — trace the full data flow, not just the flagged line. Check exception handlers, error messages, and downstream logging for credential leaks
- **Mark as "Disagree"** only if thorough investigation confirms the suggestion is incorrect for our codebase. NEVER mark security findings as "Disagree" without reading every line in the data flow path

### 6. Create an action plan

Output a structured plan. **Include the comment `id` for every item** — the reply command needs it.

```
## PR #{number}: {title}
URL: {url}

### Summary
{Brief overview of the review feedback — who reviewed, overall sentiment}

### Action Items

#### Must Fix
1. **{Short description}** ({file}:{line}) — comment id: {id}
   - Reviewer: @{author}
   - Comment: "{abbreviated comment}"
   - Plan: {What to change and why}

#### Should Fix
...

#### Consider
...

#### Questions to Answer
...

#### Disagree — Draft Replies
For comments where the reviewer misunderstands the context, draft a polite reply explaining the rationale:

1. **{Short description}** ({file}:{line}) — comment id: {id}
   - Reviewer: @{author}
   - Comment: "{abbreviated comment}"
   - Why we disagree: {Explanation of the actual context, convention, or constraint}
   - Draft reply: "{A polite, concise reply to post on the PR explaining the position}"

#### Already Addressed
...

### Recommended Order
{Suggested sequence for tackling the items, grouping related changes}
```

### 7. Commit rules for fixes

When fixing issues from PR comments, **NEVER** create generic "address review comments" commits. Each commit must be a meaningful, topic-based change:
- Group fixes by topic (e.g., "Fix stale query keys after source→category rename", "Add body validation to markTreasureViewed route")
- If the fix is small and belongs to an existing commit's topic, **amend** to that commit instead of creating a new one
- Each commit message should describe **what** changed and **why**, not "address PR feedback"

### 8. Ask before proceeding

After presenting the plan, ask the user which items they want to address. Do NOT start making changes automatically. For "Disagree" items, confirm with the user before posting any replies.

# Triage Code Quality Alerts

Investigate, classify, and fix code quality alerts from GitHub's code scanning (/security/quality tab). These are non-security CodeQL findings: correctness bugs, maintainability issues, dead code, unused variables, performance problems, etc.

## Arguments

$ARGUMENTS — optional: specific rule ID (e.g. `js/useless-expression`) or alert number. If not provided, triage all open quality alerts.

## Instructions

### 1. Fetch open quality alerts

Extract owner/repo:
```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Fetch all open code scanning alerts, then filter to quality-only (no security severity):
```bash
gh api repos/{owner}/{repo}/code-scanning/alerts --paginate \
  --jq '.[] | select(.state == "open") | select(.rule.security_severity_level == null)'
```

If $ARGUMENTS is a number, fetch that specific alert:
```bash
gh api repos/{owner}/{repo}/code-scanning/alerts/{number}
```

If $ARGUMENTS is a rule ID (e.g. `js/useless-expression`), filter by that rule.

If there are no open quality alerts, tell the user and stop.

### 2. Group and summarize

Group alerts by rule ID. For each rule, show:
- Rule ID and description
- Severity level (error, warning, note)
- Tags (correctness, maintainability, etc.)
- Number of open alerts
- Affected files

Present a summary table to orient the triage.

### 3. Investigate each alert

For each rule (or the specific rule/alert from $ARGUMENTS):

#### a. Read the flagged code
- Use Read/Grep to examine the exact file and line
- Read surrounding context (at least 20 lines around)
- Understand what the code is trying to do

#### b. Understand the finding
- What does CodeQL think is wrong? (the `message` field explains)
- Is this a real bug, or does CodeQL misunderstand the intent?
- For correctness issues: does the code actually behave incorrectly?
- For maintainability issues: is the code genuinely confusing or is it acceptable?
- For unused code: is it truly dead code, or is it used dynamically / via reflection?

#### c. Assess impact
- Does this affect runtime behavior? (correctness bugs are higher priority)
- Could this cause subtle bugs under edge conditions?
- Is this in a hot path or rarely-executed code?
- Is the fix straightforward or would it require significant refactoring?

#### d. Classify each alert

| Classification | When to use | Action |
|---|---|---|
| **Real issue** | Genuine bug or significant code smell | Fix the code |
| **False positive** | CodeQL misunderstands the code pattern | Dismiss as `false_positive` |
| **Won't fix** | Real finding but low value to fix (e.g., acceptable complexity) | Dismiss as `won't_fix` |
| **Used in tests** | Only appears in test code and is intentional | Dismiss as `used_in_tests` |

### 4. Present the triage plan

For each alert or group:

```
### Rule: {rule_id} ({count} alerts)

**Severity:** {error|warning|note}
**Tags:** {correctness, maintainability, ...}
**Verdict:** {Real issue / False positive / Won't fix}

**Analysis:**
{What CodeQL found, why it flagged it, and whether the concern is valid}

**Alerts to dismiss:** #{n1}, #{n2}, ...
**Dismissal reason:** {false_positive | won't_fix | used_in_tests}
**Justification:** "{Comment explaining why this is acceptable}"

**Alerts requiring code fixes:**
- Alert #{n}: {file}:{line} — {what the bug is and how to fix it}
```

### 5. Ask before acting

Present the full triage plan and ask the user which actions to take:
- Which alerts to fix (with code changes)
- Which alerts to dismiss (with reasons)
- Which to skip for now

Do NOT dismiss or fix anything without user confirmation.

### 6. Execute approved actions

#### Fixing alerts:
- Make the code change
- Verify the fix addresses the CodeQL finding without changing behavior (unless the behavior was the bug)
- Run `npm run check` to verify lint + typecheck pass
- Do NOT commit automatically — let the user decide via `/commit`

#### Dismissing alerts:
```bash
gh api repos/{owner}/{repo}/code-scanning/alerts/{number} \
  -X PATCH \
  -f state=dismissed \
  -f dismissed_reason="{false_positive|won't_fix|used_in_tests}" \
  -f dismissed_comment="{justification}"
```

### 7. Report results

After all actions:
- Summary of fixed alerts (what changed)
- Summary of dismissed alerts (count by reason)
- Remaining open quality alerts (if any)
- Link to the quality dashboard: `https://github.com/{owner}/{repo}/security/quality`

### Commit rules

When fixing quality alerts, create descriptive topic-based commits (e.g., "Fix incomplete sanitization in image filename handling"), never generic "fix quality alerts" commits.

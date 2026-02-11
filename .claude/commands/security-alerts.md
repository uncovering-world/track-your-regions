# Triage Security Alerts

Investigate, classify, and resolve GitHub code scanning alerts (CodeQL and other SARIF-based scanners).

## Arguments

$ARGUMENTS — optional: specific rule ID (e.g. `js/missing-rate-limiting`) or alert number. If not provided, triage all open alerts.

## Instructions

### 1. Fetch open alerts

```bash
# All open alerts (or filtered by rule if $ARGUMENTS provides one)
gh api repos/{owner}/{repo}/code-scanning/alerts --paginate --jq '.[] | select(.state == "open") | ...'
```

Extract owner/repo from `gh repo view --json nameWithOwner`.

If $ARGUMENTS is a number, fetch that specific alert:
```bash
gh api repos/{owner}/{repo}/code-scanning/alerts/{number}
```

### 2. Group and summarize

Group alerts by rule ID. For each rule, show:
- Rule ID and description
- Severity level
- Number of open alerts
- Affected files

Present the summary table to orient the triage.

### 3. Investigate each alert category

For each rule (or the specific rule from $ARGUMENTS):

#### a. Read the flagged code
- Use Read/Grep to examine the exact file and line
- Read surrounding context (at least 20 lines around)

#### b. Trace the data flow
- For injection/sanitization alerts: trace user input from entry point to the flagged usage
- For auth alerts: check middleware chain, verify what protections exist upstream
- For rate limiting: check if rate limiting middleware is applied at router or app level
- For password/crypto alerts: verify the actual algorithm and parameters used

#### c. Check existing mitigations
- Is there middleware that already addresses this? (e.g., `requireAuth`, `requireAdmin`, `validate()`)
- Is the input already sanitized upstream?
- Is the flagged code unreachable from user input?

#### d. Classify each alert

| Classification | When to use | Action |
|---|---|---|
| **Real issue** | Genuine vulnerability with no mitigation | Fix the code |
| **False positive** | CodeQL misunderstands the code (e.g., bcrypt flagged as weak) | Dismiss as `false_positive` |
| **Won't fix** | Real finding but acceptable risk (e.g., admin-only route) | Dismiss as `won't_fix` |
| **Used in tests** | Only appears in test code | Dismiss as `used_in_tests` |

### 4. Present the triage plan

For each alert or group:

```
### Rule: {rule_id} ({count} alerts)

**Severity:** {severity}
**Verdict:** {Real issue / False positive / Won't fix}

**Analysis:**
{Explanation of investigation findings}

**Alerts to dismiss:** #{n1}, #{n2}, ...
**Dismissal reason:** {false_positive | won't_fix | used_in_tests}
**Justification:** "{Comment explaining why this is safe}"

**Alerts requiring code fixes:**
- Alert #{n}: {file}:{line} — {what needs to change}
```

### 5. Ask before acting

Present the full triage plan and ask the user which actions to take:
- Which alerts to dismiss (with reasons)
- Which alerts to fix (with code changes)
- Which to skip for now

Do NOT dismiss or fix anything without user confirmation.

### 6. Execute approved actions

#### Dismissing alerts:
```bash
gh api repos/{owner}/{repo}/code-scanning/alerts/{number} \
  -X PATCH \
  -f state=dismissed \
  -f dismissed_reason="{false_positive|won't_fix|used_in_tests}" \
  -f dismissed_comment="{justification}"
```

#### Fixing alerts:
- Make the code change
- Run `npm run check` to verify
- Do NOT commit automatically — let the user decide via `/commit`

### 7. Report results

After all actions:
- Summary of dismissed alerts (count by reason)
- Summary of fixed alerts
- Remaining open alerts (if any)
- Whether `docs/security/asvs-checklist.yaml` needs updating

### Commit rules

When fixing security alerts, create topic-based commits (e.g., "Add rate limiting to public API endpoints"), never generic "fix security alerts" commits.

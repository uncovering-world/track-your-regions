# Review Dependabot PRs & Alerts

Analyze open Dependabot PRs and/or Dependabot security alerts. Assess risk, recommend actions.

## Arguments

$ARGUMENTS — optional:
- `alerts` — triage Dependabot security alerts (vulnerability advisories) instead of PRs
- `alerts <number>` — triage a specific Dependabot alert by number
- `<PR number>` — review a specific Dependabot PR
- *(no argument)* — review all open Dependabot PRs

## Instructions

### Mode selection

If $ARGUMENTS starts with `alerts`, follow the **Alert Triage** workflow (Section A) below. Otherwise, follow the **PR Review** workflow (Section B).

---

## Section A: Alert Triage

Investigate, classify, and resolve Dependabot security alerts (vulnerable dependency advisories).

### A1. Fetch alerts

Extract owner/repo:
```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

If $ARGUMENTS is `alerts <number>`, fetch that specific alert:
```bash
gh api repos/{owner}/{repo}/dependabot/alerts/{number}
```

If $ARGUMENTS is just `alerts`, fetch all open alerts:
```bash
gh api repos/{owner}/{repo}/dependabot/alerts --paginate --jq '.[] | select(.state == "open")'
```

If there are no open alerts, tell the user and stop.

### A2. Group and summarize

Group alerts by package name and ecosystem. For each group, show:
- Package name and ecosystem (npm, pip, etc.)
- Advisory ID (GHSA) and any CVE IDs
- Severity level (critical, high, medium, low)
- Vulnerable version range
- Patched version (if available)
- Manifest file path (which `package.json` is affected)

Present a summary table to orient the triage.

### A3. Investigate each alert

For each alert (or the specific alert from $ARGUMENTS):

#### a. Check if a fix is available
- Is there a patched version?
- Is there already a Dependabot PR open for this? Check: `gh pr list --author "app/dependabot" --state open --json number,title`
- If a PR exists, mention it and suggest using the PR review workflow instead

#### b. Assess the vulnerability
- Read the advisory description and affected functionality
- What kind of vulnerability is it? (RCE, XSS, ReDoS, prototype pollution, path traversal, etc.)
- What's the attack vector? (network, local, requires auth, etc.)

#### c. Check how the package is used in our codebase

Search for imports/requires of the package:
```bash
# Use Grep tool to search for the package name in source files
```

Determine:
- Is it a **direct dependency** or **transitive dependency**?
- Is it a **runtime** dependency or **dev/build** only?
- How is it used? Does our usage touch the vulnerable code path?
- Is the vulnerable functionality reachable from user input?

#### d. Classify each alert

| Classification | When to use | Action |
|---|---|---|
| **Real risk** | Vulnerable code path is reachable in our usage | Update the dependency |
| **Low risk** | Vulnerability exists but our usage doesn't hit the vulnerable path | Update if easy, otherwise accept risk |
| **Dev-only** | Only in devDependencies, not in production | Update when convenient |
| **No fix available** | No patched version exists yet | Monitor, consider workarounds |

### A4. Present the triage plan

```
## Dependabot Alert Triage

### Critical / High — Fix Now
| Alert | Package | Severity | CVE | Vulnerable | Fix version | Our usage |
|-------|---------|----------|-----|------------|-------------|-----------|
| #N | pkg-name | critical | CVE-XXXX-XXXXX | <1.2.4 | 1.2.4 | Direct, runtime, reachable |

### Medium / Low — Plan to Fix
| Alert | Package | Severity | Advisory | Risk assessment |
|-------|---------|----------|----------|-----------------|
| #N | pkg-name | medium | GHSA-xxxx | Dev dependency, not reachable |

### No Fix Available
| Alert | Package | Severity | Advisory | Recommendation |
|-------|---------|----------|----------|----------------|
| #N | pkg-name | high | GHSA-xxxx | Monitor; workaround: {description} |

### Details for Critical/High Alerts

#### Alert #N: pkg-name (severity)
**Advisory:** {GHSA-xxxx} — {description}
**Vulnerable path:** {direct or transitive dependency chain}
**Our usage:** {how we use this package, whether vulnerable path is reachable}
**Fix:** Update to {version} — run `npm update pkg-name` in `{backend|frontend}/`
**Breaking changes (if major bump):** {any API changes to watch for}
```

### A5. Ask before acting

Present the full triage plan and ask the user which actions to take:
- Which alerts to fix by updating the dependency
- Which alerts to dismiss (with reasons)
- Which to monitor for now

Do NOT update or dismiss anything without user confirmation.

### A6. Execute approved actions

#### Updating dependencies:
```bash
cd {backend|frontend} && npm update {package-name}
# or for major bumps:
cd {backend|frontend} && npm install {package-name}@{version}
```

After updating:
- Run `npm run check` to verify nothing broke
- Do NOT commit automatically — let the user decide via `/commit`

#### Dismissing alerts:
```bash
gh api repos/{owner}/{repo}/dependabot/alerts/{number} \
  -X PATCH \
  -f state=dismissed \
  -f dismissed_reason="{fix_started|inaccurate|no_bandwidth|not_used|tolerable_risk}" \
  -f dismissed_comment="{justification}"
```

Valid dismissed_reason values: `fix_started`, `inaccurate`, `no_bandwidth`, `not_used`, `tolerable_risk`.

### A7. Report results

After all actions:
- Summary of updated packages
- Summary of dismissed alerts (count by reason)
- Remaining open alerts (if any)
- Whether `docs/security/asvs-checklist.yaml` needs updating

---

## Section B: PR Review

### 1. Find Dependabot PRs

If a PR number was given in $ARGUMENTS:
```bash
gh pr view <number> --json number,title,url,body,state,author
```
Verify the author is `dependabot[bot]` or `dependabot`. If not, tell the user this isn't a Dependabot PR and stop.

If no argument was given, list all open Dependabot PRs:
```bash
gh pr list --author "app/dependabot" --state open --json number,title,url,body,labels
```
If there are no open Dependabot PRs, tell the user and stop.

### 2. For each PR, gather context

For each Dependabot PR:

#### a. Read the PR details
```bash
gh pr view <number> --json number,title,url,body,labels,files
```

Extract from the PR body:
- **Package name** being updated
- **Version change** (from → to)
- **Whether it's a major, minor, or patch bump**
- **Release notes / changelog** included in the PR body

#### b. Check the diff
```bash
gh pr diff <number>
```

Look at what files changed (typically `package.json` and `package-lock.json`). Note if any other files changed — that's unusual for Dependabot and warrants attention.

#### c. Check how the package is used in the codebase

Search for imports/requires of the package:
```bash
# Use Grep tool to search for the package name in source files
```

Determine:
- Is it a **direct dependency** or **dev dependency**?
- Is it used in **backend**, **frontend**, or **both**?
- How heavily is it used? (imported in 1 file vs. many)
- Is it a **runtime** dependency (affects production) or **build/test** only?

#### d. Check for breaking changes

- Read the changelog/release notes in the PR body carefully
- For **major version bumps**: always flag as needing attention — check for breaking changes, deprecated APIs, dropped Node.js version support
- For **minor version bumps**: check for new peer dependency requirements or deprecation notices
- For **patch version bumps**: usually safe, but verify it's genuinely a patch (security fix, bug fix)
- Check if the update is a **security fix** (Dependabot labels or PR body will mention CVEs)

#### e. Check CI status
```bash
gh pr checks <number>
```

Note whether CI passes, fails, or is pending.

### 3. Deep-dive for concerning updates

For any PR with a major version bump, CI failure, or breaking changes listed in the changelog, do a **real impact analysis**:

#### a. Identify affected APIs

Read the breaking changes section of the changelog. For each breaking change, determine the specific API surface that changed (renamed functions, removed options, changed signatures, new required config, dropped Node version support, etc.).

#### b. Trace usage in our codebase

For each affected API, use Grep and Read to find every place in our code that uses it. Read the surrounding code to understand:
- Which specific function signatures, options, or patterns we rely on
- Whether our usage hits the breaking change or not (many "breaking" changes only affect edge cases we don't use)
- Whether any wrappers or abstractions insulate us from the change

#### c. Determine real impact

Classify the actual impact for our codebase:
- **No real impact** — We don't use any of the changed/removed APIs. The major bump is safe for us despite the breaking changes on paper.
- **Trivial fix** — We use an affected API but the migration is straightforward (rename, add an option, update a config key). Describe the exact changes needed, with file paths and line numbers.
- **Moderate effort** — Multiple files need updates or behavior changes need testing. List every file and what needs to change.
- **Significant rework** — Core patterns or architecture are affected. Explain what would need to be redesigned.

#### d. For CI failures

If CI fails on a Dependabot PR:
- Read the CI output: `gh pr checks <number> --json name,state,description`
- Determine if the failure is related to the dependency update or a flaky/unrelated test
- If related, identify the root cause and what code changes would fix it

### 4. Present the review

Output a structured review:

```
## Dependabot PR Review

### Safe to Merge
| PR | Package | Change | Why safe |
|----|---------|--------|----------|
| #N | pkg-name | 1.2.3 → 1.2.4 | Patch bump, dev dependency, CI passes |

### Likely Safe
| PR | Package | Change | Notes |
|----|---------|--------|-------|
| #N | pkg-name | 1.2.0 → 1.3.0 | Minor bump, no breaking changes in changelog, used in 2 files |

### Security Fixes (Merge ASAP)
| PR | Package | Change | CVE |
|----|---------|--------|-----|
| #N | pkg-name | 1.2.3 → 1.2.4 | CVE-XXXX-XXXXX |

### Needs Attention — Deep Dive
For each PR that needed deeper analysis:

#### PR #N: pkg-name 2.x → 3.x

**Breaking changes in changelog:**
- Change A: {description}
- Change B: {description}

**Impact on our codebase:**
- Change A: **No real impact** — we don't use {affected API}
- Change B: **Trivial fix** — `backend/src/services/foo.ts:42` calls `bar()` with old signature, needs to change to `bar(options)`

**CI status:** Passes / Fails (reason: ...)

**Verdict:** {Safe to merge as-is / Merge after applying fixes below / Hold off}

**Required code changes (if any):**
- `{file}:{line}` — change `{old}` to `{new}`
```

### 5. Recommend next steps

After the review:
- For "Safe to Merge", "Likely Safe", and "No real impact" PRs: ask if the user wants to merge them now
- For "Security Fixes": strongly recommend merging ASAP
- For PRs needing trivial fixes: offer to make the code changes and then merge
- For significant rework: outline the effort and let the user decide

If the user wants to merge:
```bash
gh pr merge <number> --rebase
```

Use `--rebase` for fast-forward merge (no merge commits). Merge one at a time and report success/failure for each.

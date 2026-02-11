# Review Dependabot PRs

Analyze open Dependabot PRs, assess risk of each dependency update, and recommend whether to merge or flag concerns.

## Arguments

$ARGUMENTS — optional: PR number for a specific Dependabot PR. If not provided, review all open Dependabot PRs.

## Instructions

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

# Post-Refactoring Check

Two questions about a refactoring branch: did a change that gave a rule a new owner delete the guard that owner made obsolete (`docs/tech/development-guide.md` § A migration deletes what its owner replaced), and does the development guide have rules preventing the patterns just refactored from recurring.

## Arguments

$ARGUMENTS — optional: description of what was refactored. If not provided, infer from the current branch's changes.

## Instructions

### 1. Identify what was refactored

If $ARGUMENTS describes the refactoring, use that. Otherwise, analyze the current branch:

```bash
git diff main --name-only
git log main..HEAD --oneline
```

Categorize the refactoring: shared component extraction, utility consolidation, pattern unification, file splitting, etc.

### 2. Did the branch give a rule a new owner?

A new owner is a shared package module, a route declaration, one writer module, a generated type, a trigger — anything that now states a rule some other code used to state on its own. If the branch established none, write "No new owner" and go to step 3.

If it did, walk the five kinds of guard the owner may have made obsolete, searching the tree at the branch head (not only the diff — the guard usually sits in a file the branch never touched):

| Kind | How to find it |
|------|----------------|
| Parity test that reads source | `grep -rln "readFileSync\|repoFile(" backend/src scripts --include='*.test.*'`, then keep the specs that compare one copy of the moved rule with another |
| Duplicated constant or type | grep the moved symbol's name (and its literal values) across `backend/src`, `frontend/src` and `packages/shared` — a second definition is a twin |
| Handwritten adapter or type | hand-kept types, mappers or bound tables that the new owner now generates or declares |
| Lint rule | `no-restricted-syntax` / `no-restricted-imports` entries in `backend/eslint.config.mjs` and `frontend/eslint.config.mjs` that police the old duplication |
| Reviewer cross-check | the pairs in `.github/workflows/claude-review.yml` § Phase 4 ("places this repo states the same thing twice") whose home just landed |

For each item found:
- **Deletable now** → delete it on this branch — with the owner's own change when that is still uncommitted (the refactoring workflow runs this check before `/commit`), or folded into the commit that introduced the owner with `/pr-changes-amend` when it is already committed (`/feature` § 8 runs it after) — and re-run the gate it belonged to so the deletion is proven harmless.
- **Blocked** → name the follow-up issue that owns the removal and the dependency that prevents it now (a consumer not yet migrated, a route still outside the registry). No issue yet → file it with `/issue-create` before reporting. "Later" without an issue and a dependency is not an answer.
- **Nothing found at all** → say so plainly and flag it to the user: a new owner that retires nothing is a new layer beside the old copies, which the guide rejects.

End the step with the paragraph the pull request's Description will carry:

```
Deleted with the new owner: `backend/src/db/curationLogActionLabels.test.ts` (compared the schema's CHECK list with the frontend's labels as text),
`frontend/src/utils/labelFold.ts` (the frontend's copy of the fold).
Kept until #793: the two Cache-Control lint rules — three admin routes still write the header inline.
```

### 3. Read the development guide

Read `docs/tech/development-guide.md` fully. Focus on:
- **Component Organization** → `shared/` directory listing (is the new component listed?)
- **Utility Modules** → table (is the new utility listed with accurate description?)
- **Shared UI Patterns** → table (is there a row showing when to use the new pattern and what NOT to do?)
- **Splitting Patterns** → if the refactoring was a file split, are the new files documented?

### 4. Check CLAUDE.md

Read `CLAUDE.md` sections:
- **Shared Components** — does it mention the new shared components/utilities?
- Other relevant sections — does the architectural narrative reflect the refactoring?

### 5. Identify gaps

For each extracted component, utility, or pattern, check:

| Check | Question |
|-------|----------|
| Listed? | Is the new file listed in the appropriate directory/table? |
| Described? | Is the description accurate and complete? |
| Prevention rule? | Is there a rule that says "use X instead of doing Y inline"? |
| Anti-pattern? | Is the old inline pattern documented as "don't do this"? |

### 6. Report findings

Output the supersession result from step 2 first, then a table:

```
## Superseded Guards

| Guard | Kind | Outcome |
|-------|------|---------|
| curationLogActionLabels.test.ts | Parity test that reads source | Deleted on this branch |
| Cache-Control lint rules | Lint rule | Kept until #793 — admin routes still write the header inline |

## Prevention Check Results

| Extracted | Listed in dev guide? | Has "use this" rule? | Has "don't do this" anti-pattern? | Action needed |
|-----------|---------------------|----------------------|-----------------------------------|---------------|
| LoadingSpinner | Yes (shared/) | Yes (Shared UI Patterns) | Yes | None |
| formatDuration | No | No | No | Add to utility table + Shared UI Patterns |
```

### 7. Fix gaps

For each gap found:
- Update the dev guide with the missing listing, rule, or anti-pattern
- Update CLAUDE.md if the shared components section needs updating
- Show the user each change made

### 8. Summary

Report:
- The new owner the branch established (or "none"), how many guards it retired on the branch, and each one kept with its follow-up issue
- How many items checked
- How many gaps found and fixed
- Any items that need manual review (e.g., rules that are hard to express in a table)

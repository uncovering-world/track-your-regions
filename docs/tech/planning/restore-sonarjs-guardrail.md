# Restore the SonarJS guardrail (multi-session refactor)

## Status — 2026-05-10

- **Branch**: `feature/restore-complexity-guardrails` (pushed to origin)
- **Commit so far**: `11342c8 chore: restore eslint-plugin-sonarjs (recommended config) for backend + frontend`
- **PR**: not opened yet (will be a **draft** until everything passes)
- **Predecessor**: PR #375 (cv-python parity + ASVS L2 audit) — merged 2026-05-10
- **Local venv**: `cv-python/.venv/` exists from the previous session and works with the venv-relative npm scripts (`.venv/bin/<tool>`); no setup needed beyond `npm run setup:py:dev` if you nuke it

## Why this exists

GitHub commit `b0fafee` (Apr 26 2026, "chore(pr40): gate fixes — undici dep, lint cleanup, knip ignores") removed an orphaned `// eslint-disable-next-line sonarjs/...` comment with the message "plugin not installed in backend". Investigation showed that `feat/icp-adaptive-alignment` and `wip/recovery-2026-03-11` had originally adopted `eslint-plugin-sonarjs` and refactored a lot of functions to satisfy `sonarjs/cognitive-complexity` etc. When that branch's cv-python pipeline was ported to main via PR-40, the *outcome* (refactored code) came along but the *plugin install* was deliberately dropped. So main has the cleaner code yet no lint rule preventing future regression. This branch restores the guardrail.

## What landed in commit `11342c8`

- `backend/package.json`, `frontend/package.json`: `eslint-plugin-sonarjs ^4.0.2` added (matches the source branch pin).
- `backend/eslint.config.mjs`, `frontend/eslint.config.mjs`: `import sonarjs` + `sonarjs.configs.recommended` in the flat config + two false-positive overrides (`sonarjs/pseudo-random` off, `sonarjs/no-clear-text-protocols` off) — verbatim cherry-pick from `feat/icp-adaptive-alignment`.
- `backend/package-lock.json`, `frontend/package-lock.json` regenerated.

After this commit, `npm run lint` (and therefore `npm run check`) fails with **~200 SonarJS findings** that need to be cleared before the PR can ship.

## User-confirmed decision

The user **explicitly chose "full recommended, refactor everything"** — match the source-branch posture exactly: zero rule overrides beyond `pseudo-random` and `no-clear-text-protocols`, fix every violation in code rather than calibrating thresholds or disabling rules. Acknowledged that this is multi-session work and the PR stays in draft until everything passes.

The user also vetoed cross-branch cherry-pick of refactored files (e.g. matcher.ts at 400 lines on `feat/icp-adaptive-alignment` vs 1043 lines on main) because the source branches diverged 7 months ago and helper imports differ; refactor must be written fresh against current main.

## Findings inventory (from the 11342c8 lint pass against main code)

### Backend (60 errors total)

| Rule | Count | Notes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 41 | Worst: 101 (`worldViewImport/matcher.ts`), then 83, 67, 62, 55, 51 |
| `sonarjs/slow-regex` | 6 | Real ReDoS audit candidates |
| `sonarjs/todo-tag` | 4 | TODO comments |
| `sonarjs/no-nested-conditional` | 3 | |
| `sonarjs/regex-complexity` | 2 | |
| `sonarjs/no-nested-template-literals` | 2 | |
| `sonarjs/no-unused-vars` | 1 | |
| `sonarjs/hashing` | 1 | Weak hash audit |

Cognitive-complexity hot files:
- `backend/src/services/worldViewImport/matcher.ts` — multiple violations including the worst
- `backend/src/services/worldViewImport/geoshapeCache.ts` — ~4 violations
- `backend/src/services/worldViewImport/pointMatcher.ts` — 2 violations
- `backend/src/controllers/admin/wvImportFlattenController.ts` — at least 1
- `backend/src/services/wikivoyageExtract/markerParser.ts` — at least 1

### Frontend (~145 errors total)

| Rule | Count | Notes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 62 | JSX ternary chains |
| `sonarjs/cognitive-complexity` | 26 | Max ~45 |
| `sonarjs/no-nested-functions` | 25 | React-hook callback-in-callback patterns |
| `sonarjs/slow-regex` | 9 | |
| `sonarjs/no-nested-template-literals` | 9 | |
| `sonarjs/todo-tag` | 3 | |
| `sonarjs/single-char-in-character-classes` | 2 | |
| `sonarjs/regex-complexity` | 2 | |
| `sonarjs/no-unenclosed-multiline-block` | 2 | |
| `sonarjs/prefer-single-boolean-return` | 1 | |
| `sonarjs/no-unused-vars` | 1 | |
| `sonarjs/no-redundant-jump` | 1 | |
| `sonarjs/no-redundant-assignments` | 1 | |
| `sonarjs/no-identical-functions` | 1 | |
| `sonarjs/no-all-duplicated-branches` | 1 | |

## Resume checklist (next session)

Pick up exactly here:

1. `git fetch origin && git checkout feature/restore-complexity-guardrails && git rebase main` — keep current with main.
2. `npm --prefix backend install && npm --prefix frontend install` — refresh dependencies if needed.
3. `npm run lint 2>&1 | tail -200` — re-confirm the finding count vs the table above; main may have shifted.
4. **Commit grouping plan** — split the refactor into focused commits, each independently reviewable per the dev-guide:
   - **Tiny-fix batch** (one commit per rule that has a handful of hits): `fix: remove unused vars`, `fix: collapse single-boolean returns`, `fix: remove redundant jump/assignments`, `fix: deduplicate identical functions`, `fix: simplify single-char character classes`, `fix: enclose multiline blocks`, `fix: flatten nested template literals`, `fix: clean TODO tags`. Each touches a few files; ~10 commits total.
   - **Regex audit batch** (`slow-regex` + `regex-complexity`, ~15 hits): one commit per file or one combined commit with detailed reason in the body. Some will be real ReDoS fixes, some will be inline `// eslint-disable-next-line sonarjs/slow-regex -- bounded char classes between literal anchors; no nested quantifiers` per the suppression policy in `docs/tech/development-guide.md`.
   - **Hashing audit** (1 hit): inspect the file/line, decide if `md5`/`sha1` is used for security or for a deduplication identifier; either upgrade to `sha256+` or suppress with `// eslint-disable-next-line sonarjs/hashing -- non-security identifier hash; collision risk acceptable per <reason>`.
   - **Backend cognitive-complexity refactor** (41 hits): one commit per file or per major function family. Reference `feat/icp-adaptive-alignment` for the original extraction style but write the helpers fresh against current main. The helper files (`aiMatcher.ts`, `dbSearchMatcher.ts`, `geocodeMatcher.ts`, `matcherUtils.ts`) already exist on main with substantial content but `matcher.ts` (1043 lines) was never wired to use them — extracting helpers + threading them through is the bulk of the work.
   - **Frontend nested-patterns refactor** (`no-nested-conditional` 62 + `no-nested-functions` 25): one commit per area (e.g. `ExperienceList`, `RegionMap`, `DiscoverPage`). Common patterns: extract sub-components for ternary chains; lift inner callbacks into named hooks.
   - **Frontend cognitive-complexity** (26 hits): one commit per file.
5. Per dev-guide and project memory, **amend fixes into focused commits as you go** (or use `--fixup` + `--autosquash`). Avoid an "address review feedback" lump commit later.
6. After each commit batch, run `npm run lint` to confirm the batch cleared its targeted rule(s) before moving on.
7. **When everything passes**: run the full pre-commit gate (`npm run check`, `npm run knip`, `TEST_REPORT_LOCAL=1 npm test` + `npm run test:py`, `/security-check`) and `npm run security:all` before pushing.
8. Mark the PR ready for review.

## Refactoring playbook (reference)

For each of the heaviest finding clusters, the typical extraction pattern that satisfies SonarJS:

- **`cognitive-complexity` on a long function** — split by responsibility into helper functions named after their phase. The thresholds care about cumulative branch nesting + control-flow depth, not raw length, so extracting a single named helper that absorbs a deep nested block usually drops complexity by 5–10 points.
- **`no-nested-conditional` in JSX** — lift the inner ternary into a `useMemo` or a named local variable; or extract a sub-component that owns the condition.
- **`no-nested-functions` in hooks** — promote the inner callback to a `useCallback` at the same scope; or extract a custom hook.
- **`no-nested-template-literals`** — one intermediate `const` per inner template; usually trivial.
- **`slow-regex`** — first check whether input is bounded (e.g. parsed from a fixed-format SPARQL response): if so, suppress with explicit reason; if input is user-controlled, anchor the regex and simplify alternations.

## Out of scope for this PR

- Adding Ruff `C90` / `PL` complexity rules for cv-python — separate, smaller follow-up. Was originally bundled into this PR's plan but split off because cv-python's CV code (`match.py` projection-search loops with 30+ branches) needs its own threshold calibration discussion.
- Configuring Sonar Cloud / running Sonar's own scanner — only the ESLint plugin is in scope here.
- Re-tightening other linter rules. Stay focused on `sonarjs/*`.

## Risks / things to watch

- **Refactor drift from feat/icp-adaptive-alignment**: that branch's helpers may import symbols or types that have since changed shape on main. Use it for *inspiration*, not direct copy.
- **Commit hygiene**: the dev-guide demands granular commits with clear reasons. Resist the temptation to bundle "miscellaneous SonarJS fixes" into one commit — reviewers can't follow the narrative that way.
- **Test coverage**: the existing Vitest suite covers some of the noisy modules. Run `TEST_REPORT_LOCAL=1 npm test` after each backend refactor batch to catch behaviour regressions early.
- **Suppression policy**: ANY new `// eslint-disable-next-line sonarjs/<rule> -- <reason>` must follow the rules in `docs/tech/development-guide.md` § Linter Suppressions (inline only, named rule, reason explaining what makes the spot safe). Not "avoiding refactor".

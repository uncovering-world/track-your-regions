# Plan — #481: add `p/default` to the Semgrep configuration

Local working document. Not committed (`docs/tech/planning/` is gitignored).

## Measured baseline (this branch, semgrep 1.171.0, pinned digest)

| Scope | Current config | With `p/default` |
|---|---|---|
| Node (whole repo) — rules run | 266 | **511** |
| Node — findings | 0 | **54** |
| Python (`cv-python`) — rules run | 199 | **330** |
| Python — findings | 0 | **0** |

The Python scope is free: `p/default` adds 131 rules and raises nothing. The
whole work is the Node scope's 54.

## Triage

### Fix — real, worth changing the code

| Finding | Site | Verdict |
|---|---|---|
| `missing-integrity` | `frontend/index.html:24` | **Real.** `maplibre-gl.css` is pulled from `unpkg.com` with no SRI. But the better fix is not SRI: `maplibre-gl@^4.7.0` is already a frontend dependency and two components already `import 'maplibre-gl/dist/maplibre-gl.css'`. The CDN tag is a redundant runtime dependency *and* a version-drift trap (hard-pinned `4.7.0` in HTML vs `^4.7.0` in `package.json`). Move the import to `main.tsx`, drop the tag. |
| `formatted-sql-query` ×2, `sqlalchemy-execute-raw-query` ×2 | `db/init-db.py:206`, `:257` | **Half real.** Not SQLAlchemy (false match on `.execute(`), and `cols` is a module constant — but `self.table_name` is read out of `sqlite_master` of a user-supplied GeoPackage and interpolated into the SQL as an identifier. Identifiers cannot be parameterized, so the fix is validation at the source: reject any table name that is not a plain identifier. Then suppress, citing the validation. |
| `unsafe-formatstring` ×16 | see below | **Real premise.** These are the sites where externally-sourced text (Wikivoyage page titles, Commons filenames, imported region names, a `req.params` Wikidata id, synced item ids, a cache file path) sits in the *format-string* position of a `console.*` call that also passes arguments. A `%s` in that text shifts the trailing argument into the message — CWE-134 as written. Fix by making the format string a constant and passing the value as an argument. |

`unsafe-formatstring` sites to fix (external text in format position):
`wvImportHierarchyController.ts:381` (`match.regionName`),
`wvImportLifecycleController.ts:65` (`wikidataId`, straight off `req.params`),
`syncOrchestrator.ts:103` (`config.getItemId(item)`),
`aiClassifier.ts:156` (`title`), `aiRegionParser.ts:195`, `:213` (`pageTitle`),
`treeBuilder.ts:439`, `:496` (`resolved`),
`geoshapeCache.ts:110` (`wikidataId`), `:225` (`commonsFile`),
`geoshapeComposite.ts:40`, `:124`, `:170` (`wikidataId`),
`pointMatcher.ts:174` (`pageTitle`),
`cache.ts:35`, `:82` (`this.filePath`).

### Suppress — false positive, with a stated reason

| Finding | Site | Why it cannot fire |
|---|---|---|
| `path-join-resolve-traversal` | `wikivoyageExtract/index.ts:50` | `f` comes from `readdirSync(CACHE_DIR)`, filtered by prefix and suffix — not request data. |
| `path-join-resolve-traversal` | `wikivoyageExtract/index.ts:66` | Inside `safeCachePath`, *after* it rejects `/`, `\`, `..` and enforces the `wikivoyage-cache*.json` shape, and followed by a `path.dirname(resolved) === CACHE_DIR` re-check. Semgrep does not follow the guard. |
| `path-join-resolve-traversal` | `__tests__/parser.test.ts:20` | Test fixture loader; names are literals in the test file. |
| `detect-non-literal-regexp` | `importTreeLinkify.tsx:73` | Rebuilds a `RegExp` from `regex.source` of a `RegExp` the parent already constructed — no new input. |
| `detect-non-literal-regexp` | `useImportTreeDialogs.ts:490` | Alternation of regex-escaped region-name literals. No nesting and no quantifier over a group, so no catastrophic backtracking; escaping already blocks regex injection. |
| `unsafe-formatstring` ×28 | remaining sites | Interpolated value is a `number` (`regionId`, `worldViewId`, `categoryId`, `group.id`, `div.id`, `batchNum`, …) or an internal constant (`config.logPrefix`, `round.label`, `escalationLevel`, `searchBadge`, `opId`). A format specifier cannot occur in either. |

Inline suppression — not `--exclude-rule` — is deliberate: it keeps the rule
live for code written after this branch.

## Steps

1. Fix `frontend/index.html` + `main.tsx` (drop CDN tag, import CSS from the package,
   remove the two now-duplicate component-level imports).
2. Validate the GeoPackage table identifier in `db/init-db.py`, suppress the two lines.
3. Fix the 16 external-text `unsafe-formatstring` sites.
4. Suppress the 28 provably-safe `unsafe-formatstring` sites + the 5 path/regexp ones.
5. Add `p/default` to `security:scan` and `security:py:semgrep`.
   Decide `p/react` / `p/nodejs` by measurement: drop only if their rule ids are a
   strict subset of what remains, not by assumption.
6. Re-run both scans → expect 0 findings, and confirm rule counts.
7. Plant `eval(userInput)` in `.ts` and `.js`, confirm the scan reports it and exits
   non-zero, then remove the probe.
8. Update `docs/security/SECURITY.md`: the ruleset actually in force, close the
   "ruleset is narrower than assumed" gap, record the accepted suppressions.
9. Gates → granular commits → PR (`Closes #481`) → address review until merge-ready.

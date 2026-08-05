# Matcher quality (#437 A+B) — design

**Status**: design agreed 2026-07-30, not started.
**Local working document — never committed** (see CLAUDE.md § Documentation Workflow).

## Goal

Raise automatch quality enough that a base-layer mirror world view is a usable
working surface for experience and curator work. The measured blocker: a depth-2
base-layer import resolves 2372 of 3831 regions, and because a parent's geometry
is the union of the children *that have geometry*, every unresolved country is a
hole rather than a coarser fallback — so 523 of 1547 experiences land nowhere,
clustered in exactly the unresolved countries (ES 48, FR 45, GB 31, RU 30, JP 25).

## Scope

#437 as filed mixes three concerns with different economics. This design covers
two of them; the third is now #455.

| | Concern | In scope |
|---|---|---|
| A | Consolidate the duplicated name-matching core; split `matcher.ts` | Yes |
| B | Parent disambiguation + recursive matching policy | Yes |
| C | Provider interface, capability negotiation, eager metadata | No — **#455** |

Non-goals: the Wikivoyage-bound refinement fetchers, the review UI, eager point
metadata, and anything touching `experiences` beyond re-running assignment.

## The central finding: B is one mechanism, not two

`matchCountryLevel` resolves a name through `gadm.gadmCountries` — a **global
index keyed on country names** — and returns *every* match (`tryMatchCountry`,
`matcher.ts:377`). Two consequences follow from that one design choice:

- Seven divisions are named "France" (the base layer shards countries with
  overseas territories across continents), so the lookup correctly refuses to
  guess and the region lands in `needs_review` — 51 countries, 507 regions.
- The index holds countries only, so the **root level is never matched at all**.
  The 6 continent nodes are not "containers with no division to match" — 8 root
  divisions exist and the tree is built from them. They go unmatched because the
  walk starts one level below and treats roots as containers.

Resolving each node **among the descendants of the division of its nearest
resolved ancestor**, recursively from the root, collapses all three failure
classes into one fix:

The "nearest resolved ancestor" wording is load-bearing, not caution. Measured on
the real Wikivoyage import (world view 2): 4301 regions, tree depth 0–7, and it
contains **grouping nodes** — "Benelux", "Southern Germany" — that correspond to
no single division. A descent restricted to the *direct* children of a resolved
parent stalls on such a node and strands its whole subtree, which is the
all-or-nothing disease again, just at every level instead of one. Resolving
against the nearest resolved ancestor's subtree instead makes an unresolvable
grouping node **transparent**: "Benelux" resolves to nothing, and Belgium is
still found among Europe's descendants.

For the base-layer mirror this degenerates to the clean 1:1 descent, since it has
no transparent nodes (depth is exactly 0/1/2 → 8/237/3586). One mechanism serves
both trees. It is also strictly stronger than falling back to the global index,
which would discard the very disambiguation the descent exists to provide.

| Failure class | Regions | Why the recursive descent closes it |
|---|---|---|
| Ambiguous countries | 507 | Europe resolves first; exactly one France sits under it |
| Children of unmatched country-level nodes | 572 | Australia at root level is just a node that resolves as a root division; its states then resolve among Australia's children — no "country level" special case |
| All-or-nothing drill-down | 166 | Each child descends independently; one failure strands one node, not a level |
| Continent nodes | 6 | Resolved as root divisions instead of skipped |

No new metadata is required, which is what #437 predicted.

### Policy gating (prevents a Wikivoyage regression by construction)

A strict recursive descent is **wrong for Wikivoyage**: a WV region may be a
group of divisions rather than one, so "resolve among the parent's children"
does not hold. `MatchingPolicy` is today `'country-based' | 'none'`
(`types.ts:17`) with a single branch at `index.ts:198`. It gains
`'hierarchical'`:

- base-layer imports request `'hierarchical'`
- Wikivoyage and file imports stay on `'country-based'` — untouched by default
- the benchmark compares cleanly: one tree, two policies

### `cleanWvName` is not applied under `'hierarchical'`

`cleanWvName` drops everything from the first `(` onward. On base-layer names —
which are division names verbatim — that is actively harmful, and the benchmark
already contains the evidence: the single "variant" match was **"Osh (city)" →
division "Osh"**.

That this is wrong needs no database lookup to establish. `buildBaseLayerTree`
sets each node's name from `administrative_divisions.name`, so a region named
"Osh (city)" exists *only because* a division of that exact name exists. Binding
it to a differently-named division is therefore necessarily a miss, and the
identically-named division it should have taken is left unclaimed. Stripping the
parenthetical turned an available exact match into a wrong one.

`cleanWvName` stays on the `'country-based'` path, where WV article titles
genuinely carry such disambiguators and GADM does not.

**Falsifiable prediction for the snapshot**: under `'hierarchical'`, the region
named "Osh (city)" binds to the division named "Osh (city)".

## A: what "no unintended change" means here

Six functions are duplicated between `matcher.ts` (1085 lines, private copies)
and `matcherUtils.ts` (363 lines, exported, imported only by
`matcherGrouping.ts`). Verified by byte comparison:

| Function | State | Decision |
|---|---|---|
| `normalizeName` | identical | keep one |
| `isPrefixMatch` | identical | keep one |
| `findBestAmongChildren` | differs in form, **not in semantics** — both walk exact → variant → prefix and both let only a later exact improve a found match | keep the typed `ScoredEntry` shape |
| `cleanWvName` | equivalent (regex vs `indexOf`+`slice`); the size difference was comments | keep the `indexOf` form, no lint suppression needed |
| `getNameVariants` | **semantically divergent**: `/\s+(Province\|State\|…)$/i` vs `lastIndexOf(' ')` + `Set` | keep the `Set` form (O(n), drops two `sonarjs` suppressions) **but** split on any whitespace run — the current form misses a tab or NBSP before the suffix, and NBSP occurs in GADM names |
| `loadGADMData` | differs in size (678 vs 790 chars), **semantics not yet compared** | diff during A1; merge to the superset only if the difference is additive, else keep the form the country path uses today and pin both with tests |

`matcher.ts` at 1085 lines is past the dev guide's thresholds (>800 → "split
now"), so consolidation pulls a split with it. Doing B inside a 1085-line file
with two copies of the function B builds on is the reason A comes first.

## Measurement: one artifact, two roles

A single count (2372/3831) is too coarse — two different defects can produce the
same total. Instead, snapshot the outcome per region:

```
region_id → (match_status, division_id from region_members)
```

sorted, 3831 lines for the mirror. Taken after `rematch`, before geometry.

**Acceptance rules differ by subject, because the truth is known for only one:**

### Measured baselines (dev DB, 2026-07-30)

| World view | Regions | Depth | With member | With geometry | `auto_matched` |
|---|---|---|---|---|---|
| 5 "Administrative" (`base_layer`) | 3831 | 0/1/2 → 8/237/3586 | 2372 (exactly 1:1) | 2534 | **2372 (62%)** |
| 2 "Wikivoyage Regions" (`wikivoyage`) | 4301 | 0–7, uneven | 251 (266 rows → 15 with >1) | **0** | **237 (5.5%)** |

The mirror confirms the documented figures exactly (2372 / 1251 / 157 / 51 =
3831). The Wikivoyage import is in far worse shape than "not ideal" suggests: the
matcher found 237 country-level nodes and almost nothing beneath them
(`children_matched` = 7), and geometry was never computed for it at all — so that
world view is currently unusable in full, not in part.

Two consequences for this design:

- **`'hierarchical'` is very likely a large win on Wikivoyage too**, so it gets
  measured there rather than assumed inapplicable. The original worry — a WV
  region may span several divisions — is real but is not what the current 237/4301
  is losing to; and only 15 regions currently hold more than one member.
- **Grouping-node transparency is mandatory, not optional.** A 7-level tree with
  grouping nodes is the case that makes the direct-children rule fail.

| Subject | Truth | Rule |
|---|---|---|
| Existing Wikivoyage import | unknown | diff need **not** be empty — the user has explicitly said a better automatch is preferred over a zero diff. Every changed line must be defensible as an improvement; any `auto_matched → no_candidates` transition is a regression and blocks |
| Base-layer mirror (to be created) | known — the tree is generated from the divisions | mechanical score against 3831; **target is 3831**, and any shortfall must be a named, explained residue rather than a tolerance |

The mirror's target is the full 3831, not 3831 minus the continents: the recursive
descent resolves root nodes as root divisions, so the 6 continent nodes stop
being an expected loss. Treating them as permanently unmatchable was an artifact
of the country-centric walk.

**What counts as an improvement on the Wikivoyage import**, stated operationally
so it is not a judgement call per line:

- `no_candidates → auto_matched` and `needs_review → auto_matched` — improvement,
  no justification needed
- `auto_matched → no_candidates` or `→ needs_review` — regression, blocks
- an existing `auto_matched` whose `division_id` **changes** — requires
  per-line justification: the new division must be the better answer, not merely
  a different one. This is the class that hides real damage, since the status
  column looks unchanged

The same script serves as A's regression review and B's scoreboard, and it also
takes the sting out of the 4-step iteration loop below.

## The iteration loop (and why order matters)

`rematchWorldView` is destructive: it `DELETE`s every `region_members` row and
all `region_match_suggestions` for the world view, resets `match_status`, and
clears `dismissed_coverage_ids`. It then runs `matchCountryLevel` and **stops** —
no geometry recompute, no experience re-placement.

```
change matcher → rematch → snapshot → geometry compute → assign-regions
                                                              ↓
                              hand-resolve residue ← curate
                              (never rematch after this — it wipes hand work)
```

Hand resolution comes last, and only with the three generic handlers
(`dbSearchSingleRegion`, `geocodeMatchRegion`, `aiMatchSingleRegion` — verified
free of `wikivoyage`/`source_url` references). The WV-bound tools are inert on a
mirror; that is #455.

## Slices

1. **A0 — snapshot script.** The stack is up and **both subjects already exist**
   (world views 2 and 5 — no mirror needs creating). Only the script and the two
   captured baselines are missing.
2. **A1 — consolidate the name core; split `matcher.ts`.** Review both diffs;
   improvements allowed, regressions block.
3. **B1 — `'hierarchical'` policy: recursive descent from the root**, resolving
   each node among its parent's resolved children, no all-or-nothing fallback,
   no `cleanWvName`.
4. **B2 — base-layer import requests `'hierarchical'`**; WV default unchanged.
5. **B3 — measure.** Mirror score, WV diff reviewed line by line, Osh prediction
   checked. Residue hand-resolved.

## Risks

- **`loadGADMData` semantics unknown.** If the two forms build different indexes,
  A1 is larger than it looks. Mitigation: diff it first in A1; if the difference
  is not additive, the merge decision is a design choice, not a mechanical one.
- **Recursive descent strands subtrees.** Closed by design rather than mitigated:
  resolution is against the nearest *resolved* ancestor's division subtree, so an
  unresolvable node is transparent instead of fatal. The rejected alternative —
  falling back to the global index — would strand nothing but would also discard
  the disambiguation that motivates the descent.
- **`loadGADMData` runs over ~392k divisions.** Extra indexes from a superset
  merge cost load time on every import; measure before and after.
- **Depth-2 mirror is 3831 regions and rendering all leaves is the other
  blocker.** Independent of this work, tracked separately — the map default
  (`RegionMapVT.tsx:85` → `all-leaf`) is a one-file change that should land
  before A0 so the result is inspectable at all.

## Out of scope

- #455 — source-agnostic refinement handlers with two-level capability
  negotiation ("source cannot" vs "region has none")
- #454 — `curationController.ts` split
- The map `all-leaf` default and the 4-step pipeline orchestration — the user's
  original task, resumed after this

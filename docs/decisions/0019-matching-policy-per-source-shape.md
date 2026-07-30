# ADR-0019: The matcher picks a policy from the shape of the source's tree

**Date:** 2026-07-30
**Status:** Accepted

---

## Context

ADR-0018 imported the administrative base layer as a mirror world view and
deliberately withheld the division each node was generated from, so the ordinary
matcher had to resolve it. That measured 2372 of 3831 regions (62%), and the
1251 unresolved ones decomposed into three matcher gaps plus one correct
refusal. The cost was not abstract: a parent's geometry is the union of the
children *that have geometry*, so an unresolved country is a hole in its
continent rather than a coarser fallback, and 523 of 1547 experiences landed
nowhere — clustered exactly in the unresolved countries.

The single matcher, `matchCountryLevel`, resolves a name through
`gadm.gadmCountries`: a **global index keyed on country names**, returning every
match. Two consequences follow from that one choice.

- The base layer shards countries with overseas territories across continents,
  so seven divisions are named "France". The lookup cannot choose and correctly
  refuses to guess — 51 countries, 507 regions, all scoring 700.
- The index holds countries only, so the **root level is never matched at all**.
  The six continent nodes were recorded as "container nodes with no division to
  match", but eight root divisions exist and the tree is generated from them.
  They went unmatched because the walk starts one level below.

Two further gaps had the same root: children of a country-level node the walk
never recognised as a country were skipped with it (572 regions, 547 of them
Australia's states), and `trySubdivisionDrillDown` abandoned a country's entire
subdivision level when any one child failed (166 regions, 9 countries).

## Decision

Make the matcher a set of interchangeable **policies over one shared core**, and
choose the policy from the shape of the source's tree rather than fixing one
algorithm.

`MatchingPolicy` gains `hierarchical`, which descends the import tree alongside
the division hierarchy, resolving each node among the divisions beneath **the
division its nearest resolved ancestor matched**. `country-based` remains the
default and stays untouched. `defaultMatchingPolicy(sourceType)` maps a source
type to its policy in one place: `base_layer` → `hierarchical`, everything else
→ `country-based`.

Two properties of the descent are load-bearing.

**Ancestor context disambiguates.** Exactly one France sits under a resolved
Europe, so the seven-way ambiguity a global index cannot resolve does not arise.

**Unresolvable nodes are transparent, not fatal.** Resolution is against the
nearest *resolved* ancestor, not the immediate parent. A Wikivoyage tree carries
grouping nodes — "Benelux", "Southern Germany" — matching no single division;
anchoring on a resolved parent's direct children would strand each such subtree,
reintroducing the all-or-nothing failure one level down. Benelux resolves to
nothing and Belgium is still found among Europe's descendants.

Within a sibling group, exact matches bind before fuzzy ones and a division is
claimed once. Without that ordering a prefix match could take the division a
later sibling matches exactly — "Osh" and "Osh (city)" are each other's prefix
match, and only one assignment of the two is right.

The widened pool is walked breadth-first. The reason is narrower than it first
appears and worth recording so it is not "fixed" back: a node's children enter
the pool when that node is expanded, so every direct child of the anchor precedes
anything deeper under a stack as much as under a queue. What a stack inverts is
the order *among* deeper candidates — it expands the anchor's last child first —
so a depth-3 namesake reached through a later branch can outrank a depth-2 one.
That is the only observable difference, and it is what the regression test
constructs; a namesake nested under a direct child cannot distinguish the two.

The parenthetical strip (`cleanWvName`) is **off** under `hierarchical`. A
base-layer node named "Osh (city)" exists only because a division of that exact
name exists, so stripping it turns an available exact match into a wrong one.
Under `country-based` it stays on, where Wikivoyage titles carry parentheses as
article disambiguators and GADM does not.

### Measured outcome

Every region of the mirror, verified structurally rather than by count:

| | Before | After |
|---|---|---|
| `auto_matched` | 2372 (62%) | **3831 (100%)** |
| `no_candidates` | 1251 | 0 |
| `children_matched` | 157 | 0 |
| `needs_review` | 51 | 0 |

The mirror admits a proof no other source allows, since the correct answer was
withheld from the importer and is recoverable from the data: for all 3831
regions the bound division's name equals the region's name, and — the stronger
check — 8 roots bind to root divisions while 3823 non-roots bind to a division
whose parent is exactly the division bound to their parent region. Zero
exceptions in either.

Two regions that were previously `auto_matched` changed binding, and both were
corrections:

- "Osh (city)" moved from division "Osh" (the province) to "Osh (city)" — the one
  "variant" match in ADR-0018's measurement, which that ADR read as evidence the
  matcher resolved rather than was told. It was, and it resolved wrongly.
- Root region "Antarctica" moved from a child division "Antarctica" to the root
  division of that name. GADM self-nests the continent, and the old walk bound
  the root region one level too deep.

`country-based` is unchanged, proven rather than assumed: a fresh run of the old
code and a fresh run of the new one over the same Wikivoyage import (4301
regions) produce **byte-identical** per-region outcomes.

## Alternatives considered

**Carry the division id into the base-layer tree.** One flag, 100% by
construction, no matcher work. Rejected: it retires the only benchmark where
matcher accuracy is measurable against a known answer, and every non-mirror
source keeps the gap. The withholding in ADR-0018 was what made this ADR's
numbers possible.

**Fall back to the global index when a node fails.** Strands nothing, but
discards the ancestor context that disambiguation depends on — it would
reintroduce the seven Frances.

**Make `hierarchical` the default for every source.** Measured on the Wikivoyage
import: 1072 of 4301 resolved versus 242 for `country-based`, a 4.4× improvement,
and the feared failure did not occur — genuine grouping regions ("Saharan Chad",
"Greater Luanda") were left for review rather than confidently bound to one of
their several divisions, because their names match no single division. Not
adopted here regardless: it moves 3148 regions into a review queue and costs
128s against 8.7s, which is a product decision about review load rather than a
technical one. Recorded so it can be taken deliberately.

## Consequences

- One core, one copy. Six name-matching helpers existed twice — in `matcher.ts`
  and `matcherUtils.ts` — and four had drifted; `getNameVariants` differed
  semantically in how it split off a suffix. `matcher.ts` is now a 21-line policy
  barrel over `matcherCountryPolicy`, `matcherHierarchicalPolicy`,
  `matcherLeafPolicy` and the shared `matcherUtils`, each within the dev guide's
  size target. A dead second copy of `matchChildrenAsCountries` and its
  transitive helpers went with it.
- Re-match runs the world view's policy instead of always the country matcher,
  so it reproduces the import rather than silently switching algorithms. An
  explicit `matchingPolicy` in the request body overrides it, which is how one
  tree gets scored under two policies.
- The descent is O(nodes × candidates) when it widens to an ancestor's whole
  subtree. 21.7s for the mirror's 3831 nodes, 128.7s for Wikivoyage's 4301 —
  acceptable for an import, and the reason the widening only runs for nodes that
  found nothing among direct children.
- `scripts/match-snapshot.sh` makes the per-region outcome diffable, which is
  what turns "the count went up" into a reviewable change. It is the artifact
  both halves of this work were judged on.

## Related

- ADR-0018 — the mirror, and the withholding that made this measurable
- #437 — the umbrella issue; its provider/capability half is now #455

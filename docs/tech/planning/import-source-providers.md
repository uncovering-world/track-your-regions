# Import Source Providers — making the pipeline source-agnostic end to end

> **Status:** Idea, agreed 2026-07-28. Not implemented, not scheduled.
> Tracked as [#437](https://github.com/uncovering-world/track-your-regions/issues/437). Grew out of
> the base-layer import branch (`feat/base-layer-world-view-and-visibility`), which
> made the *import* stage source-agnostic and thereby exposed that the two stages
> after it are not.

## The pipeline, as it actually is

```
importer  →  intermediate representation (metadata)  →  automatching  →  manual refinement
```

The base-layer branch established the first arrow properly: `importTree` takes a
tree of names and hierarchy from any source, and `region_import_state` is the
intermediate representation. What it also proved is that the last two stages are
still written against one source.

## What is wrong today

**Automatching reads one field.** `matchCountryLevel` uses `regions.name` and
`parent_region_id` and nothing else. Every other signal in the intermediate
representation — `source_external_id`, `marker_points`, `region_map_url`,
`geo_available` — is invisible to it. Measured consequence: a depth-2 base-layer
import resolved 62% of 3831 regions, and the 1251 unresolved ones carry zero
suggestions.

**Manual refinement fetches from Wikivoyage at runtime, in six places:**

| Module | What it fetches |
|---|---|
| `controllers/admin/wvImportAIController.ts` | article wikitext, for AI child review |
| `services/worldViewImport/pointMatcher.ts` | article wikitext, then Wikidata P625 for coordinates |
| `services/worldViewImport/geoshapeComposite.ts` | Wikivoyage API + Wikidata |
| `controllers/admin/wvImportMapshapeController.ts` | Wikivoyage API (mapshape) |
| `controllers/admin/wvImportMatchHelpers.ts` | Wikivoyage API |
| `services/worldViewImport/geoshapeCache.ts` | Wikidata geoshape |

Each derives its target the same way — take `region_import_state.source_url`, strip
`https://en.wikivoyage.org/wiki/`, fetch. So the *handle* is already generic
metadata; only the *resolution* of that handle is hardcoded.

**The observable failure.** For a world view whose source is not Wikivoyage — the
base-layer mirror created by that branch — every one of those six tools is inert.
`findRegionPoints` receives an empty page title, fetches nothing, and returns no
points. The review UI still offers the buttons. Nothing tells the admin the tool
does not apply to this source; it simply produces no result.

**The shared name-matching core is duplicated and divergent.**
`services/worldViewImport/matcher.ts` holds private copies of `normalizeName`,
`getNameVariants`, `isPrefixMatch`, `cleanWvName`, `findBestAmongChildren` and
`loadGADMData`; `matcherUtils.ts` exports the same names, imported only by
`matcherGrouping.ts`. They have drifted — `getNameVariants` strips suffixes with a
regex in one and with a last-word set lookup in the other. Any matcher work has to
consolidate these first, or it lands in one of two live implementations.

## The idea

Two kinds of source-specific data, with different economics, and therefore
different mechanisms.

**Eager metadata — populated at import, stored in the intermediate
representation.** Cheap for the source to produce in bulk, and needed by
automatching, which runs over the whole tree at once. Each importer implements the
population for its own source. This is where identity handles live
(`source_url`, `source_external_id`) along with any signal the source gets for
free — the base layer, for instance, already has an anchor point per division.

**Lazy providers — resolved on demand during manual refinement.** Expensive,
per-region, and only ever needed for the one region an admin is looking at. Forcing
these into eager metadata would mean fetching wikitext, geoshapes, mapshapes and
marker coordinates for every one of ~4500 Wikivoyage regions at import time, to
store data almost none of which is ever read. That is the trap this design avoids.

The seam between them is the handle: eager metadata carries enough to *find* the
region in its source; lazy providers use it to fetch detail when a human asks.

### Shape

A provider interface resolved from `world_views.source_type`, with capabilities a
source may or may not implement:

- `getPoints(region)` — points belonging to the region. Wikivoyage parses article
  markers; the base layer returns the division's anchor point; a source with
  neither returns nothing.
- `getGeoshape(region)` — a boundary to score against candidates.
- `getMapImage(region)` — reference imagery for the preview dialog.
- `getChildSuggestions(region)` — what the source says this region contains.
- `getSourceText(region)` — raw source material for the AI tools.

Automatching and the refinement tools call the provider, never a source directly.
The six modules above become the Wikivoyage implementation of it.

**Capability negotiation matters as much as the interface.** The review UI should
offer only the tools the world view's source can serve, instead of showing every
button and silently doing nothing — which is today's behaviour for a non-Wikivoyage
source.

### What this unlocks

- A matching policy can consume points, geoshapes or child lists without knowing
  where they came from. The point-matching logic that already exists —
  `collectPointDivisions`, `buildCoveringSet`, `detectScopeConflicts`,
  `walkScopeAncestors`, `persistPointSuggestions` — is source-agnostic today and
  only its input is not.
- Wikivoyage stops re-fetching the same article on every tool invocation; a
  provider can cache per import run.
- A new hierarchy source implements whichever capabilities it can and immediately
  gets every tool that depends on them.

## Related follow-up work, in dependency order

1. **Consolidate the two name-matching cores.** Prerequisite for anything else;
   decide which `getNameVariants` is correct, since the answer already affects
   Wikivoyage today.
2. **Disambiguate country candidates by the parent already in the tree.** Measured
   on the base-layer import: the base layer shards a country with overseas
   territories across continents, and a mirrored tree reproduces that — there are
   seven regions named "France", under Africa, Antarctica, Europe, Melanesia,
   North America, Polynesia and South America. `tryMatchCountry` looks a name up in
   a **global** country index, so the France under Europe receives all five France
   divisions as candidates and the matcher correctly refuses to guess. But exactly
   one division named France sits under Europe, and the region's own parent says
   which continent it belongs to. Filtering candidates by the parent's resolved
   division collapses five candidates to one.

   The 51 `needs_review` countries are not a random assortment: they are France,
   the United Kingdom, the United States, the Netherlands, Denmark, Australia,
   Brazil, Colombia, Costa Rica, Grenada — the countries with overseas
   territories. One systematic class, one fix, and it cascades into the 507
   subdivisions those countries never drilled into.

3. **A recursive matching policy.** `MatchingPolicy` is an existing extension point
   (`'country-based' | 'none'`). Add one that resolves a node among the children of
   its parent's resolved division, at any depth, without the all-or-nothing
   fallback — which is correct for Wikivoyage, where a partial match means the
   region does not follow the administrative grid, and wrong for an administrative
   source. Needs no new metadata: the information is already in the tree. Score it
   against the base-layer corpus.
3. **Providers and capability negotiation**, as above.
4. **Eager point metadata + an "enrich for matching" option per source**, once
   providers exist. For the base layer this is deliberately circular — the points
   come from the table being matched — so it belongs behind an explicit switch:
   on for a usable world view, off for an honest measurement.

## What the unmatched third actually costs, measured

The base-layer world view was taken all the way through geometry and experience
assignment, so the cost of the matching gap is no longer theoretical.

Geometry computed cleanly for every region that had a member: 2534 computed, 1297
skipped for having nothing to merge, zero failures. Coverage by level: 7 of 8
continents, 170 of 237 countries, 2357 of 3586 subdivisions.

Experience assignment then placed **1024 of 1547 experiences** — 10832 direct
location-region rows, 113 propagated to ancestors, no errors. The 523 experiences
that landed nowhere cluster in exactly the countries the matcher could not
resolve: ES 48, FR 45, GB 31, RU 30, JP 25, BR 24, US 23, TR 22, AU 21, PT 17,
DK 11, NL 11.

The mechanism is worth stating because it is not obvious: a parent's geometry is
the union of the children that *have* geometry, so an unmatched country is a hole
in its continent rather than an area the continent still covers. Verified against
the data — `Europe` contains Rome (Italy resolved, has geometry) and does **not**
contain Madrid (Spain unresolved, no geometry). An experience in an unresolved
country therefore falls outside every polygon in the world view and is assigned to
nothing at all, rather than degrading gracefully to a coarser region.

So the follow-up work is not tidiness. Disambiguating country candidates by the
parent already in the tree — item 2 above, one systematic class of failure — is
what stands between a third of the experience corpus and being reachable.

## Why the base-layer import is worth keeping around

It is 3831 nodes whose correct answer is known and was deliberately withheld from
the importer, so any change to matching can be scored against it. No other source
offers that: for Wikivoyage, nobody knows the right answer. Today's baseline is
62% under `country-based`.

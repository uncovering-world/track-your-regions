# ADR-0119: A source that reads the subset keeps only what it still asks live

**Date:** 2026-10-18
**Status:** Accepted

---

## Context

ADR-0030 keeps what the live Wikidata query service answers, in `wikidata_query_cache`, per source
(ADR-0047) and per kind of question. Its decision 4 says the cache belongs to a source and that
only the kinds that source's collector produces exist for it, listed in `CACHED_KINDS_BY_SOURCE`.
The panel, the *Sync without cache* button and the lifetime route all read that list.

Epic #1439 moved every Wikidata kind's runs onto the local Wikidata subset built from the entities
dump (ADR-0105). Art Museums (#1460), Public Art & Monuments (#1459), Places of worship (#1461) and
Archaeology (#1462) are each switched per source (`experience_sources.wikidata_reader`). On the
development catalogue, on 2026-10-18, all four read the subset of the 2026-10-05 dump. A run on the
subset asks the live service nothing: its door (`subsetOnlyDoor`) refuses any question with no twin
in the subset, and stops the run by name. One thing a switched source still asks live is
OpenStreetMap: Archaeology's `osm` answers come from the QLever mirror or Overpass, whichever
Wikidata the run reads.

So for a switched source, decision 4's list described caches that nothing fills. Four things
followed (#1518):

- The panel listed the class trees, pools, statements, details and edges a switched source no
  longer keeps, with lifetimes that decide nothing.
- *Sync without cache* was offered to Art Museums, Public Art and Places of worship, whose runs on
  the subset read no cache at all.
- The rows those sources' live runs left were never pruned. `pruneExpired` runs behind a cached
  door, and a run on the subset builds none. On 2026-10-18 the development cache held 1,482
  such rows, the newest from 2026-10-14, read by nothing.
- Nothing kept `withCache` from being wrapped around the subset's door. A wrapper carries no
  `subsetDoor` mark, so the fetchers behind it would send SPARQL. The cache would then answer some
  of a question family with the live service's Wikidata, of another date than the dump's, and the
  subset door would refuse the rest.

## Decision

**1. Which kinds a source keeps depends on which Wikidata it reads.** On the live service, a
source keeps every kind its collector describes, as decision 4 of ADR-0030 says. On the subset, it
keeps only the kinds the subset does not answer, so `SUBSET_ANSWERS` (`classes`, `pool`,
`statements`, `entities`, `edges`) leave the list (`cachedKindsFor(sourceId, reader)`). Today that
leaves Archaeology's `osm` and nothing for the other three. The cache keeps Wikidata's kinds for a
source on the live service, because switching back is the fallback when the subset is not built,
and a run on the live service still needs to resume.

**2. The cache is never put in front of the subset's door.** `withCache` refuses a door
`subsetDoor` marked. A run answers a question family from one Wikidata, of one date.

**3. What a source's live runs left is shown as left, and pruned by the cache's own rule.** The
panel names the dump the subset was built from, and lists the rows of a kind the subset answers
apart, with *Clear* and no lifetime. A run on the subset prunes the source's rows a week past
their expiry (`subsetRunDoor`), the rule `pruneExpired` applies behind a cached door.

**4. The parity harness keeps no baseline of its own.** It compares the subset with the cache.
It is run before a source's switch. To check a switched source again, the source is switched to
the live service for one run, which fills the cache, and back. A baseline copied out of the cache
would be live answers kept past the expiry ADR-0030 decision 2 gives them.

This narrows ADR-0030 decision 4 to a source on the live service. Decisions 1–3 and 5–8 stand.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep listing every declared kind, empty or stale, on a switched source | The panel would show lifetimes that decide nothing, and offer *Sync without cache* to runs that read no cache. The panel exists so an admin can tell where an answer came from, and that would tell them wrong. |
| Drop Wikidata's kinds from the cache altogether once every source has switched | The switch is per source and reversible. A subset that is not built, or a copy a database crash emptied, sends a source back to the live service, and that run is the one a cache was made for: long, and worth resuming. |
| Delete a source's Wikidata rows when it is switched to the subset | A switch back the same week would ask again what it already paid for. The expiry rule already decides when an answer is no longer worth keeping. |
| Keep a parity baseline in a table of its own | A second store of live answers, with no expiry and no panel, read by one script. Switching a source back for one run gives the harness fresh answers when they are needed. |

## Consequences

**Positive:**
- The panel says where a switched source's Wikidata comes from (the dump date) and keeps showing
  the one cache that source still fills.
- No run can mix a cached live answer into a run on the subset.
- A switched source's leftover rows leave the table on the cache's own schedule.

**Negative / Trade-offs:**
- Re-checking a switched source's parity costs one run on the live service.
- The admin cannot change the lifetime of a left-over kind from the panel while the source reads
  the subset. It takes effect only after a switch back, and then the panel offers it again.

## References

- Related ADRs: ADR-0030 (the cache; decision 4 narrowed here), ADR-0047 (the key is per source),
  ADR-0105 (the subset)
- Related docs: `docs/tech/experiences.md`, the paragraphs on what a run keeps and on the parity
  harness
- Issue: #1518; Epic #1439

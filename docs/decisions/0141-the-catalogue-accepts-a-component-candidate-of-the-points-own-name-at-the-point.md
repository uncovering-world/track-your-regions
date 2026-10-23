# ADR-0141: The catalogue accepts a component candidate of the point's own name at the point

**Date:** 2026-10-23
**Status:** Accepted
**Issue:** [#1839](https://github.com/uncovering-world/track-your-regions/issues/1839)

---

## Context

A serial World Heritage site's component with no Wikidata item gets candidate items from the finder
(#1272). A candidate is a match by place and name, not a fact (ADR-0046), so a curator confirms it.
Until a curator does, the point takes nothing from the item: no picture, no description.

The finder marks a candidate `exact` when one of the item's labels is the point's own name, folded,
and the item stands within `EXACT_DISTANCE_M` (50 m) of the point (`componentItemMatching.ts`). So
far the mark only let a curator confirm a site's exact candidates together.

Measured on the development catalogue on 2026-10-22:
- The review queue held 566 open candidates on 48 sites. 151 of them were exact, each on a
  different point.
- No exact item was proposed for two points, no heritage register disagreed with any of them, and
  the farthest stood 48 m from its point. The Nagatsuka Kofun's item stands 7 m away.
- Curators had answered 20 candidates, 3 of them exact, and accepted every one.
- Every wrong candidate is a partial name match. For example, Pattadakal's Jaina Temple is offered
  the Jambulinga temple 846 m away.

## Decision

**1. An exact candidate that nothing contradicts is accepted by the catalogue.** It is accepted when
all of these hold:
- it is the point's only exact candidate;
- its item is open for no other point of the site;
- no heritage register disagrees with it;
- no curator has answered it or set the point's item;
- no curator has taken it back.

The search pass of *Find component items* accepts them after it searches
(`acceptExactCandidates`). Partial names and candidates beyond 50 m stay questions.

**2. It is written by the curator's writer, with no curator.** The acceptance goes through
`answerComponentItemsUnderLock` like a curator's confirmation, so the point takes the item's
picture and description and a claim on its item. The proposal's `answered_by` is null, and
`answered_by_catalogue` marks it, since a deleted curator's answer is null too. The figures about
curators' answers, such as AI Settings' agreement with Jev, leave the catalogue's answers out.

The item's content is read with a run's patience, and strictly. A site whose content Wikidata does
not answer is left for the next pass rather than accepted without its pictures. An item whose
picture Commons gives no credit for waits alone, and the site's other candidates are accepted. The run's content writer leaves
a claimed point alone, so nothing would ever fill the picture in. A cancelled pass writes no further
site.

**3. The history tells it from a curator's.** The `component_items_answered` row names no curator,
and its details carry `catalogue: 'exact'`. The history shows it as *The catalogue — the same name
at the point*, as it shows a catalogue merge (ADR-0086). The curator check on the log admits that
action without a curator (migration 156).

**4. It is taken back like a curator's.** *Take back* works on it as on a curator's confirmation
(#1336). A candidate taken back is marked so, and the catalogue never accepts it again; only a
curator can.

**5. No migration accepts the candidates already held.** An acceptance reads the item's picture
and description from Wikidata and Commons, which a migration cannot do. The next *Find component
items* pass from the admin panel accepts them: 151 on dev.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep asking, with the batch button | Every exact answer measured was yes. The question costs a curator's time and leaves the point without its picture until then. |
| Accept in a migration, without the item's content | The point would hold an item and no picture or description, a state no curator's answer leaves. |
| Accept on an AI judge's confidence too | That is #1408's question. The name and the distance decide here, and nothing has to be asked of a service. |
| Write the acceptance with a system user | It would read in the history and in a curator's activity as a person's act. |

## Consequences

**Positive:**
- On dev, 151 components take their item, picture and description with the next pass. The queue
  keeps only candidates a curator has to read.

**Negative / Trade-offs:**
- A wrong item with the point's own name within 50 m is written unasked. The measurement found
  none, and it can be taken back from the history.

## References

- Related ADRs: ADR-0046 (identity is a curator's call), ADR-0053 (an answer goes through the
  writer), ADR-0086 (the catalogue's own act in the history)
- Related docs: `docs/tech/experiences.md` § Review Queue (component items)
- Code: `backend/src/controllers/experience/exactCandidates.ts`,
  `backend/src/controllers/experience/componentItemController.ts`
  (`answerComponentItemsUnderLock`), `frontend/src/components/shared/curationLog.ts`
  (`catalogueActor`), `db/migrations/156-the-catalogue-accepts-an-exact-component-candidate.sql`
- Issues: #1839, #1272, #1336, #1408

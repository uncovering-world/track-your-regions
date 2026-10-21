# ADR-0132: Several kinds are filled from one gather, each by a source of its own

**Date:** 2026-10-21
**Status:** Accepted

---

## Context

Each Wikidata kind fills itself in its own run: Art Museums, Public Art & Monuments, Places of
worship and Archaeology. Each run reads the same class trees and the same place and collection
statements from the local subset (ADR-0101, ADR-0105), and each caches them under its own source.
Epic #1445 asks for one pass that gathers the catalogue's places and works once, locates every
work with one resolver, and classifies the result into kinds.

The first consumer is the Public Art split (ADR-0131). Monuments & memorials and Public art are
drawn from one pool by one set of classes. A place made for both, the Bronze Horseman or Christ
the Redeemer, is offered by both kinds. Built the way Places of worship was, each of the six kinds
ADR-0131 adds would be a run of its own, about thirty files apiece.

The schema decides how a run can fill two kinds. A membership is unique by `(source_id,
external_id)` as well as by `(experience_id, kind_id)` (ADR-0084 decision 2). One source cannot
hold the Bronze Horseman, a single Wikidata item, in two kinds. Everything a run does after its
fetch is keyed by its source:
- admission and the sweep, the badge and the curator's pins;
- missing detection and the held-proposal pointer;
- the changeset, the hand-overs (ADR-0102), and "the places other sources offer";
- the kind list a reader is shown, which lists a kind only when an active source fills it.

For the Wikidata kinds, source and kind are one to one, so per source is already per kind.

## Decision

1. **The pipeline of #1445.** It has four parts:
   - one gather of the candidate places and works from the subset;
   - one resolver of where a work lies, following the containment chain to the nearest place
     the catalogue holds;
   - kinds as classifiers over the result: each kind's rule and fame line decide what it offers;
   - one build that runs the whole pipeline.

   The World Heritage list stays a run of its own, since it is read from UNESCO's API and not
   gathered from Wikidata.
2. **A Wikidata kind is filled by a source of its own.** Memberships stay keyed by
   `(source_id, external_id)`, and everything a run does stays per source, so per kind. The
   Bronze Horseman holds one membership in Monuments & memorials through one source, and one in
   Public art through another.
3. **Sources that share a gather run in a pass.** The pass gathers once. Then each source's run
   takes its share of the gather through its own `fetchItems` and writes through
   `orchestrateSync` as before, one source after another, each with a log of its own. Every log
   after the first names the first (`experience_sync_logs.pass_log_id`). `passes.ts` lists which
   sources share a gather, in the order a pass runs them.
4. **A pass starts, stops and reads as one run.** Starting any of its sources starts the pass,
   and a start is refused while any of them is running. A Cancel on one stops them all, and a
   source that had not started is closed as cancelled with no log. A run that fails for its own
   reason leaves the next to run. The history lists a pass's runs together, and each source's card
   names the sources it runs with.
5. **Until #1820, a pass reads Wikidata under its first source.** The gather reads through the
   first source's subset door and keeps its answers under the first source's cache key. #1820
   widens the gather to every place kind, #1821 gathers the works and #1822 makes the pipeline one
   build. #1819 is the one resolver.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One source writes several kinds, each membership naming its kind | A place in two kinds would need two memberships of one source with one external id. That means uniqueness by `(source_id, kind_id, external_id)`, and every lookup by `(source_id, external_id)` would carry the kind: changesets, hand-overs, held decisions, pins, missing detection. The per-source machinery would then count two kinds together: one kind's admission floor guarding the other's sweep. |
| A run of its own per kind, as today | Each new kind repeats the trees, the pool and the facts, and their cache entries, and two kinds drawn from one pool can drift apart in what they asked. The split of Public Art would read the same pool twice. |
| A separate table of passes | A pass that a restart stopped would stay open with no writer to close it. The first run's log already says when the pass started and who started it, and the startup sweep closes it like any other log. |

## Consequences

**Positive:**
- A new Wikidata kind is a source and a classification over a gather that already exists. It
  is not a new pipeline.
- Every per-kind guarantee (admission, the sweep's floor, the badge, the pins, missing
  detection, the changeset) holds unchanged, since each kind still has its own source.
- A place in two kinds is two memberships, as ADR-0084 already reads it.

**Negative / Trade-offs:**
- A kind adds a source row as well as a kind row.
- The runs of a pass run one after another, so a pass takes longer than its gather plus one
  classification.
- A Cancel on one kind's card also stops the other kinds of its pass.
- Until #1820, the cache panel shows a pass's gather under its first source alone.

## References

- Related ADRs: ADR-0084 (a place belongs to no source; memberships per source), ADR-0101 and
  ADR-0105 (the subset), ADR-0102 (hand-overs between kinds), ADR-0131 (the Public Art split)
- Related docs: `docs/tech/experiences.md` § Sync Architecture
- Issues: #1818, Epic #1445, #1807 (the first two-source pass), #1819, #1820, #1821, #1822

# ADR-0077: The curation gate keeps its tables, and a claim's reach is decided in one place

**Date:** 2026-09-29
**Status:** Accepted
**Issue:** [#795](https://github.com/uncovering-world/track-your-regions/issues/795), a slice of [#788](https://github.com/uncovering-world/track-your-regions/issues/788)

---

## Context

One story — the source says X about a field, a curator says Y — is written into several stores:

- **The claims.** `curated_fields` on four tables: `experiences` (columns, and `metadata.<key>` claims since #488); `experience_kind_memberships` (the `admission` pin, ADR-0053); `experience_locations` (`name`, `location`); `treasures` (`name`, `artists`, `year`, `image_url`).
- **The run's record.** `experience_sync_changes`, whose `changed_fields` has named each metadata key as its own fact since ADR-0039.
- **The answers.** `experience_conflict_decisions` (a curator's value stands over the source's) and `experience_held_decisions` (a held proposal published or refused, per field and per part, ADR-0038).

Twenty-seven modules under `controllers/experience/` read at least one of them.

The architecture assessment behind #788 asked whether a claims table — object, field, who said it, value, status, when — should become the single write model of the gate, with the published columns a projection written by one function. #727 and #729 were its evidence: a claim on a major metadata key excluded on one side of a run and not on the other, and a whole-column `metadata` claim that protects every key yet is asked about by none.

Both defects share a cause, and it is not the number of tables. The question "which keys does this claim reach?" has two interpreters:

- the diff in TypeScript: `claimKeyFor`, `CURATED_KEY_BY_FIELD` and `claimedMetadataKeys` in `changeSet.ts`;
- the upsert in SQL: the `metadata` arm in `experienceUpsert.ts`, which re-applies claimed keys through a filter of its own. It binds the shared sync-owned list (`SYNC_OWNED_METADATA_KEYS`, as `$16`), but builds its own rule on top of it — parse the `metadata.` prefix, keep a key the stored row still holds, drop the sync-owned ones — while `claimedMetadataKeys` also drops `MAJOR_METADATA_KEYS`.

#727 is those two disagreeing about the major keys. #729 is one of them — the whole-column claim — answering in a grain (the column) that the record no longer uses (the key).

What the data held on 2026-09-29 (development database): 3 766 objects, one with a non-empty claim list (`short_description`); 131 memberships, every one pinning `admission`; one work claim (`artists`); no location claims; **no whole-column `metadata` claim and no per-key one**. Nothing writes a whole-column `metadata` claim: `editExperience` claims `website`, `wikipediaUrl` and `imageCredit` per key. 1 831 held answers, 1 conflict answer, 35 563 change records. No production database exists yet.

## Decision

1. **The gate keeps its stores; no claims table becomes its write model.** The stores answer different questions, which is why ADR-0038 decision 3 kept the held answers apart from the conflict answers, and the run's record is what happened, not state to be projected (ADR-0020). A projection function would still have to answer "which keys does this claim reach", so a claims table would move the second interpreter rather than remove it. And the upsert reads a row's claims in the same statement that writes it, on the path every run takes for every object; a claims table turns that into a join per row for the one question a list on the row already answers.
2. **A claim's reach is decided in one place, and both runtimes read it.** Which `metadata.<key>` claims the upsert re-applies — the whole filter, not only the sync-owned list it already binds — is one declaration beside `claimKeyFor`. The upsert takes the keys it answers as a parameter, the way the queue's conflict SQL already takes `CLAIM_KEY_BY_FAMILY`, instead of composing its own filter over the claimed keys. This is #727's fix, and #727 carries it.
3. **A claim on metadata is per key; the whole-column claim is retired.** `metadata` stops being a claim name: `CURATED_KEY_BY_FIELD` sends `metadata.inDanger` and `metadata.dateInscribed` to their own names, and the upsert's `curated_fields ? 'metadata'` condition goes — the arm it sits in stays for the gate's hold (`OR ${HELD}`). A claim is then always in the grain the record speaks, so every protected key is also a key a curator can be asked about. This narrows ADR-0039 decision 2, whose whole-column arm answered protection and lost addressability, and it is #729's fix, which #729 carries. No stored row holds such a claim, so nothing is migrated; a CHECK on `experiences.curated_fields` refuses the bare name from then on.
4. **Every gate table has a writer module on ADR-0069's closed list.** `experience_held_decisions` is written by `heldDecisions.ts` alone and `experience_sync_changes` by `changeRecorder.ts` alone, by habit; `experience_conflict_decisions` is written by two controllers (`declineSourceController.ts` inserts, `acceptSourceController.ts` deletes), and a membership's curator pins by raw updates in two more (`lifecycleController.ts`, `curatorRefusalController.ts`) beside the run's own membership writes. Each gets its writer module and a lint rule, as the catalogue tables did (#1148) — the "four tables behind one writer" alternative, applied table by table rather than as one module over all four, since the four have different lifecycles and different readers.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A claims table as the gate's write model, published columns a projection | It moves the reach question into the projection instead of answering it once, rewrites the hot upsert into a join, and re-points 27 reading modules — for a defect whose cause is two interpreters of one list. An event-sourced catalogue was already declined in #788 (ADR-0020, curators editing columns). |
| One writer module over all four stores | The stores have different lifecycles (a run's record is append-only, an answer is replaced, a claim is edited) and different readers; one module over them would be a new layer, not a home. Decision 4 gives each its own. |
| The status quo | #727 and #729 stay unreachable only because no editor writes the claims that expose them; the next editor that does inherits both. |

**What each option does to the correction screens** (#583 for a point, #731 for a work). Both screens claim columns of `experience_locations` and `treasures` — a point's `name` and `location`, a work's `name`, `artists`, `year` and `image_url` — through the writer modules ADR-0069 closed (`experienceLocationWriter.ts`, `workWriter.ts`), and read the claim back to say what it costs (`placeClaims.ts`, `workClaims.ts`).
- Under a claims table, both would write claim rows and read their fields through the projection, and every other reader of `curated_fields` on those two tables — the run's location and treasure writers among them — would move with them.
- Under this ADR neither screen changes. Their claims are column claims, which decisions 2 and 3 do not touch, and their tables are already on the closed lists decision 4 extends.
- The status quo leaves them as they are too. Its cost is #727 and #729, which only metadata claims reach, and no correction screen writes one.

## Consequences

**Positive:**
- #727 and #729 become one-list and one-grain fixes, each a slice of its own.
- The gate's writes join the closed lists the catalogue's already follow, so a new writer is a lint failure rather than a review finding.

**Negative / Trade-offs:**
- The gate stays several stores, and a reader that needs the whole story of a field still joins them. `waitingCounts.ts`, `reviewQueuePredicates.ts` and `heldDecisions.ts` remain the composed fragments that do.
- A curator who wants a whole metadata column to stop moving has to claim its keys one by one; no editor offers the whole column today.

## References

- Related ADRs: ADR-0020 (a changeset is what happened), ADR-0037, ADR-0038 (decision 3, why held and conflict answers are separate tables), ADR-0039 (decision 2, narrowed by decision 3 here), ADR-0053, ADR-0069 (the closed writer lists decision 4 extends).
- Issues: #795, #727, #729, #1148, #788.

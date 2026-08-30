# ADR-0037: A field of a part readers can see is held like the object's own

**Date:** 2026-08-30
**Status:** Accepted

---

## Context

An experience is a container: it has fields of its own and holds parts — the points of a serial
site, the works of a museum. A gated source may not overwrite what a reader can already see: the
object's upsert keeps every content column of a visible row and records the run's proposal for a
curator (ADR-0025 decision 5, `heldSql` in `syncUtils.ts`). The parts learned the run's record but
not the hold. `contentsChangeSet.ts` set `held: false` on every field change of a point or a work,
by design and with a stated reason: the gate holds contents by writing a *row* invisible, and never
a field of a row that already exists. So under a gated category a run rewrote a visible work's
attribution or a visible place's name on the spot, while the same run's change to the object's own
name waited on a card.

Measured on the development database on 2026-08-30, all three categories gated: 73 part-field
changes written live — on works `image_url` 44, `artist` 22, `year` 4, `name` 1; on places `name`
2. Seven of the attributions, checked by hand: *The Wine Glass* (Gemäldegalerie) moved from
Johannes Vermeer to "Jan Vermeer van Haarlem the Elder", a namesake — wrong; *Borghese Gladiator*
(Louvre) from Agasias of Ephesus to Nicolas Cordier, who restored an arm — wrong; *The Baptism of
Christ* (Uffizi) from Leonardo to Verrocchio — right; *The Stolen Kiss* (Hermitage) from Fragonard
to Marguerite Gérard — disputed; *Laocoön* from Athanadoros to Polydoros, a different one of the
three Rhodians. Every one reached readers on 2026-08-21 with nobody asked. The one place renamed —
Château de Montésgur → Château de Montségur — happened to be a typo fix.

What the hold protects, measured the same day: 1272 visible UNESCO sites with 6347 visible points;
128 visible museums with 1371 visible work links. No part carried a claim yet.

The card half already existed (#570, PR #715): `FactTable` takes groups by subject with a `place`
or `work` heading, a detail line and a way to open the part, and the vocabulary carries a work's
`artist`, `year`, `image_url` and a place's `name`. Nothing fed the groups.

## Decision

**1. A gated source may not overwrite what a reader can already see — a field of a part
included.** This narrows ADR-0025 decision 5, which holds contents by writing a *row* invisible:
that stands for a row that arrives, and stops short of a field on a row readers already see. Per
row, exactly as for the object: a part row that is itself `pending` is refreshed in place, since
there is nothing to protect and the curator should review the newest state; a *visible* part row
keeps its stored value, and the run records the proposal with `held: true` in
`contents.<kind>.changed[]`.

**2. The hold is the writer's own answer, taken as given by the record.** `locationWriter.ts` and
`museum/treasureWriter.ts` decide it in SQL against the stored row as the write locked it, and
return the guard's own expression in `RETURNING`, so the record cannot disagree with the write
about whether the write happened — the arrangement `syncUtils.ts` has had since #519.
`pointChanges` and `workChanges` take the answer as a boolean. A claim wins where both are true,
for the reason `computeChangeSet` gives: the two refusals are answered by different endpoints.

**3. Visibility is the row's own state.** A work is passed once, globally (ADR-0025 decision 2),
so a work verified through another venue is on show there even where this venue's link is
pending, and its attribution is exactly what a reader can already see. The hold reads
`treasures.curation_state`, never the link's.

**4. The object's pointer names the run, from whichever writer held.** `pending_change_sync_log_id`
is what the held card resolves to find the proposal it shows, and three writers now set it through
one statement (`heldProposalPointer.ts`). The object upsert runs first in every service and clears
the pointer where the object's own fields propose nothing; the content writers set it again where
they held. So the column names the newest run that held anything about the object, at either
level, and is clear when nothing is held. A run with no log id records the hold and withholds the
pointer, as the object's has always done.

**5. The run counts a part-held row as held.** `total_held` is the rows a reader can already see
that a run proposed a change to and the gate kept whole, whichever level the proposal sits at, and
the changeset row files as `held` rather than `contents`: the held half is the unanswered one, and
the admin report's `?type=held` filter is where a curator would look.

**6. The card shows a part's held fields as a group under the part's name, and publishing writes
them.** The queue's `held` kind carries two halves — the object's own fields and its parts' — and a
row is a card where either holds something; `heldWaitingSql` counts by the same pair. The record
names a part and never identifies it (ADR-0026 decision 4), so the card and publishing find the
row by one rule (`partRecord.ts`): the reference narrows, the name decides among duplicated
references, the lowest id breaks a tie. `POST /:id/publish` writes a place's name and a work's
name, attribution, year and picture — with the credit the run fetched for the picture, carried in
the record beside it, since a hosted picture carries a credit and the next run is not the thing
publishing this one. A field the part's curator has since claimed is skipped and reported; an
unwritable field refuses the whole call; a part the record names that no offered row answers to is
reported rather than refused, because 409ing over a place the source has since withdrawn would
leave a card no answer can clear.

**What is deliberately not held:**

- A coordinate rewritten within ten metres on a kept row is still adopted: the same point written
  more precisely (ADR-0027 decision 4), and nothing a reader can see. A move beyond that is
  already a withdrawal and a `pending` arrival, gated by row. A claimed coordinate is
  `curatedConflict`, never held. A held `location` therefore cannot occur, and publishing refuses
  one as the safety net rather than writing it.
- A work's `sitelinks_count`, `is_iconic` and `treasure_type`: a measurement, a threshold on it,
  and the class the pipeline collected the work under — the standing `SYNC_OWNED_METADATA_KEYS`
  has on the object.
- `external_ref`, `ordinal`, `source_membership`, `missing_since`: the source's handle on the row,
  its place in the source's list, and provenance.
- The location writer's `returned` arm: a withdrawn row is hidden by `offeredLocationSql`, so its
  return replaces nothing a reader sees, and the return itself is reported.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Write the change and show it on the card as applied | Closes the "card has nowhere to show it" half only. The Wine Glass still reaches readers as a namesake's with nobody asked, and the curator's one remedy is an edit after the fact. The gate was switched on to stop exactly this |
| Hold `major` changes and write `minor` ones | Would have held 22 of the 73 — the attributions — and written the pictures and dates. Adds a rule the object does not have, "significance decides whether a person is asked", and a curator reading the object's card and a part's would meet two different gates |
| Hold by claiming the field on the part | A claim is a person's answer about whose value it is (ADR-0029); a hold is nobody having looked yet. `accept-source` and `publish` answer them differently, and a field carrying both raises two contradictory cards |
| A pointer per part | Every reader of the pointer — the card, the count, the staleness check, `publish-waiting` — keys on the object's. A held work is one card about one museum, as a held label is |
| Backfill: revert the 73 changes already written | They are live, some of them right, and the record holds no verdict on which. Repairing an attribution is a curator's edit, which claims the field; a follow-up lists the 22 for a person to check |

## Consequences

**Positive:**

- The rule ADR-0025 was written for holds at the size the mistakes occur: a work's attribution
  from a community-edited source waits for a person, as the museum's own label does.
- One card per object still. A museum holding twelve re-attributions and a proposed label is one
  decision, and the card says all of it.
- The pointer, the count, the changeset word and the staleness check all answer for both levels
  through the predicates they already had, extended rather than doubled.

**Negative / Trade-offs:**

- A held name fails the location writer's fast path on every run until answered, so the object
  takes the slow path per run while held — the cost ADR-0029 decision 5 already accepts for a
  claimed point, and the same re-proposal the object's own held field makes.
- The credit is held only with the picture it belongs to — a credit fetched for the photograph the
  row already shows is written, since a credit no card would ever carry is a credit no visible work
  under a gated museum could ever gain. So the object's `metadata` and a work's differ here on
  purpose: the object's is held behind its hold wholesale, the work's only where its picture is.
- A held change on a globally visible work under a museum that is itself still `pending` records
  the hold and sets no pointer, since an arrival never carries one; its card appears once the
  museum is published and the next run re-proposes. Named rather than hidden.
- The 73 changes already written stay written. Forward-only, by the reasoning above.

## References

- Narrows: [ADR-0025](0025-per-source-curation-gate.md) decision 5 — contents are held by being
  written invisible *and*, for a field of a part readers already see, by keeping the stored value.
- Extends: [ADR-0029](0029-what-an-object-is-made-of-can-be-curated.md) decision 7 — the `held`
  flag on a part's `FieldChange` now carries the meaning it carries on the object's.
- Related: [ADR-0026](0026-a-run-records-what-a-container-holds.md) decision 4 — items are named,
  never identified, which is why `partRecord.ts` exists; [ADR-0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md)
  decision 4 — the coordinate stays outside the hold.
- Related docs: `docs/tech/experiences.md` § What a run did to an object's contents, § The gate's
  own three kinds, § Publishing
- Issue #717

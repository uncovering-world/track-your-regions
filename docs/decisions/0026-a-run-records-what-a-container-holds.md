# ADR-0026: A run records what a container's contents did, per kind of contents

**Date:** 2026-08-15
**Status:** Accepted

---

## Context

An experience is a container. It has fields of its own — a name, a description, a point — and it
holds **contents** of more than one kind: points (`experience_locations`) and works
(`experience_treasures`, many-to-many through `treasures`).

The changeset records the fields and knows nothing about the contents. `ExperienceSnapshot`
(`changeSet.ts:13`) is twelve scalar fields, and its `lon`/`lat` is the container's own point, not
its components. Neither writer puts anything into `changed_fields`. So a run can add a component,
move one, or withdraw one, and there is nothing to render — not a card that fails to render it.

This surfaced as a curator's question. UNESCO site 1239, Berlin Modernism Housing Estates, proposed
a description of *Waldsiedlung Zehlendorf* — one of its seven components — and the conflict card
showed that text against the stored text with no hint that the object is serial or that a component
is what the proposal is about. Measured on the live catalogue, 2026-08-15: **485 of 1604**
experiences hold more than one point — 484 of them hold more than one point a reader is *offered*,
the difference being the catalogue's single withdrawal — and **85 of the 128** that hold works hold
more than one, across 1371 links.

Three further facts shaped the decision.

**The product already has the word.** The curation queue's seventh kind is `contents`, and its query
counts `pending_locations` and `pending_treasures` side by side
(`reviewQueueController.ts:556`); `publishContents.ts` publishes both through one endpoint. The
container idea exists in the gate and is missing from the record of what runs do. A locations-only
mechanism would deepen a split the gate has already closed.

**Both writers already compute the delta and discard it.** `writeExperienceLocations` works out
`kept`, `inserted`, `returned` and `marked` and returns only ids, for placement.
`upsertMuseumTreasures` returns `void` and reduces its `RETURNING treasure_id` — which its own
comment correctly reads as "the museum gained a work", not "the run mentioned one" — to a boolean.
Nothing is missing from the *computation*; what is missing is carrying it out and storing it.

**The stored columns cannot answer it after the fact.** `experience_locations.created_at` is not a
record of when a component appeared: 6548 of 6680 rows carry 2026-08-04, the day the
delete-and-reinsert this project has since removed re-created them. Only 130 rows carry a date that
means what it says.

And one defect this record would answer. `readPreviousPlacements()` (`museumSyncService.ts:54`)
reads live off `experience_treasures` because no stored record of the previous run's belief exists;
since nothing unlinks, "previous" becomes the union of every venue a work has ever hung in.
ADR-0023's Consequences state this in full.

**On the exception count.** ADR-0020 decision 1 says unchanged rows are counted and not stored
"with two exceptions" — `conflict` and `returned`. The code has three: #519 added the held
proposal, whose value lives nowhere else, and `worthRecording`'s own comment says "three of them
carry news anyway". That third exception was never written into an ADR. This one records it while
adding the fourth, so decision 1's text and the code agree again.

## Decision

**1. A run records what an object's contents did, keyed by kind of contents.** A `contents` jsonb
column on `experience_sync_changes` carries, per object per run:

```
{ "locations": { "added": [{name, ref}], "withdrawn": [...], "returned": [...] },
  "treasures": { "added": [...],         "withdrawn": [...], "returned": [...] } }
```

Keyed by kind rather than split into a column per kind, so a third kind of contents costs no
migration and no reader change beyond looking at a new key. A kind with nothing to say is absent,
not an empty object.

**2. This is not a pseudo-field.** A contents delta does not go into `changed_fields` as
`field: 'locations'` with array values, even though that would need no schema change. `FieldChange`
carries `significance`, `curatedConflict` and `held`, none of which mean anything for a set;
`curated_fields` cannot claim a set, so the protection those flags exist to express has nothing to
protect here; and `FieldDiff` deliberately refuses to compare non-text, so the curator's card would
show two JSON blobs. Contents are a different shape of fact and get their own column.

**3. A contents change alone is worth a row — the fourth exception to decision 1.** An object whose
fields all came through unchanged and whose contents moved is `unchanged` in outcome, and
`total_updated` must not count it, exactly as a held row is not counted (#519). The row is stored
because it carries the contents fact, which is recorded nowhere else — the same argument the
`conflict`, `returned` and held exceptions each make about their own fact. Today such an object
produces no row at all, which is the defect this ADR exists to fix.

**4. An item is named, not identified.** Each entry is `{name, ref}` — the source's reference and
the name as it stood — and never a database id. The record has to stay legible when the row it
names has been renamed, and the curator's card and the reader's notice both speak of named things.
This mirrors `name_snapshot`, which the changeset already keeps per object for the same reason.

**5. A withdrawn work is carried by the shape, and nothing produces one yet.** The record admits
`treasures.withdrawn`, and the museum sync does not emit it, because no contents coverage floor
exists for treasures: unlinking on a run that under-fetched would delete real data and report
success. Sync run 42 returned 291 artworks where the previous run returned 1906, and reported
`success`. The floor (`museum-import.md` § 3.6) is the gate on producing a withdrawal, not this
ADR. The alternative — leaving withdrawal out of the shape until then — would mean a second
migration and a second reader change for a case we already know is coming.

**6. The record is per run per object, on the row that already exists.** No
`experience_contents_changes` table. The per-item lifecycle lives on the item: a withdrawn point
carries `missing_since` on its own row (ADR-0022), so a per-item history table would store a second
copy of a fact the item already holds, and add an eighth join to a queue query that has seven.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A pseudo-field inside `changed_fields` | Decision 2. Three of `FieldChange`'s fields are meaningless for a set, and the diff component refuses non-text — the curator would be shown raw JSON |
| A column per kind (`locations_delta`, `treasures_delta`) | A migration and a reader change for every new kind of contents. The kinds are a product decision that will keep moving; the schema should not move with each one |
| A per-item table `experience_contents_changes` | Decision 6. Most precise, most machinery, and it duplicates `missing_since`, which already records the per-item fact |
| Store item ids instead of names | An id resolves to whatever the row says today, and to nothing once it is gone. The changeset already answered this for objects with `name_snapshot` |
| Derive the history from `created_at` | It cannot be derived: 6548 of 6680 location rows carry the day a re-creation touched them, not the day the component appeared |
| Record additions only, and leave withdrawals out | Withdrawal is the case that needs a curator's verdict — gone, or did the source blink? Additions are the case that needs nothing but a notice |
| Unlink works now, so a withdrawal exists to record | An under-fetching run would delete real data and report success; run 42 is the measured example. The coverage floor comes first |
| Give **links** the two-axis lifecycle too | ADR-0022 deferred both halves until they had consumers. This ADR is that consumer for the **location** half — decisions 6 and 7 land it — and links stay deferred for decision 5's reason: with no coverage floor nothing unlinks a work, so no run can withdraw a link for a curator to rule on |
| Keep the changeset as it is and render contents from live tables | The live tables hold the current state, not what a run did. That is exactly the mistake `readPreviousPlacements` makes, and ADR-0023 records where it leads |

## Consequences

**Positive:**

- An object whose only change is what it holds stops being invisible: today it produces no
  changeset row at all.
- The curator's card for a withdrawn point has something to read, which is the verdict ADR-0022
  explicitly deferred.
- `readPreviousPlacements` gains a real anchor — a stored record of the previous run's belief —
  which is the fix ADR-0023's Consequences describe as missing. That change is not made here.
- A third kind of contents costs no migration.
- Both writers stop discarding what they compute; `upsertMuseumTreasures` stops returning `void`,
  which its own docblock complains about.
- The one word the gate already uses for both kinds now means the same thing in the record of what
  runs do.

**Negative / Trade-offs:**

- jsonb carries no foreign key, so a `ref` can name a row that no longer exists. That is the point
  of decision 4, and it means no database-level guarantee that a named item is findable.
- The record is per run, not a per-item timeline. "When did this component appear" is answerable by
  walking the runs; "what is this component's whole history" still is not, and a per-item table is
  what that would need.
- Decision 1's exceptions grow from two to four, so "a stored row means the object changed" needs
  the caveat that it may instead mean a divergence, a hold, a return, or a contents move. The
  `change_type` on the row is what a reader should key on.
- The treasures half is add-only until the coverage floor lands, so the stored record will be
  deliberately asymmetric between the two kinds, and anything reading it must know that a museum
  with no `withdrawn` entries is not evidence that nothing left.
- Rows accumulate for a source that churns its contents — one row per object per run where
  previously there was none.

## References

- Narrows: [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) decision 1 — adds a fourth
  exception to "unchanged rows are counted and not stored", and records the third (the held
  proposal, #519) which was added in code without an ADR. Decisions 2, 3 and 4 are untouched.
- Related ADRs: [ADR-0022](0022-locations-are-marked-not-deleted.md) (a withdrawn point is marked,
  which is what makes recording a withdrawal non-destructive);
  [ADR-0023](0023-works-first-museum-selection.md) (the accumulation consequence this record
  answers, and the missing coverage floor that gates decision 5);
  [ADR-0025](0025-per-source-curation-gate.md) (the gate whose `contents` queue kind already spans
  both kinds)
- Related docs: `docs/tech/experiences.md` § Location model, § Sync orchestrator
- PR / issue: #541

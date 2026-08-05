# ADR-0022: Curation is a per-source setting, and every experience says how it was checked

**Date:** 2026-08-05
**Status:** Accepted

---

## Context

Everything the product shows arrived from a sync run, and nobody looked at any of
it. Measured on 5 August 2026: 1603 experiences — UNESCO 1272, Top Museums 128,
Public Art 203 — of which **3** carry any curator claim in `curated_fields`.

ADR-0020 and the work under #480 made a run's effects *legible*: a changeset per
run, a queue for the two questions a run leaves open, provenance on every row.
None of it changed what reaches a reader. A run's output is live the moment it
lands, and the reader has no way to tell an official register from a
community-edited one.

The two ends of the catalogue are genuinely different. UNESCO is an official
register with stable identifiers; the run that reads it fails loudly and
completely. The Wikidata-derived sources are community-edited, and the same
sync has already had to discard collections-as-entities that its own query
returned (PR #486) — the kind of thing a person spots and a predicate does not.

A single global rule is wrong in both directions. Gating everything makes a
curator the bottleneck for a register that review would rarely improve, and
leaves 1603 existing rows to be approved by hand or blessed by a migration
pretending they were read. Gating nothing leaves community data reaching users
unchecked, with no lever short of switching the source off entirely.

**An experience is not one row.** It is content, a set of points in
`experience_locations`, and a set of treasures in `experience_treasures`, each
written by a different mechanism in the same run. Measured, the three sources
divide along exactly those lines: all 484 multi-location objects are UNESCO
(largest: 758 points), and all 1014 treasures hang off Top Museums — 128 of 128
museums carry them, averaging 8.5 and reaching 103. So the complex geometry
belongs to the source least in need of a gate, and the contents belong to the
source the gate exists for.

## Decision

**1. Curation is a per-source setting.** `experience_categories.requires_curation`
(default `true`). A category is the source here. Under it, an arrival is not
visible and a change does not replace what is live until a curator passes it;
both wait in the queue. Without it, a run publishes as it does today.

**2. The gate holds the whole object, not the row.** Under a gated source, for a
row that is already visible, the run applies no content, writes no locations and
writes no treasures; all three wait as one proposal, answered by one queue item.
Holding the row alone would move an object's pin while its card named the old
place, and would hand readers a dozen unreviewed artworks inside a museum whose
text had not changed.

**3. Every experience records how it was checked**, in `curation_state`:

| | visible | means |
|---|---|---|
| `pending` | no | arrived from a gated source, not yet passed |
| `auto` | yes | published unread, and the product says so |
| `verified` | yes | a curator passed the object that is live now |

The distinction is shown to readers, not kept for operators. `verified` is about
the object, not its identity: any change under a trusted source drops it back to
`auto`, while a provenance-only write (`last_seen_at`, `last_seen_sync_log_id`)
does not.

**4. Only a visible row is held.** A row nobody has ever seen has nothing to
protect, so a gated source refreshes a `pending` row in place — content, points
and treasures — and the curator reviews the newest state rather than whatever
arrived first. Its points are written for a second reason: placement is what puts
an arrival in a region, and a region curator's queue is empty by construction
until it has.

**5. Publishing must be able to write everything the gate can hold.**
`accept-source` writes five of the eleven content fields and answers the rest by
releasing the claim so the *next ordinary run* applies the value. The gate closes
that escape — the next run holds it too — so publishing takes a full writer, and
places the object afterwards because publication can move it between regions.

**6. `curated_fields` stays exactly as it is** — the per-column `CASE` guard in
the upsert. **The claim protects a value from a run; the gate protects a reader
from a run.** They answer different questions, and under a trusted source the
claim is again the only thing standing between a hand-written value and the next
run. A curator may therefore correct a coordinate, and that correction is a
claim, not a publication.

**Column default is `auto`, not `pending`.** The gate is applied explicitly by
the sync path, which knows about it; anything else that inserts an experience —
a fixture, a future importer — gets today's behaviour. Failing the other way, a
writer that forgets the column would remove its rows from the product silently,
and silence is what makes that unrecoverable. One writer is explicit instead: an
experience a curator creates by hand is `verified`, because a person wrote it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One gate for every source — the first version of this design, agreed and revised the same day | Makes the migration choose between deleting 1600 of 1603 rows from the product and recording that they were reviewed when they were not. It also leaves nothing to tell a reader: if everything is gated, the mark is constant and carries no information |
| Gate the experience row only, and give treasures their own state later | The gate would protect a museum's text and leave its contents open, which is the only content risk the gated source actually carries. A treasure riding its experience's proposal needs no state of its own and cannot be hidden on its own, which was the objection to giving it one |
| Hold content but keep writing points | Every gated object has exactly one location, so this moves the pin and re-places the object while the held column still names the old place. Half-held is worse than not held |
| Show a curator a per-point diff of a held geometry | Unjudgeable at this scale — nobody approves 758 coordinates one at a time. The card carries a summary: how many points, how far the anchor moved |
| No gate, mark only | Honest, but the only lever against a source publishing bad data is switching the source off. The mark tells a reader something is unchecked *after* it has been served to them |
| A reader-side filter — "show me only what a person checked" | Puts the judgement on whoever is least equipped to make it, and the flag has to be threaded through lists, map, search and counts, which is the cost slice 3b already paid for `lost`. Not excluded later; rejected as the mechanism that decides what is published |
| Two states — approved or not | Conflates "nobody looked and it is live" with "nobody looked and it is hidden". Those are the two situations the whole decision is about telling apart |
| Approve a run rather than an object | A run is ~1900 items. Approval would be all-or-nothing over exactly the thing curation exists to look at one at a time |
| Hide what a source already published when its gate is switched on | Flipping a setting would remove 1272 objects from the product. The gate binds new content only |
| Publish everything waiting when a gate is switched off | One click putting unreviewed objects in front of readers is the thing the gate exists to prevent. What waits keeps waiting, and releasing it is its own action with the number in front of the admin |

## Consequences

**Positive:**

- The migration states the truth: every existing row becomes `auto` — visible
  exactly as today, marked honestly as unread. Nothing to backfill, nothing lost.
  Migration 009's backfill (caught in PR #493) is the counter-example: it
  credited 1547 rows to a run that never saw them.
- The decision about a source is made once, by an admin, instead of 1900 times by
  a curator.
- A reader can tell the difference, which is the part no amount of internal
  provenance provided.
- `curated_fields` keeps its meaning, so nothing in the existing upsert has to be
  unpicked to make room for this.
- Treasures are covered, so #501 is answered here rather than left open behind
  the feature that was supposed to protect them.

**Negative / Trade-offs:**

- Two mechanisms now hold content back, and they have to stay in agreement. A
  change to either must be checked against the other; the one-line rule in
  decision 6 exists to make that check possible.
- `verified` decays. Any change from a trusted source returns the row to `auto`,
  so a curator's pass is worth only as long as the source stays still. Keeping
  the mark would be simpler and would let it lie.
- The backlog is 1603 `auto` rows on the first day and will not drain soon. The
  queue and the notification must separate *blocking* work — invisible arrivals,
  held proposals, conflicts, disappearances — from it, or the signal is useless
  from the first minute.
- The "New" chip has to re-anchor on becoming visible. Two consequences follow:
  chips no longer clear when a category next runs, so a weekly source shows
  several batches at once; and a force run stamps a whole category as newly
  published.
- A held proposal is carried in the run's changeset, which for the largest object
  in the catalogue is 77 kB of JSON.
- Switching a source's gate on is not retroactive, so a category can hold both
  `auto` rows published before the switch and `pending` ones after it. That is
  the intended reading of "the gate binds new content", but it does mean the two
  can sit side by side in one list.
- **A gate cannot cover what the API does not serve.** Martin auto-publishes
  `experiences` and `experience_locations` as tile sources (#504), and no
  controller change closes that. The gate's promise has that hole in it until
  that issue is answered.
- The coordinate a curator can correct is the object's, so the correction is
  restricted to single-location objects — 1119 of 1603. A dispersed nomination
  has no single point to edit, and gains one per location with #505.

## References

- Builds on: ADR-0020 (changeset per run, two lifecycle axes), ADR-0021 (a run
  may restore `source_membership`). Neither is narrowed: this ADR governs what a
  run *publishes*, not what it may conclude about an object's lifecycle.
- Related docs: `docs/tech/experiences.md` § Change provenance, § Review Queue
- PR / issue: [Issue: #500], closes [Issue: #501], follows [Issue: #480]
- Left open and named rather than silently inherited: #502 (the anchor and the
  map already disagree), #503 (the category total ignores the lifecycle
  predicate), #504 (Martin's unfiltered tile sources), #505 (an arrival point per
  location), #506 (how a dispersed nomination is shown)

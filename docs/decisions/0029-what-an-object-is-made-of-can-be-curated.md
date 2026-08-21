# ADR-0029: What an object is made of can be curated, and a correction outlives the run

**Date:** 2026-08-20
**Status:** Accepted

---

## Context

Since #488 an experience keeps what a person decided: `curated_fields` names the columns a curator
has claimed, and the sync's upsert leaves those alone. What an experience is *made of* never learned
it. `locationWriter` writes the source's `name`, `external_ref` and — on the arms that keep and
resurrect a row — its coordinate, over whatever is stored; the treasure upsert takes every column
from `EXCLUDED`. Neither table had a claim column.

The gate makes that a dead end rather than an inconvenience. A held coordinate is offered to a
curator as two answers — take the source's point, or keep the source's point — and neither fixes a
pin on the wrong building. `stage-1-curation-gate.md` § 4.6 named this and left the shape open.

Measured 2026-08-20, against both live sources:

| | measured |
|---|---|
| works whose name, artist, year or image differ from the source (sample of 120) | 0 |
| stored UNESCO components compared against the live source | 6264 |
| of those, renamed | 2 |
| moved more than 1 km | 6, all of them one re-surveyed site |
| points or works a person has ever decided | **0** |

So this is not a repair. It is the column that has to exist before the third answer can be offered
at all, and the frequency it protects against is low while the cost of a single wrong point is a
traveller in the wrong place — 2.0 km at the worst this fortnight.

One further fact shaped the anchor half of the decision. ADR-0028 positions a reader at the place
nearest the object's own published coordinate. For the 1119 objects that hold exactly one point, the
two are the same place and a correction to the point alone leaves the object's coordinate behind —
issue #550's disagreement, measured at 106 objects and 191 km at its worst.

## Decision

**1. `experience_locations` and `treasures` carry `curated_fields`, and the writers respect it.**
The same shape and the same reading as an experience's, one level down: a claimed column keeps the
stored value, everything else still follows the source.

**2. `experience_treasures` does not.** A link holds no field of its own — its only column beyond
the two ids is `curation_state`, which is an axis rather than a value — so a claim there would have
nothing to protect.

**3. A point's `external_ref` and `ordinal` are never claimable.** The pairing in `locationWriter`
reads both to decide whether a point moved or was replaced. A claim there would not protect a
judgement; it would leave the writer unable to recognise its own row.

**4. A work's `sitelinks_count` and `is_iconic` are never claimable.** A count, and a threshold read
off that count, are a measurement rather than a judgement.

**5. A claimed coordinate pairs on its reference alone, and this narrows ADR-0027.** Identity for a
point is the reference first and geometry within ten metres second (ADR-0027 decision 1), and the
motivating correction here is 2.0 km — so a corrected row falls out of the pairing against the point
the source keeps offering, and decision 1 above would hold for exactly the corrections too small to
need it: the source's coordinate is inserted as a new row and the curator's is marked withdrawn.
`claimedPointSql` is therefore composed beside `samePointSql` in the `candidate` relation. The
claimed row keeps its real distance, so a stored row actually sitting on the source's coordinate
still wins the pairing — a claim buys the corrected point its place in the list, not priority over a
better match.

The fast path's `matched` term is deliberately *not* widened the same way, so an object holding a
claimed point takes the slow path on every run. That is what makes the disagreement visible: the
keeping arm is the only place a `curatedConflict` can be computed, and a fast path that matched such
a row would publish silence instead. ADR-0027 decisions 1 and 5 are narrowed to that extent and
marked accordingly; the rest of that decision stands.

One shape is exempt, and only because there is nothing there to make visible: a claimed **name** on a
point the source offers **no** name for. `upsertSingleLocation` synthesises a null name for every
museum's and every landmark's single point, so that term would fail for ever on any such point a
curator names — and the slow path it buys publishes silence anyway, since the run has no proposed
name to disagree with and the rename it would otherwise report is suppressed as a false one. The
exemption asks the same question the suppression asks — `curated_fields ? 'name' AND
COALESCE(i.name, '') = ''`, where the `COALESCE` is what makes it the same question, since
`noNameOffered` folds the empty string and the UNESCO parser produces one from a malformed `name:`
with nothing after it. Written as `IS NULL` the two would disagree on exactly that row, which is a
transaction every run recording nothing — the shape this exemption exists to remove, arriving through
the gap the parity is claimed to close. The day a source starts offering a name, the term fails again
and the conflict is computed where the rest of this decision says it must be.

**6. Correcting a point moves the object's anchor, where the object holds exactly one point a reader
is positioned over — offered, published, and the one being corrected,** and claims it there too. With several points the anchor is a fact about the object, and
nothing in a single correction says which of them the object should be pinned to. The two claims are
made together and are released together: `accept-source` on the object's `location` takes the claim
off **the point the anchor was taken from** as well, because a coordinate held at one level and
handed back at the other is the disagreement this decision exists to remove. That point is found by
its coordinate — the anchor and its pin were written from one input and neither can move while both
are claimed — rather than by re-deriving the guard, because the guard need not still hold: an object
that gains a second published point and has it corrected carries a claim the anchor never came from,
and releasing that one would undo a correction in answer to a card about something else. The release also **writes** the
coordinate that run offered for the point, where it offered one. Releasing alone would hand the pin
back by retiring it: the pairing needs the reference *and* ten metres (ADR-0027 decision 1), and the
claim is the only thing that let a corrected row pair at any distance — so an unclaimed 2 km
correction stops being a candidate, the run withdraws it and inserts the source's point beside it,
and the queue asks a curator to rule on a withdrawal nobody made while the visit record stays on a
pin no reader is shown. The value is the source's own, per point, from the run being answered, which
is the same guarantee `expectedSyncLogId` gives the object's fields.

**7. A run's contents record gains a fourth arm, and that narrows ADR-0026.** `ContentsDelta`
carries `changed` beside `added`, `withdrawn` and `returned`: one entry per row a run kept and
rewrote, holding the item as the record names it and the `FieldChange`s `contentsChangeSet` found.
The three membership arms cannot express it — the fortnight a curator's corrected point is argued
with by the source, membership has not moved at all — so ADR-0026 decision 1's three-key shape is
extended rather than replaced.

Its decision 2 is narrowed in the same breath and only in part. The delta is still not a
pseudo-field and still deserves its own column, because it is about a *set*. What stops holding is
the argument that `FieldChange`'s flags mean nothing here: a point and a work now carry
`curated_fields` of their own (decision 1 above), so `curatedConflict` on a component's `location`
means exactly what it means on an object's, and `significance` reads the same thresholds. Only the
members' own changes are field-shaped; the set's arrival and departure are not.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave contents uncurated; let a curator edit the object only | The dead end this ADR exists to close: the object's anchor is not the pin a reader walks to, so editing it fixes the list and leaves the map wrong — which is exactly what #502 measured |
| One claim column on the experience, listing contents keys | A claim would have to name a row that the source can renumber, and the pairing already owns that identity. It also makes an object's claim set grow with its components — 758 of them for one site |
| Claim by writing a verdict row instead of a column | A second mechanism for what `curated_fields` already means, and every reader of the sync's guard would have to learn both |
| Move the anchor on every correction, whatever the object holds | For a serial nomination that is a guess about which of forty places the object is, made by whoever happened to fix a coordinate |
| Never move the anchor | Leaves #550's disagreement in place for the 1119 single-point objects, where there is no ambiguity to protect |
| Widen the tolerance instead of exempting claimed rows | The tolerance answers "did the source rewrite this point more precisely" (ADR-0027). A number large enough to hold a 2 km correction would pair unrelated components of a serial site with each other |
| Exempt a claimed row from the fast path's `matched` term too | Cheaper per run, and it would silence the report: the keeping arm is where `curatedConflict` is computed, so the object would take no transaction and the source's disagreement would never be recorded. Taken only for the one shape with no disagreement to record — a claimed name against a source offering none — see decision 5 |

## Consequences

**Positive:**
- A curator's correction to a point or a work survives the next run, which is what makes asking for
  one honest.
- The coordinate editor stops being a special case: it is a claim on `location`, written by the
  same endpoint shape as any other verdict about a point.
- For a single-place object, the list and the map stop being able to disagree.

**Negative / Trade-offs:**
- A claimed column is a column the source can never correct again, and on contents there is **one
  way back, not a general one**. `accept-source` on an object's `location` releases the claim on the
  point the anchor was taken from along with the object's own, because decision 6 ties those two
  together — and on that point only, so a second corrected pin of the same object keeps its claim:
  the anchor is claimed only where one point carries it, so releasing half would leave the next run
  writing the source's coordinate to `experiences.location` while the pin stays where the curator
  put it — the disagreement this ADR exists to close, produced by the pair of endpoints that close
  it. That way back is narrower than it sounds, and the case it misses is the common one: decision 6
  writes the object-level claim **only** where the object holds exactly one reader-visible point, so
  a corrected component of a serial site never raises the card that releases it. Nothing releases a
  point's `name` either, and nothing releases a claim on a treasure at all: those writers only add. So a curator who corrects a component's name and later learns the source was
  right cannot hand it back — re-editing to the source's own spelling leaves the claim standing, and
  that row goes on reporting a conflict every run, in the admin sync report where the queue's
  object-level `conflicts` card never looks. Accepted for now on the same ground as the missing
  editor for a work's fields: the general release belongs with the screen that shows a curator their
  own claims, and that screen does not exist yet. It is a debt with a name rather than a surprise,
  and the first curator to want it is the signal to build it.
- `curated_fields` on contents is `NOT NULL` where the experience's is nullable. The guard is SQL,
  and `jsonb ? 'name'` on a NULL is NULL rather than false — a nullable column would take the
  source's value on every row that had never been claimed. The two homes now differ in nullability,
  which is a wart, and the alternative was a silent no-op guard.
- Nothing yet edits a work's fields. The column arrives because the upsert needs the guard; the
  screen waits until something asks for it, and the measurement above says nothing is asking.

## References

- Related ADRs: ADR-0022 (mark, do not delete), ADR-0025 (the curation gate), ADR-0026 (a run
  records what a container holds — decisions 1 and 2 narrowed by decision 7 here),
  ADR-0027 (a point rewritten more precisely is the same point — decisions 1 and 5
  narrowed by decision 5 here), ADR-0028 (a reader is positioned by places they can go to)
- Related docs: `docs/tech/experiences.md` § Treasures and the API table
- Migrations: `db/migrations/027-contents-claims.sql`, `db/migrations/028-location-edited-action.sql`
- Issues: #488 (per-key claims on an object), #502 (anchor and pin disagree), #550 (two coordinates
  that disagree are a signal)

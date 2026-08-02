# ADR-0020: Record a changeset per sync run, and split an experience's lifecycle into two axes

**Date:** 2026-08-02
**Status:** Accepted

---

## Context

A sync run left only aggregate counters on `experience_sync_logs`:
`total_fetched`, `total_created`, `total_updated`, `total_errors`. Nothing
recorded *which* rows a run touched, so "what did the 2 August run bring in?"
became unanswerable as soon as the New chip's seven-day window passed.

`total_updated` was worse than incomplete. It counted every row that passed
through `INSERT … ON CONFLICT DO UPDATE`, identical or not, so a re-sync of
UNESCO would have reported 1247 updates and meant nothing by it. The measured
baseline shows the shape already: the museum run of 26 July 2026 reported 68
updates, and no one can now say how many of those changed a single field.

Separately, an upsert never deletes. UNESCO delists and merges inscriptions, so a
site that disappears upstream stayed in the database forever, indistinguishable
from a current one. The obvious fix — treat "absent from this run" as "gone" —
is unsafe for two independent reasons. Absence may mean the run did not see
everything (the 26 July UNESCO run finished `partial` with one error), and for
the museum and landmark sources it means nothing at all: both take a top-N slice
of a Wikidata ranking, so objects drop out for reasons unrelated to whether they
still exist.

Deciding what a disappearance *means* turned out to need two facts, not one:

- The Bamiyan Buddhas were destroyed in 2001 but the property remains inscribed.
- Dresden Elbe Valley was delisted in 2009 and is entirely intact — you can go there.

A single `active | former | lost` status can represent either of those, never both.

## Decision

1. **Per-run, per-object changeset.** A new `experience_sync_changes` table records
   one row per object a run created, changed, lost sight of, saw return, or failed
   on — with a per-field diff. Rows that came through unchanged are counted on the
   log and not stored, with two exceptions. A `conflict` row, where the source
   wanted to change a field `curated_fields` protects — nothing changed, but the
   two now disagree, and that divergence is recorded nowhere else. And a
   `returned` row, where an object previously flagged `missing_since` is listed
   again: the likeliest return is a site reappearing unmodified after a transient
   source gap, so requiring a field change would drop exactly the case worth
   knowing about.
2. **Two lifecycle axes on `experiences`.** `source_membership` (`present` /
   `former`) tracks membership in the source's collection; `existence` (`extant` /
   `lost`) tracks whether the object physically survives. Both are set by curators
   only. The machine records `missing_since` and nothing more.
3. **Guarded missing detection.** `missing_since` is stamped only when the source
   publishes its whole collection, the run finished clean and uncancelled, it was
   not a force run (which deletes the category first, so nothing was left to go
   missing), and it saw at least 90 % of the rows that were there before. Curator-created rows
   (`is_manual`) are outside the mechanism entirely: a row the source never
   listed cannot have disappeared from it. Absence is decided against
   the external ids the run saw, not against a provenance column — a dry run stamps
   nothing, and a row that arrived but failed to process is still listed by its
   source.
4. **Dry runs.** A preview walks the same path and writes the log and changeset but
   never the experiences. Dry-run logs are excluded from every "latest run" query,
   so a preview cannot disturb provenance or the New chip.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Single `active \| former \| lost` status | Cannot express destroyed-but-still-listed (Bamiyan) or intact-but-delisted (Dresden). One of the two truths would have to be discarded at write time, and which one is not recoverable later |
| Set `former` automatically on absence | A source outage or a slow SPARQL endpoint would change what users see. With curator numbers at zero the queue may sit unattended, which is a smaller cost than silently retiring hundreds of live sites |
| Store `unchanged` rows in the changeset too | 1247 rows of noise per UNESCO run to preserve a few dozen that carry information. The count answers every question the rows would |
| Keep the plain upsert, diff by re-reading afterwards | The prior values are gone by then. Capturing them needs the same statement, which is why the upsert became a CTE |
| Delete rows absent from the source | Destroys visit history for places users really went, and is unrecoverable when the absence turns out to be a fetch failure |

## Consequences

**Positive:**

- "What changed in this run, and why does it matter?" is answerable per object, with field-level detail
- A curator can see where a source has diverged from their edit — `curated_fields` protected the edit but the divergence was previously invisible
- Dry runs make a first real update reviewable instead of a leap, and cost nothing to repeat
- The New chip can become run-based rather than "created within seven days"
- Provenance was backfilled, so rows that predate all of this and *came from a run* still name
  it. Curator-created rows (`is_manual`) are excluded and keep NULL provenance permanently —
  they were inserted outside any run, and naming one would be a fabrication that slice 4's New
  chip would then inherit

**Negative / Trade-offs:**

- `total_updated` changes meaning. Logs 1–4 are not comparable with later ones, and the run card has to say so
- One extra CTE per upsert; the statement is longer and reads worse than the plain insert it replaced
- `unchanged` rows are unrecoverable after the fact by design
- A force sync still wipes and reloads the category, destroying curator decisions along with everything else. Not addressed here
- Two axes mean two questions for a curator to answer where a single status would have asked one
- `experience_categories.new_badge_days` lands here with no consumer. It belongs to
  the New chip (slice 4 of #480) and is added now so the column arrives with the
  rest of the schema rather than in a migration of its own; until that slice ships,
  nothing reads it

## References

- Related ADRs: ADR-0018 (base layer mirror world view)
- Related docs: `docs/tech/experiences.md`, `docs/security/SECURITY.md`
- PR / issue: #480

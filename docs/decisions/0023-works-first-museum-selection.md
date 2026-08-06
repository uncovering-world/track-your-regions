# ADR-0023: Museum selection is works-first, with no institutional term and no cap

**Date:** 2026-08-07
**Status:** Accepted

---

## Context

The importer this replaces asked which Wikidata entity owns famous paintings and called the
answer a museum. Measured against the live catalogue: four curatorial departments of the Louvre
— Department of Paintings (80 artworks), Greek/Etruscan/Roman Antiquities (5), Near Eastern
Antiquities (3), Egyptian Antiquities (1) — were separate rows, and the Louvre itself was not
one of them. The National Gallery of Art in Washington appeared as the literal string `Q214867`,
because its plain-`en` label is missing on Wikidata and the query asked for `en` alone. Dead
collectors' collections — a donor to the National Gallery who died in 1937, a collector who died
in 1854 — were listed as visitable museums beside the real ones their estates fed into. All 128
rows carried `category = 'cultural'`, UNESCO's vocabulary, because the museum sync had copied the
UNESCO importer; `is_iconic` was `false` on every experience and every treasure, so nothing the
schema already had for "this is a highlight" was ever set.

The replacement collects the artworks the world knows, works out where each one actually hangs —
walking `wdt:P361` past curatorial departments and dead collections to the institution that holds
the ticket — and admits the venues that walk produces. Every row in the resulting catalogue has a
reason a person can name: it holds a specific, nameable work.

That leaves the question this ADR answers: once a venue is a candidate, what decides whether the
**museum** — not the work — makes the cut, and how many museums that leaves.

## Decision

**1. Selection is works-first.** A venue is admitted to the catalogue because it holds a work
above the fame threshold — 22 Wikipedia-language sitelinks (`ICONIC_SITELINKS`) — and for no
other reason. Admission asks nothing about the institution itself: not its own sitelinks, not its
visitor numbers, not a curated "is this a top museum" list.

**2. One threshold serves both halves of the significance model.** The same 22-sitelink line
decides which *works* are Iconic and, by holding one, which *museums* are Iconic — so a museum's
card can never be empty, and the two flags can never disagree about the same work. An admitted
museum's `experiences` row is written `is_iconic = true`; each work that cleared the line is
written `is_iconic = true` on its `treasures` row, sticky on the way down — it keeps the mark
until it falls below 18 (`ICONIC_RELEASE`), so the badge does not flicker as Wikipedia's coverage
grows.

**3. No cap.** The list is exactly the museums that hold a qualifying work, however many that
turns out to be — not a fixed round number the way an earlier design capped it at 100. Measured
on 2026-08-07: 326 works clear the threshold and 100 museums hold at least one. The number is a
property of the data, and moves only if Wikipedia's coverage does.

**4. A unique work held by more than two venues admits none of them. An edition is exempt.**
`MAX_HOLDERS = 2` draws the line at two, and asks the question only where there is an answer to
find. A work that exists once and is claimed by several venues poses a copy-or-original question
— Böcklin painted five *Isles of the Dead*, and the attribution of Caravaggio's *Taking of
Christ* is contested between two cities — and that goes to a curator with the claimants named,
not to a threshold. Two claimants still admit both; more than two admits none and reports the
work as a curator's question.

A medium that exists in editions has no such question to answer. Hokusai's *Great Wave* survives
in on the order of a hundred impressions and each is the real thing, so the cap does not apply to
it. Applied blanket it removed Japanese printmaking from the catalogue as a class, which is not a
judgement anyone made. The case it was written against — a regional museum entering on one
impression — is accepted rather than solved: a traveller standing in front of a genuine Hokusai
impression is standing in front of the thing, and the number of other museums that also hold one
is no evidence against any of them. Medium is read off the subclass tree rather than off a label:
the closure records which root each class was reached from, so etching, lithograph and
screenprint answer for themselves without being listed anywhere.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| **Composite rank** — venue sitelinks + summed fame of its works + a term for published visitor numbers (`ln(sitelinks) + ln(fame) + 0.4·ln(visitors)`) | Measured: only 53 % of art venues carry a visitor figure (Wikidata's `P1174`) at all, and the visitor term read a missing one as zero rather than as unknown. Every one of the 100 proposed rows had a visitor figure — the term had stopped ranking and started gating on how well a museum happens to be documented. It cost Gemäldegalerie Berlin (40 sitelinks, 28 masterpieces), which ranked #150 and dropped out, along with Städel, the Wallace Collection, the Courtauld Gallery and the Isabella Stewart Gardner Museum |
| **Pure institutional renown** — rank venues by their own sitelinks alone, independent of what they hold | Sitelinks measure how much has been written about an institution, not what a visitor finds inside it. Measured on live data: this ranking puts Château de Montsoreau at #16 and the National Library of Australia at #26 |

## Consequences

**Positive:**

- Every museum in the catalogue answers "why is this here" with a named work, and every work
  answers "where do I see this" with a named museum — the Louvre problem (four departments, no
  Louvre) cannot recur by construction.
- One number governs both halves of the significance model, so treasure-Iconic and venue-Iconic
  can never quietly disagree about the same work.
- The catalogue's size is honest: 103 is what the measured data supports, not a quota that pads
  the list to round it out or trims a real entry to hit one.

**Negative / Trade-offs:**

- **The placement diff converges only for the first transition after a clean slate.** Each run
  prints a diff of its proposal against `readPreviousPlacements()`, which reads live off
  `experience_treasures` rather than a stored record of the last run's belief. That is exactly
  right immediately after the museum category's clean-slate migration — the table holds nothing,
  then holds exactly what the first run wrote. It stops being right the first time a work's
  placement actually changes: linking is `INSERT ... ON CONFLICT DO NOTHING` and nothing ever
  unlinks (deliberately — a contents coverage floor for treasures does not exist yet, so removing
  a link on a run that under-fetched would delete real data and report success), so the old link
  and the new one both persist. From that work's next run onward, "previous" is the union of
  every venue it has ever been linked to, not what the last run actually proposed, and the diff
  for that work stops showing what changed and starts showing what accumulated. Museums are also
  a `ranked`, not `authoritative`, source, so the missing-detection machinery that could otherwise
  flag a stale link never runs against this category at all. The diff remains a genuine
  early-warning tool — it is what caught second-order placement regressions during design — but
  it is a console log for a human to read, not a mechanism that corrects the underlying
  accumulation.
- **`is_iconic` on `experiences` is written outside the run's own record of itself, and outside
  `curated_fields`.** Every museum that reaches the catalogue holds a qualifying work by
  construction, so the flag is a property of belonging to the category rather than a value the
  source proposes — there is nothing for a per-field guard to protect against, most of the time.
  It is set by a museum-local `UPDATE` after `upsertExperienceRecord` returns, guarded by hand
  (`NOT COALESCE(curated_fields ? 'is_iconic', false)`) so a future curator's `false` is not
  silently overwritten, because the shared upsert has no `is_iconic` column to run that guard
  through itself. Two things follow: the flip is not part of the row's `changeSet`, so a run that
  sets the flag does not say so in its own per-object report — the blind spot sits exactly where
  ADR-0020 built visibility for everything else; and the hand-rolled guard has to be kept in sync
  with `curated_fields` by eye, since it is a parallel mechanism rather than the same one extended.
- Every museum in the catalogue is definitionally Iconic — there is no non-Iconic row in this
  category, so a future reader that asks the flag to distinguish museums from each other will
  find it distinguishes nothing.

## References

- Related ADRs: [ADR-0022](0022-locations-are-marked-not-deleted.md) (a departure here is marked,
  not deleted — what makes the turnover this design produces non-destructive);
  [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) (guarded missing detection, encoded
  in code as `sourceCompleteness: 'authoritative' | 'ranked'` — why a `ranked` source is exempt)
- Related docs: `docs/tech/experiences.md` § Top Art Museums, § Change provenance
- PR / issue: #507, named in [ADR-0022](0022-locations-are-marked-not-deleted.md) as "the museum
  import is about to be corrected"

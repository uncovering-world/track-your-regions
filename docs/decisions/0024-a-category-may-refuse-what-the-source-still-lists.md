# ADR-0024: A category may refuse what the source still lists

**Date:** 2026-08-07
**Status:** Accepted

---

## Context

The works-first museum importer decides membership by rule: a venue enters
*Top Art Museums* because it holds an iconic work of art, and the art test
(`artTest.ts`) refuses one that is an archaeological site, a natural history
collection, a church, or a stretch of painted wall. Run 50 admitted 82 venues
and refused 27.

All 27 already existed as rows, created by run 48 before the art test was
written. A stopgap stamped `missing_since` on them, which is all ADR-0020
allows a machine to do. The measured result:

- The public API still returns them. `GET /api/experiences?search=British Museum`
  answers with the British Museum, category *Top Art Museums*. `missing_since`
  changes nothing a reader sees, by design — `experienceLifecycle.ts` says so
  in as many words, because "a source outage must not change what anyone sees."
- The Review page files all 27 under **"Gone from the source"**, subtitled "a
  clean run stopped finding these", and offers three verdicts: *Former —
  delisted, still there*, *Lost — no longer exists*, *False alarm*.

None of the three is true of the British Museum. It is open today, so not
`lost`. It was never a legitimate member of this list, so `former` — which
ADR-0020 defines as delisted-but-standing and deliberately keeps on the map —
would put it back in front of travellers with a chip on it. The refusal was
correct, so it is not a false alarm. A curator has no honest button.

The framing is wrong one step earlier, too. The run did not stop finding the
British Museum. It found it, named it, and applied our own rule to it. Silence
and refusal are different events, and only silence is ambiguous.

Three further facts pushed this past a copy fix:

**The premise ADR-0020 reasoned from no longer holds.** It justified refusing
missing detection for this source on the grounds that "both take a top-N slice
of a Wikidata ranking, so objects drop out for reasons unrelated to whether
they still exist." The works-first importer takes no slice. It recomputes the
whole membership every run from the whole pool, and the work threshold carries
hysteresis (22 sitelinks to enter, 18 to leave) precisely so that membership
does not flap. Absence from a completed run is now a decision, not a ranking
artefact.

**Order of deployment must not decide catalogue contents.** A candidate that
fails the art test is never created, so no traveller ever sees it. A row
created before the test existed must end up in the same place, or the
catalogue is the union of every rule the importer has ever had. That union is
literally how "Egyptian Museum of Berlin" — a collection nobody calls by that
name, shown inside a museum of a different name — survived into the list the
project owner complained about.

**Absence has a third cause neither path catches.** `Roman Forum and the
Palatine` (Q55685908, an archaeological park) sat unmarked and fully visible
after run 50. Run 48 placed the Column of Phocas there; run 50 resolved the
same work to a different Wikidata item, "Roman Forum", and refused *that*. The
refusal names the new identity while the stale row keeps the old one, so
matching refusals by external id cannot reach it. Re-identification looks like
silence and means refusal.

## Decision

**1. Admission is a third lifecycle axis, independent of the two ADR-0020
defined.** `experiences` gains:

```sql
admission        varchar(10)  NOT NULL DEFAULT 'admitted'
                 CHECK (admission IN ('admitted', 'refused')),
admission_reason text
```

ADR-0020 split status into two axes because one column could not say both
"delisted" and "still standing". The same argument forces a third: the source
can go on listing the British Museum — Wikidata does — while our category
refuses it. Those are independent facts, and `source_membership` is a
statement about the source's collection, not about our rule. Folding a refusal
into `former` would reproduce exactly the conflation ADR-0020 removed.

`admission_reason` lives on the row rather than being read back from
`experience_sync_changes.error`, because the changeset is keyed by the external
id the run named, and the Roman Forum case is precisely the one where that id
is not the row's.

**2. Unlike the other two axes, the machine sets this one.** ADR-0020
decision 2 reserved both axes for curators, on the reasoning that a machine
observation is ambiguous and a verdict is not. A refusal is not an
observation: it is our own deterministic rule, applied to data we hold, naming
the object before it says no. Re-running it produces the same answer. Decision 2
of ADR-0020 is narrowed accordingly, and only for this axis.

**3. A refused row is not offered to readers.** `hideRefusedSql()` joins
`hideLostSql()` as a fragment applied at every read that puts an experience on
screen. The two hide for unrelated reasons and are toggled separately: the
curation queue asks for refused rows, the "show what is gone" affordance asks
for lost ones.

Visits are untouched, exactly as under ADR-0022. Someone who stood in the
British Museum stood in it, and that record cannot depend on which of our
categories currently claims the building.

**4. A source that recomputes its whole membership marks the remainder.**
After a clean run, the museum importer marks every previously admitted row of
its category that is absent from this run's admitted set as `refused`, with a
reason. This is what reaches Roman Forum. Three guards: the run finished without
errors, it was not cancelled, and the admitted set holds at least half the
previous one (`ADMISSION_SWEEP_MIN_SHARE = 0.5`).

That floor is deliberately looser than missing detection's 90 %, and the two are
not the same kind of statement. Missing detection guards a *listing*, where a
tenth of a source going quiet means the source misbehaved. This guards a *rule*,
and a rule is meant to move the set — the art test alone took 110 rows to 82 and
was right to. It is a share, not an emptiness check: a run that admits one row in
a hundred is refused by it, which "no run may empty a category" would not catch.

UNESCO does not call it: UNESCO publishes a collection, and absence there is the
ambiguous kind ADR-0020 was written about.

**5. The curator gets a section of their own, with two honest verdicts.**
Refused rows leave "Gone from the source" for a section that states the reason
verbatim — *"not a museum class — named by Column of Phocas (36 sitelinks)"* —
and offers:

- **The rule was right** — the row stays refused and leaves the open list. It
  is not deleted: the British Museum is a strong candidate for the archaeology
  category that does not exist yet, and throwing the row away would throw away
  that answer too.
- **The rule was wrong** — the row is admitted again, and `admission` is added
  to `curated_fields` so the next run does not refuse it a second time, the
  same protection `is_iconic` already has.

Both answers are durable against *runs*, and only the second is durable against
the curator. Confirming hides an object from everyone, and this axis has no
reveal: `former` never hides, `lost` has a reader toggle, and `hideRefusedSql`
rides on neither — so a confirmed row answers 404 by id and appears in no list.
A one-way door is the shape `setExperienceState` reasoned itself out of for the
other two axes, and it would be worse here, because the machine opened it. So
the page keeps a
collapsed **kept out** list of the confirmed refusals, the one surface they
appear on, and *the rule was wrong* stays available from it. The asymmetry is
deliberate: the correcting direction reveals rather than hides, and two curators
taking the same row back reach the same state, so it needs no concurrency check
that an earlier answer could close.

## Alternatives Considered

**Reuse `former` or `lost`.** Both are statements about the world. Recording
that the British Museum no longer exists, or that Wikidata stopped listing it,
would put a false claim in the database to achieve a display effect. `former`
additionally keeps the row on the map, which is the opposite of what is needed.

**Delete the refused row.** Forbidden by ADR-0022, and for the reason that ADR
gives: `user_visited_experiences` cascades, so a rule change would erase
people's records of where they have been.

**Leave refused rows visible until a curator rules.** This is the current
behaviour and the reason the complaint exists. It also makes the catalogue
depend on deployment order, since a candidate refused before creation is never
seen and one refused after creation is seen indefinitely. The Review page's
promise that "nothing here has changed what visitors see" stays true for the
ambiguous cases it was written for, and stops applying to refusals.

**Write into `experience_rejections`.** That table is region-scoped
(`experience_id, region_id`) and means "not relevant to this region's list",
and `rejected_by` is a non-null foreign key to `users` — a machine has no row
to put there. Refusal is category-wide and has no author.

**Change the museum source's `sourceCompleteness` to `authoritative`.** It
would reach Roman Forum through the existing path, but it would route all 27
named refusals into "Gone from the source" as well, which is the wrong queue
with the wrong verdicts. It also overstates the case: the importer is
authoritative about its own membership decisions, not about what exists.

## Consequences

Travellers stop seeing archaeological museums, churches and natural history
collections in a list called Top Art Museums, without waiting for anyone.

The art/archaeology boundary becomes enforceable rather than advisory. Its
known cost stands and is accepted: Egypt, Mexico, Turkey, Cyprus and Greece
lose their entries, because their iconic holdings are archaeological. They
return when the archaeology category is built, and the refused rows are the
list to build it from.

A rule change now has teeth in both directions, so a bad rule can hide good
museums. Three things bound that: every run prints its placement diff, refusals
carry their reason to the curator, and a curator override is pinned in
`curated_fields` against re-refusal.

The Review page grows a fourth section. Its existing promise narrows to the
cases it was written for, and the copy has to say so.

Sources not built on recomputed membership are unaffected. UNESCO keeps
`missing_since`, the guards, and the three verdicts.

## References

- [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) — the two axes;
  decision 2 narrowed here for the admission axis only
- [ADR-0021](0021-source-may-restore-membership.md) — a sync may restore
  membership in one direction
- [ADR-0022](0022-locations-are-marked-not-deleted.md) — marked, not deleted;
  no run may empty a category
- [ADR-0023](0023-works-first-museum-selection.md) — the works-first rule whose
  refusals this ADR gives somewhere to go
- `backend/src/controllers/experience/experienceLifecycle.ts` — where the
  reader-side predicates live
- `backend/src/services/sync/museum/artTest.ts` — the rule that refuses

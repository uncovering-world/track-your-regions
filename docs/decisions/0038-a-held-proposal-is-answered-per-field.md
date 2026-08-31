# ADR-0038: A held proposal is answered per field, and the answer is recorded by value

**Date:** 2026-08-30
**Status:** Accepted — decisions 1 and 1a narrowed by ADR-0039

---

## Context

A gated source may not overwrite what a reader can already see: the run records its proposal
and the columns keep their stored values (ADR-0025 decision 5, and since ADR-0037 a field of a
place or a work as well). Publishing is the yes. There was no no, and there was no *part* of a
yes: `POST /:id/publish` applied the whole proposal or none of it.

Measured on the development database on 2026-08-30, all three categories gated: 1486 held
cards — 1272 UNESCO sites, 199 monuments, 15 museums. The cards are not single-row. 1191 UNESCO
cards hold two fields, 62 hold three, and the mixed case is real and named: run 68 proposes six
things about **Getbol, Korean Tidal Flats (Phase II)** — dropping "(Phase II)" from the name a
reader sees, a rewritten short description for the 2026 extension, six local names, a new
photograph, the source's own data and the catalogue's own labels. **Garamba National Park**
holds a danger listing beside an inscription date. On a card like that the two answers on offer
are "all of it" and "nothing".

The one way to refuse a single field is to claim it: edit the field by hand, which puts it in
`curated_fields`, and then publish, which skips the claimed field and reports it
(`claimedFieldsSkipped`, the lever #524's 2026-08-12 comment traced). That is a different
statement from the one the curator is making. "This value is mine now" is not "I do not want
this value", and it outlives the question: the source proposing something *else* for that field
next month meets the claim rather than a curator.

The conflict card has had the other shape since #516: two versions per field, two answers on
each row, a refusal recorded **by value** in `experience_conflict_decisions` so that a source
that changes its mind is heard again. The mechanism exists; it had not been brought to the gate.

## Decision

**1. A held row is answered one row at a time, at both levels, in the conflict card's shape.**
The answer sits in its own column of `FactTable`, once per fact and spanning every table row the
fact made — a key inside the source's data is answered with the field it belongs to, never on
its own. Two buttons, neither a primary: **publish this** and **not this**. The object-level
"Publish the change" stays as the convenience it was meant to be.

**1a. A picture and its credit are one answer, at both levels.** The one place the per-row rule
is deliberately not per row, because a hosted picture carries a credit and a screen that lets the
two be answered apart produces a false statement about a real person. On a part they are two
writable fields, so `heldSelection.ts` has each name the other — at both endpoints, since a
coupling only publishing honoured would let a refusal separate what a publication cannot. On the
object the credit has no field of its own (it lives in the `metadata` catch-all), so the rule is
about one key: **the stored credit is the credit of the stored picture**. It overrules the
catch-all in three shapes — the call writes the picture, so the row takes the credit the run's
metadata row gives it; the same, where a curator has *refused* that row, so the row takes none,
since a refusal may not write the value it refused and the stored credit names a photograph
nobody will see any more; or the run offers a different picture this call is not writing, so the
row keeps what it shows and its credit with it. The refusal shape is object-only: on a part the
two are one answer, so a credit cannot be refused without its picture. Everywhere else the
catch-all decides, which is the ordinary case
rather than a corner: 1413 of the 1414 cards holding a credit hold no picture change at all, the
run having found the photographer for the picture the page already shows. A rule that fired there
would delete the credit and mark the row answered, so no later run would offer it. A claim on
`metadata.imageCredit` still wins over the rule.

**2. Refusing writes nothing, and claims nothing.** `POST /:id/decline-held` records the answer
and touches no column a reader sees — the stored value has already won every run since the gate
first held this one. It does not touch `curated_fields` either, which is the whole difference
from the lever it replaces. The mirror of `decline-source`, and its own module for the reason
that one is: the two answers to a held row are opposite acts with nothing in common but the lock.

**3. The answer is recorded by value, in a sibling table.** `experience_held_decisions`, not a
widening of `experience_conflict_decisions`:

- the two answer different questions — a conflict refusal says "my value stands over the
  source's" and presupposes a claim; a held answer is given where nobody claimed anything.
  ADR-0025's own consequence forbids collapsing two questions into one predicate;
- the readers differ — the conflict card and `accept-source` read one; the held card,
  `heldWaitingSql`, the admin panel's count, the catalogue assertions and publishing read the
  other;
- only this one has a part, since ADR-0037.

**4. Both verdicts are recorded, not only the refusal**, and that is what makes a one-field
publish possible at all. A whole-card publish clears `pending_change_sync_log_id`, which is what
takes the card away; publishing one of six leaves the pointer standing for the other five, and
the run's record still says the field it wrote was held. With no row here that card would go on
offering a value it has already applied, reading "readers see X, the run proposes Y" about a row
that says Y. Rewriting the run's record instead is not an option: what a changeset holds is what
happened (ADR-0020).

**5. A part is named the way the record names it, never by id.** `partRecord.ts` is the rule for
finding the stored row a record entry points at; this is the rule for naming the row on the card,
and they are deliberately separate — a place the source withdrew after proposing its rename still
has a card row and still needs an answer. The reference narrows and the name decides, because
nine `(experience_id, external_ref)` pairs on this database are duplicated and one point carries
no reference at all. Both halves are the record's own, which names a changed item by what it was
called *before* the run rewrote it, so they are stable for as long as the hold stands.
`UNIQUE NULLS NOT DISTINCT` is load-bearing rather than tidy: the object's own row carries three
NULLs and the referenceless point one, and under the default rule no two such rows would ever
collide, so the standing answer would become a pile and the upsert that replaces it would never
fire.

**6. The pointer clears when nothing on the card is left open.** It is what the card is keyed on,
so clearing it takes the whole card away — right for the call that answers all of it, wrong for
one that answers one row of six. Both endpoints follow the same rule. On publishing, a call that
names no selection answers the whole card, leaves nothing open and clears the pointer exactly as
every call did before; a refusal always names its rows, since "refuse nothing" is not an answer.

**7. The run goes on filing the proposal, and the read side is what stops asking.** No writer
changes: the next run holds the refused value again and records it again, because that is what
happened. The queue, the panel's count and publishing agree that a held row with a matching
answer is settled. So a pointer may name a fully-answered proposal — the same state a
fully-claimed row already reaches today.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the claim workaround and document it better | It answers a different question, and permanently: a claim is a standing statement about whose value a field is, so the source's *next*, possibly better proposal meets it too. The card already said the workaround aloud and it still read as "edit it to refuse it" |
| Widen `experience_conflict_decisions` with nullable part columns | Two questions in one predicate, which ADR-0025's consequence forbids, and four readers would have to learn which rows are theirs. The unique key differs, and a conflict refusal has no part |
| Record only refusals, and forbid publishing one row | Halves the decision the issue is about: the mixed card's whole point is that one field is right and one is wrong, and "refuse the wrong one, then publish the card" makes the common case two acts and the rare one impossible |
| Rewrite the changeset's `held` flag when a row is published | A run's record is what happened, not what is outstanding (ADR-0020). Every other reader of that record — the admin report, the counts, the provenance trail — would start reading a curator's answer as the run's own behaviour |
| Key the answer on the run rather than on the value | The next run re-proposes the same value under a new `sync_log_id`, so a run-keyed refusal would be forgotten every cycle — which is exactly the defect #516 was opened for, one gate over |
| A third endpoint answering both verdicts in one call | Publishing is a transaction with a lock, a staleness check, contents, a released withdrawal, placement and an audit row. A second implementation of it that also refuses would drift from the first |

## Consequences

**Positive:**

- The mixed card is answerable as what it is. Getbol's rewritten description can land while the
  rename waits, and *The Wine Glass* can take its new photograph — with the credit that belongs to
  it — while its attribution does not.
- A refusal is heard narrowly and forgotten deliberately: the source has to propose something
  *different* to ask again, which is the one case a curator must see.
- The queue, the admin panel's count and publishing read one predicate (`heldDecisions.ts`), so the
  number a curator sees before opening the queue and the cards they find there cannot disagree. The
  catalogue assertions read the same module, and one of them asks it a narrower question on purpose:
  `picture-with-nobody-credited` excuses a row only on a *refusal*, because publishing an object's
  `metadata` row while its picture is still open withholds the run's credit and the next click
  writes it. Sharing the module is what makes that difference a decision rather than a drift.

**Negative / Trade-offs:**

- A card that keeps its pointer keeps showing two kinds of row nothing on it can clear: a field
  the curator has claimed since the run, and a part the record names that no offered row answers
  to. Both are settled by the object-level "Publish the change", which reports them and clears
  the pointer — so there is always a way out, and it is the button that was already there.
- The answer table accumulates one row per answered field per object, and a published row's entry
  is dead weight from the moment it lands, since the stored value then equals the proposal and no
  run proposes it again. Roughly one row per held field on the catalogue; measured against 1486
  held cards of one to six fields, that is thousands, not millions.
- The admin panel's per-source count pays for the predicate, measured on the development database
  (1604 experiences, 1486 of them holding something): the median of five runs moves from 403 ms to
  472 ms, about 70 ms. It is one count behind `requireAdmin`, on no reader's path and in no
  performance lane, and the alternative is a panel whose number disagrees with the queue it sends
  a curator to.
- A refused danger flag is a permanent disagreement between `tags` and `metadata.inDanger`, and
  the catalogue check now reports it rather than excusing it. That is the honest reading: no card
  will come round to fix it, and a curator's edit is the remedy.

## References

- Extends: [ADR-0025](0025-per-source-curation-gate.md) decision 5 — the gate holds; this is how
  a person answers one thing it is holding
- Extends: [ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) decision 6 — the
  card shows a part's held fields; each of them is now answerable on its own
- Related: [ADR-0026](0026-a-run-records-what-a-container-holds.md) decision 4 — items are named,
  never identified, which is why an answer names a part the way the record does;
  [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) — the changeset is a record of what
  happened, which is why an answer is stored beside it rather than written into it
- Related docs: `docs/tech/experiences.md` § Publishing, § The gate's own three kinds
- Issues #722, #524 (its fourth point — what declining a held field means — is answered here),
  #516 (the conflict card's refusal, the mechanism reused)

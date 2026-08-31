# ADR-0039: A run records facts, not columns

**Status**: Accepted
**Date**: 2026-08-31
**Issue**: [#725](https://github.com/uncovering-world/track-your-regions/issues/725)
**Narrows**: ADR-0038 decisions 1 and 1a — a key inside the source's data is no longer
"answered with the field it belongs to, never on its own", and the object's credit is no
longer a key with no field of its own, so the refusal shape 1a calls object-only is
reachable only on a card filed before this. The rest of ADR-0038 stands: an answer is
still per field and still recorded by value.

## Context

ADR-0038 decided that a held proposal is answered **per field**. It did not say what a
field is, and the answer turned out to be "whatever `experience_sync_changes` happens to
carry as one entry" — which is a shape decided by the columns the writer diffs, not by
what a curator is being asked.

`metadata` is one jsonb column, so `metadataChanges` reported it in three parts: the keys
a product decision hangs on (`inDanger`, `dateInscribed`), the keys a curator had claimed
individually, and one catch-all entry for everything else. The card then re-split the
catch-all to be readable (`objectDiff.changedKeys`), naming each key with the vocabulary —
but the *answer* stayed addressed to the entry.

So the Bamiyan Valley card named three facts and offered two answers. `in danger` had its
own buttons only because #600 gave it its own entry when the badge was repaired;
`inscription criteria` and `picture credit` shared a pair because they shared a column.
Measured on the development catalogue: **1227 of the 1484 held cards folded two or more
facts into one answer**, and the two keys that dominate are exactly those two —
`imageCredit` on 1414 cards, `criteria` on 1272.

The asymmetry that showed it was arbitrary: on a **work**, a picture credit is a field of
its own and is answered together with its picture (ADR-0037, the pairing now in `partnerOf`). On the
**object**, the same fact could not be answered at all on its own — and that is the gap
`creditPin` exists to survive, where refusing the source's data and then publishing the
picture puts a photograph on the site under nobody's name.

## Decision

1. **A run records every metadata key that differs as its own entry**, except the ones it owns. The three buckets
   collapse into one rule — a key is a fact and names itself, `metadata.<key>` — with
   `MAJOR_METADATA_KEYS` deciding only significance and `SYNC_OWNED_METADATA_KEYS` still
   reported nowhere. The stripping the catch-all needed goes with it (#488): with one key
   per entry there is no shared payload for a claimed value to leak into.

2. **A claim's reach is answered by the code that can see the stored row**, not by a
   field name. A claim on the whole `metadata` column protects every key under it, which
   no per-key name matches; a per-key claim the stored row can no longer honour protects
   nothing, because the upsert only re-applies a claimed key while
   `experiences.metadata ? claimed.k`. `RawDiff.protectedByClaim` carries that answer — for
   *protection*. It says nothing about **addressability**, and the whole-column arm loses that:
   the per-key conflicts such a claim now raises carry no name any reader can resolve back to it,
   so they are protected and asked nowhere. Unreachable today and tracked as #729.

3. **The object's picture and its credit are one answer**, as a work's already were. The
   pairing is level-aware because the two levels spell the picture differently — the
   object's changeset field is `imageUrl`, a part's is its column `image_url`.

4. **Records already written are not rewritten.** A changeset is what happened (#480) and
   this repository says so where it matters most (`heldDecisions.ts`: "the run's record is
   never rewritten to say otherwise"). There is a second, harder reason: an answer is
   stored against a field name and a value, so reshaping stored proposals would silently
   un-answer every decision recorded against the old name. Cards from earlier runs keep
   their shape until a run re-proposes, and both readers of a credit — the named entry and
   the catch-all's key — stay live.

## Consequences

- Every fact on a held card carries its own two answers. A curator can take UNESCO's
  inscription criteria and refuse a credit reading "© UNESCO" over a photograph somebody
  else took.
- The card stops re-splitting the catch-all for new records: an entry is already a fact, so
  the answer cell spans one row. **Every spanning answer left on the card is this same defect
  somewhere else**, not a case worth keeping — measured on the development catalogue, the only
  object-shaped held entries are `metadata.imageCredit` and `location`, which the vocabulary
  renders whole and which therefore make one row each; a catch-all filed before this, kept
  alive because a changeset is never rewritten; and a language map, deferred as #728. Where one
  does span, the cell now says how many rows it answers — the fallback this decision rejects as
  a *sufficient* fix, doing the job it can still do until those two are gone.
- `creditPin` reads both record shapes and keeps its purpose only for the object, where a
  picture can land while the run's own credit entry drops the key — not where the run
  is silent about the credit, which is it asserting the stored one.
- **No counter a run reports moves** — a publication's own reply is a different thing, below. All three things called `held` count rows, not
  entries, and they keep meaning that: `wasHeld` is `heldFields.length > 0` and
  `progress.held` increments once per object, `waitingCounts.held` is a `COUNT(*)` over
  `experiences`, and `total_held`'s own column comment says "the row counted again". One
  catch-all and six per-key entries answer `length > 0` alike. What grows is the number of
  entries on a card — `changed_fields`, and `heldLeftOpen`, which is what a curator reads as
  "N still waiting on this card". `heldLeftOpen` is not a counter a run reports: no run produces
  it, a publication does, and it is about one card rather than a pass. Naming the counter here would
  have had an admin expect `total_held` to jump on the first run after this and find 1272
  unchanged, or a maintainer reconcile it and break the `total_unchanged ⊇ total_held`
  relation that comment and migration 038 rest on.
- A curator's old answer against a catch-all will not match the per-key rows a later run
  files. Nothing is lost on this catalogue — `experience_held_decisions` held 0 rows when
  this landed — but the general shape is that a finer question is asked again rather than
  assumed answered, which is the safe direction.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Fan the catch-all out on **read**, leaving the writer alone | The queue builds `proposed` by filtering changeset entries in SQL (`reviewQueueController.ts`), so a partly-answered catch-all would have to be rewritten mid-query, and the "does this field split" rule would need a third copy in SQL beside the client's `saidWhole` and a backend mirror |
| A migration reshaping the 1484 stored proposals | Rewrites provenance, and — decisively — orphans every answer already recorded against the old field name and value |
| Answer per key at the API only, keeping the stored shape | The predicate four readers share compares a decision against an entry's whole value; per-key answers would make "is this entry open" a different question for every reader |
| Say on the card that two rows share one answer | Explains the defect instead of removing it. The maintainer's reading of the screen was that granularity *is* curation, not a convenience |

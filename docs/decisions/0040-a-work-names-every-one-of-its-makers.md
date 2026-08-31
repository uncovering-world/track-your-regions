# ADR-0040: A work names every one of its makers

**Status**: Accepted
**Date**: 2026-08-31
**Issue**: [#720](https://github.com/uncovering-world/track-your-regions/issues/720)

## Context

`treasures.artist` was one `VARCHAR(500)` and `experiences.metadata.creator` one string,
and both sources routinely name more than one person. Measured against Wikidata on
2026-08-31, over the whole stored catalogue:

| | rows with a creator | rows with **more than one** |
|---|---|---|
| `treasures` (museum works) | 1232 of 1346 | **30** — 23×2, 5×3, 1×5, 1×6 |
| public art (`metadata.creator`) | 83 of 204 | **19** — 14×2, 2×3, 1×4, 1×6, 1×7 |

Which of them the catalogue held was an accident. The museum pool query carries five
`OPTIONAL`s, so a work with two makers and two images arrives as four rows, and the parse
kept the first; `bindingsToLandmarks` was worse, pushing one landmark per binding row so
that a monument's duplicates raced each other into the same row. A traveller standing in
front of *Morning in a Pine Forest* was told Konstantin Savitsky, who painted the bears,
and not Ivan Shishkin, who painted the forest.

It was also a live cost. Museum run 64 rewrote the attribution of 22 works, and **every
one of the 22 is a multi-creator work** — Shishkin to Savitsky, Bellini to Titian, Hals to
Codde, Athanadoros to Polydoros. Under the curation gate (ADR-0037) each of those waits on
a card, so the queue was asking curators to choose between two orderings of the same fact.

The makers are **already in the answer**: no second query, no entity-API fetch, is needed
to collect them.

**The order is not.** SPARQL exposes no statement order at all — Wikidata's RDF simply
does not carry it — so any order a query answers in is a property of the query plan.
Measured on 2026-08-31 against the cached answers of a real run, the banded pool query
(`hint:optimizer "None"`, `hint:Prior hint:rangeSafe true`) returns the creators in
**reverse** statement order, on every one of eight multi-creator works sampled:

| work | statement order | what the band answers |
|---|---|---|
| Morning in a Pine Forest | Shishkin, Savitsky | Savitsky, Shishkin |
| Laocoön and His Sons | Athanadoros, Agesander, Polydoros | Polydoros, Agesander, Athanadoros |
| Moon Museum | Warhol … Novros | Novros … Warhol |
| The Baptism of Christ | Leonardo, Verrocchio | Verrocchio, Leonardo |
| Borghese Gladiator | Agasias, Cordier | Cordier, Agasias |

That reversal is also the whole of run 64's churn: the old parse kept the first row, which
is the *last* statement, which is why it moved Shishkin to Savitsky and Fra Angelico to
Filippo Lippi.

And the run contradicts itself. The narrow-class pool carries no optimizer hint and an
`ORDER BY`, and it answers in statement order — read back from the same run's cache, *The
Baptism of Constantine* comes out Raphael, Giulio Romano, Penni, exactly as Wikidata states
it, while the banded queries beside it come out backwards. **So a work's stored order would
depend on which query happened to find it.** That is the argument: the order is the
planner's, and agreeing with the source on one query shape is a coincidence rather than a
contract.

## Decision

1. **A work stores every maker the source names.**
   `treasures.artists VARCHAR(500)[] NOT NULL DEFAULT '{}'`, and public art's
   `metadata.creators` as a JSON array. NOT NULL with an empty default rather than
   nullable: "no maker recorded" is 114 works and 121 monuments, and a second shape for it
   would put a `COALESCE` in front of every read.

2. **The catalogue asserts no order until a curator does.** The list is stored in the
   order the answer arrived in — deduped by creator entity and by folded label, since
   Q2415079 (*The Washington Family*) names Edward Savage twice under two entities — and
   that order is *storage*, not a claim. Nothing sorts it either: alphabetising would make
   an order ours, and reversing the band would encode a query planner's behaviour as a
   rule.

   Who leads a collaboration is a judgement, and it is a curator's. `PATCH
   /api/experiences/:id/works/:treasureId/edit` writes `artists` in the order given and
   claims the column, so a later run cannot reorder it (decision 6), and Catalogue Checks
   carries a `watch` counting the works that name several makers in an order nobody has
   confirmed. A question a person can answer, rather than a guess the importer makes.

3. **The diff compares the makers as a set, and the writer's guard asks the same
   question — the same one, not a second one that agrees most of the time.** Both levels:
   `workChanges` for a work and `metadataChanges` for a monument's `metadata.creators`,
   through one folded comparison, so the two cannot disagree about whether two lists name
   the same people. A run that restates the same people in another order reports nothing
   *and*, for a work, writes nothing: `sameLabelSet` is evaluated once in TypeScript and
   bound into the upsert as a boolean, rather than written a second time as SQL. Array
   containment was the obvious shape and is the wrong one — it compares byte for byte
   where the fold normalises case, dashes and whitespace, so a maker whose label gains a
   typographic edit *and* moves position would be reported as no change and written
   anyway. Postgres cannot fold the same way without ICU, so an SQL copy would have been a
   weaker second rule. Without the write half the record would say nothing changed while
   the row changed underneath it, which is the failure ADR-0037's RETURNING exists to
   prevent one level up. A name added or dropped is a real change and is reported `major`,
   as `artist` was.

4. **The field is named for what it is on both sides of the wire.** For a work: the column
   is `artists`, the JSON key is `artists`, the claim key is `artists`. For a monument the
   fact lives in `metadata`, so it is `metadata.creators` throughout — the key, the claim
   and the changeset entry — and the two names are the two vocabularies decision 1 keeps
   apart, not a slip; unifying them is #574's. The card's word for either is *attribution*
   — number-neutral, and the word the catalogue's own sources use. A key named for one
   thing that carries several is the storage shape showing through onto the screen (#725),
   which every surface downstream then has to undo.

5. **A dense row leads with a name only where a curator put it there.** Two makers are
   given whole either way — 23 of the 30 multi-maker works have exactly two, and "A and B"
   claims nothing about which of them leads. Past two, a row with one line reads "6
   artists" while the order is unconfirmed and "Andy Warhol and 5 others" once a curator
   has claimed the column: leading with a name is a claim about primacy, and it is only
   true when somebody made it. Surfaces with room (`creators`) name them all in the stored
   order regardless. One module, because a work reading "Shishkin, Savitsky" on a tile and
   "Shishkin and Savitsky" on the card beside it is the catalogue disagreeing with itself
   about a fact.

6. **A curator can correct a work's attribution.**
   `PATCH /api/experiences/:id/works/:treasureId/edit` claims what it writes, so a later
   run cannot take it back. The museum is in the path because a work hangs in more than one
   and carries no scope of its own; the reach that follows — a correction made from one
   museum is what every museum holding the work shows — is ADR-0025 decision 2's, not this
   endpoint's. `image_url` is claimable and deliberately not writable here: a hosted picture
   carries a credit, and writing a URL without answering for whose photograph it is would
   print one photographer's name under another's work.

7. **Stored records move with the column, and the audit trail does not.** Migration 040
   converts the claims, the change records and the answers to those records together,
   because their match is the field name and the value at once and a half-converted set is
   worse than either end of it. `experience_curation_log` is left alone: it records what a
   curator did and what the field was called when they did it.

## Consequences

- The 22 rewrites stop being questions. What remains on those works is what was never an
  ordering — *Borghese Gladiator* naming Nicolas Cordier, who restored an arm, where
  Agasias of Ephesus carved it; *Salvator Mundi* reading "Leonardeschi" — and decision 6
  is where a curator answers it.
- Blank-node filtering on the landmark queries becomes load-bearing. Six rows of the
  sculpture query carry a `.well-known/genid/…` creator; none reached the database because
  they lost the race to a real name, and collecting every creator is exactly what would
  stop them losing it.
- Public art needed the fix in **two** places, not one, and the second was only visible in
  the data. `bindingsToLandmarks` groups by item, which is what the sculpture path needed;
  the monument path collects across four type queries into a map that kept the *first* row
  per item, so the grouping had nothing left to group. Measured on the run that found it:
  of 17 monuments proposing creators, the 15 that also instance `sculpture` came through
  `fetchSculptures` and 9 of those named several people, while the 2 that only ever arrive
  through `fetchMonuments` named one each. The map now keeps every row and still makes one
  monument of an item two type queries both offer.
- The landmark queries' `LIMIT` counts *solution rows* and not monuments — 130 rows for 80
  items, 134 for 93 against a `LIMIT 160` — and grouping by item does **not** change that:
  the grouping is ours, in `bindingsToLandmarks`, while the cap is the endpoint's. What it
  changes is that the duplicates no longer each become a landmark to process and to race
  its twins into a row. Moving the cap onto distinct items would need the `LIMIT` inside a
  `SELECT DISTINCT ?item` subquery with the OPTIONALs outside it, and these queries have no
  truncation check of their own — the museum pool's `failIfTruncated` has no counterpart
  here, so a sculpture query that came back at exactly 300 rows would truncate in silence.
  Both are left as they are and recorded: no monument is lost at today's volumes.
- `metadata.creators` is still shown to no reader (`UNSEEN_BY_READERS`). Storing every
  maker is correct there regardless — the curation card asks about it — but the traveller-
  facing half of a monument's attribution is #574's to deliver.
- **The keep-the-stored-order arm is a work's only**, and that asymmetry is deliberate
  rather than an omission. A work's upsert writes `artists` as a column, so it can keep
  what is stored when the answer is the same people; the landmark upsert replaces
  `metadata` as one object, so a monument's stored order follows whatever the last run
  answered. Nothing is *recorded* as changed either way — decision 3 covers both — and
  nothing is *shown*, so a reordering that reaches the row reaches nobody. When #574 puts
  a monument's makers on a screen, that stops being true and the works arm is the pattern
  to copy: the question is already computed in the same place, one level up.
- A work's makers are one fact of a work and not an entity: there is no `people` table and
  this does not propose one. "Fonderie Hébrard", co-creator of *The Thinker*, is a foundry
  and would not belong in one.

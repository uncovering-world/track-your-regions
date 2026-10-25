# ADR-0150: Wikidata's part-of answers a near pair

**Date:** 2026-10-25
**Status:** Accepted
**Issue:** [#1991](https://github.com/uncovering-world/track-your-regions/issues/1991)

---

## Context

The pairing pass proposes two near places with similar names as a question for a curator (#1249,
ADR-0046 decisions 2 to 4). The curator answers *one place*, *two places* or *part of*, which
records which of the two is the part and merges nothing. A pair is a match by place and name, not a
fact, so until now every pair waited for a curator.

Many pairs are a whole and something inside it, and Wikidata often says so already. Matera's World
Heritage site, "The Sassi and the Park of the Rupestrian Churches of Matera", has the item
Q55739617. The Sassi di Matera, a place of worship row 200 m off, has the item Q2350404, which states
P361 "part of" Q55739617; the site's item states P527 "has part" back.

Measured on the development catalogue on 2026-10-25:
- The catalogue held 72 proposals, 26 of them open.
- A rolled-back run of the rule below answered 13 of the 26 open pairs. Each was a true part read
  as a traveller would: Saint Catherine Monastery, Machu Picchu, the Church of the Nativity,
  Westminster Abbey, St Margaret's Church, Florence Cathedral, Haeinsa, Tikal, the Palace of Mafra,
  Diocletian's Palace, the Bremen Roland, Vilnius Cathedral and the Mosque-Cathedral of Cordoba.
- None of the 13 pairs left open had a P361 or P527 statement between the two places' items. Two
  had only P276 "location": the Florence Baptistery and Salzburg Cathedral toward their historic
  centres.

## Decision

**1. A statement between the two places' own items answers the pair *part of*.** The pass answers
an open pair when one place's item states P361 "part of" toward the other's, or the other's states
P527 "has part" toward it. The item is the part the statement names. The rule reads:
- each place's Wikidata items that claim its identity (`place_identifiers`, `claims_identity`);
- the best-ranked statements in the local Wikidata subset (`wikidata_claims`, ADR-0105), never a
  deprecated one.

It is asked, not answered, when:
- the statements name each place as the part of the other;
- the two items are tied only by P276 "location", or by nothing;
- the subset holds no statement for them, or is absent;
- a curator took the pair's answer back (decision 4).

The pass answers right after it pairs (`answerFromWikidata` in `mergeProposalFinder.ts`), inside
the drain's transaction. It skips a pair a curator is answering at that moment, which holds the
pair's advisory lock. A curator's answer is never rewritten.

**2. The answer records what it rests on.** The proposal's `answered_by` is null and
`answered_by_catalogue` marks it, as ADR-0141 does for a component's item, since a deleted
curator's answer is null too. `answer_statement` holds the statement: `{property, subject, value}`.
Where both P361 and P527 state the relation, P361 is the one recorded. Schema checks hold the three
columns to each other: a catalogue answer is *part of*, names no curator and carries its statement.

**3. The history tells it from a curator's.** The `merge_proposal_answered` row names no curator,
and its details carry `catalogue: 'wikidata'` and the statement. The history shows it as *The
catalogue — Wikidata*, with the statement in words beside its ids. The curator check on the log
admits that action without a curator (migration 173).

**4. A curator takes back a *part of* or a *two places*.** A history row of either answer offers
*Take back this answer*, whether the pass gave it or a curator did
(`POST /api/experiences/:id/merge-proposals/:proposalId/take-back`). The pair is open again, on the
review queue, and `taken_back_at` marks it, so the pass never answers it from Wikidata again; only a
curator can. The take-back is its own act in the history, `merge_proposal_taken_back`. *One place*
is not taken back this way: its merge is undone from the history (ADR-0086), which opens the pair
with it.

**5. No migration answers the pairs already open.** The rule reads the subset, a workbench table a
migration does not depend on. The pairing rule's version moves to 3, so the first drain after the
deploy pairs the whole catalogue again and answers what Wikidata answers: 13 pairs on dev.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep asking, and show the statement on the card | Every pair measured with such a statement was a true part. The question costs a curator's time for an answer the catalogue already holds. |
| Accept P276 "location" too | P276 says where a thing stands, not what it belongs to: a museum is located in a park it is no part of. The Florence Baptistery, which states only P276, stays a question a curator answers in one click. |
| Read every item a place carries, its components' included | A serial site's component items refer to the site without being it. A statement about one of them is not a statement about the place. |
| Merge the two places as one | A part is not the place it is part of. *Part of* merges nothing (ADR-0046 decision 6). |
| Ask Wikidata live, in the pass | The pass runs after every run. Its reads go to the local subset (ADR-0105). |

## Consequences

**Positive:**
- On dev, 13 of the 26 open pairs leave the review queue with the next drain, each with the
  statement that answered it. The queue keeps the pairs a curator has to read.
- A curator who disagrees with an answer, the catalogue's or another curator's, takes it back from
  the place's history, and the pass does not answer it again.

**Negative:**
- An answer is only as right as Wikidata's statement. A wrong P361 answers a pair wrongly until a
  curator takes it back.
- The pass forgets an open pair the rule no longer finds, such as one whose point moved out of
  reach. A pair taken back and then forgotten loses its mark. Proposed again later, it can be
  answered from Wikidata again.

**Neutral:**
- The answers curators already gave stand, even where Wikidata states the opposite. On dev, 23
  pairs answered *two places* in one batch on 2026-10-25 include several that Wikidata reads as
  parts, such as the Leaning Tower in Pisa's cathedral square. Reopening them is a curator's call,
  made from each place's history.

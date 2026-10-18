# ADR-0120: A near pair is also asked about when one name's words all stand in the other's

**Date:** 2026-10-18
**Status:** Accepted

---

## Context

ADR-0046 decision 2 names two universal signals that two rows are one place. An equal Wikidata
item merges. Nearness together with a trigram name similarity of 0.5 produces a proposal for a
curator. Decision 3 closes the list: "this ADR fixes the two universal signals and the rule that
the rest are per kind". Distance alone proposes nothing, because "within a historic centre
everything is within 300 m of something".

The similarity line misses a whole class of pair: a short name inside a long World Heritage
title. The Monastery of Geghard is two entries 7 m apart, the property *Monastery of Geghard and
the Upper Azat Valley* and the place of worship *Geghard*, and their names are 0.17 alike. Their
Wikidata items differ, so the equal-item merge does not reach them either. No curator was asked
what the two are (#1652).

Measured on the development catalogue on 2026-10-17, over places admitted to some kind, not
sharing a kind and within 300 m, 54 pairs had every significant word of one name standing in the
other's and failed the similarity line. Most were a property and the monument inside it.

## Decision

**A third universal signal proposes a pair: within the pair's reach, every significant word of
one of a place's folded names stands in one of the other's.** It is a proposal, under the same
gate, the same reach and the same exclusions as the similarity signal, and the proposal records
which signal found it (`experience_merge_proposals.found_by`).

A significant word is a word of three letters or more that is not in `GENERIC_NAME_WORDS`
(`mergeProposalFinder.ts`). That list holds connectives, the words that say what kind of place a
name is, the words a World Heritage title adds around a place's name, and a church's saint
words. A name left with no significant word matches nothing.

ADR-0046 decision 2 is narrowed to three universal signals. Decision 3's closing rule stands
otherwise: every further signal is a kind's own.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lower the similarity line | Geghard reads 0.17. A line that low proposes most neighbours in a historic centre, which is the distance-alone signal decision 2 refused. |
| A kind's own signal (decision 3) | The class is not a kind's. It joins World Heritage to Places of worship, Art Museums, Public Art and Archaeology alike. |
| Refuse a match where the contained side has one word and the other is a World Heritage property | It refuses Geghard, Córdoba, Bath, Toledo and most of the pairs the rule exists for. |
| Refuse a word that names three or more offered places within reach, as a town's name | Measured on the 43 pairs, it refuses Florence Cathedral and the Florence Baptistery, both parts of the Historic Centre of Florence. It keeps Museum Ulm and Ulm Minster, two places whose town word names only them. |

## Consequences

**Positive:**
- The class is asked about. Of the 54 pairs of 2026-10-17, measured again on 2026-10-18, the
  rule proposes 29. The other 25 now involve a World Heritage row with component parts (#1422).
  The pass leaves those to #1250 by an existing rule, so none is missed by the new signal.
- On the development catalogue on 2026-10-18 the rule proposes 43 pairs across kinds. A
  traveller reads 39 of them as a real question: one place, such as Tikal or the Minaret of Jam,
  or a part of the other, such as Florence Cathedral in the Historic Centre of Florence.

**Negative / Trade-offs:**
- Four of the 43 are two places that share only a town's name: the Bremen Roland and Bremen
  Cathedral, the Bremen Town Hall property and the cathedral, Museum Ulm and Ulm Minster, and
  Museumsinsel and Berlin Cathedral. A curator answers *two places* once, and the answer is kept.
- A property named for its town meets every place named for the town within its reach. These are
  mostly *part of* answers: a curator records the relation, and the question is asked once.

## References

- Related ADRs: ADR-0046 (decisions 2 and 3, narrowed here), ADR-0086 (a pair in one kind is
  left apart), ADR-0100 (a serial site's components are places)
- Related docs: `docs/tech/experiences.md` § Review Queue, *Near places with similar names*
- PR / issue: #1652, #1249

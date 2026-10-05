# ADR-0084: A place belongs to no source and no kind

**Date:** 2026-10-04
**Status:** Accepted — decision 4 narrowed by [ADR-0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md)
**Issue:** [#1244](https://github.com/uncovering-world/track-your-regions/issues/1244), Epic [#755](https://github.com/uncovering-world/track-your-regions/issues/755)
**Narrows:** [ADR-0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) decision 4, the wording of [ADR-0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md) decision 5

---

## Context

ADR-0045 split a place from its membership in a kind, and ADR-0046 decided how two rows are
recognised as one place. Neither said who the place belongs to once it is one, and the schema
still answers "the source that wrote the row". `experiences` is keyed by
`UNIQUE(source_id, external_id)`; every run finds its rows by that pair (`lockSourcedExperience`,
the upsert's `ON CONFLICT`, the admission sweep, missing detection); `experiences.type` holds one
type per place; whether a source still lists a place, and when it last saw it, are columns of the
place; points and work links record no source at all.

On the development catalogue on 2026-10-04, 155 pairs of rows from different sources share a
Wikidata item, and Epic #755 folds each pair into one place. The Louvre is the plain case: an Art
Museums row linking 125 works and an Archaeology row linking 29 finds. Folded under today's
schema, the Archaeology run would no longer find its own row by `(5, Q19675)`, the admission sweep
would refuse its membership on every run because it compares its id with the place's, and the two
runs would mark each other's works missing night after night. The Pantheon shows the type half:
it is a church as a place of worship and a site as archaeology, and one column holds one of the
two.

Two ways out were on the table in the product review of 2026-10-04. One keeps a primary kind per
place: the source with the highest `display_priority` owns the place's content, its kind colours
the pin, and the second kind is an addition to it. The other makes the place nobody's. The
maintainer took the second: a traveller standing at the Pantheon is not standing at a church that
also happens to be archaeology, and the list, the pin and the card should not say so either.

## Decision

**1. A place belongs to no source and to no kind.** It is an identity of its own: its name,
description, picture, coordinate or points, and the visits recorded on it. Kinds are properties
hung on it, and none of them is the primary one.

**2. A membership carries everything one kind's source says about the place.** The id the source
knows it by, unique per source; whether the source still lists it and when it last saw it; the
points and works the source placed; the type within the kind; the admission, the badge and the gate
state, which ADR-0045 already put there. A run reaches its places only through its own
memberships, and writes, withdraws and marks only what its own membership carries.

**3. The place's own `source_id` and `external_id` are provenance.** They name the source that
first brought the row and the id it brought it under, and nothing arbitrates on them: no run finds
a place by them, and no reader may treat them as the place's kind.

**4. No source owns the place's content.** Each source's view of the name, the picture and the
coordinate is recorded on its membership. While the sources agree, the place carries their value.
Where they disagree, a curator decides through the review queue, instead of the last run to write
winning (#1246).

**5. A reader shows every kind of a place as an equal.** The place has a card in each kind's list,
one pin that shows all of its kinds or the filtered kind's colour, and the works inside it grouped
by the kind that brought them (#1245).

ADR-0045 decision 4 is narrowed: the type it left on the place is a membership's. ADR-0046
decision 5 keeps its rule and loses one word's implication: the "surviving place" of a merge is the
row that stays physically, with no kind or source of its own, and which row that is decides nothing
a reader sees.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A primary kind per place, chosen by the sources' `display_priority` | It answers the content question without a curator, but it makes the Pantheon a church with archaeology attached and the Capitoline Museums an art museum with finds attached. The pin's colour, the card's chip and the list a click opens in would all follow a ranking of sources that a traveller never chose. |
| Keep the source's key on the place and give the merged place an alias table of `(source_id, external_id)` pairs | It finds the place again, but the type, the missing mark and the work links would still be one per place, so the alias would answer the first question and leave the other three to collide. The membership already exists, one per kind, and is where each source's half belongs. |
| One place per source, related by a "same as" link the readers follow | It keeps two pins under one label. ADR-0046 rejected it as the bug #755 reports. |

## Consequences

**Positive:**
- A merge (#1247) moves memberships, and with them everything a source said, from one place to
  another; nothing about the source stays behind on the row that is folded.
- A run's footprint is its own memberships, so two sources on one place cannot undo each other's
  writes, and a second source of one kind (#628) finds its places the same way.
- The type, the badge and the admission of a place in two kinds can each be right in both.

**Negative / Trade-offs:**
- The move is four slices of schema and writer work before the merge can run: the id (#1244),
  whether the source still lists the place (#1251), the points and links it placed (#1252), and the
  type (#1253).
- The place's content needs a curator wherever two sources disagree. On the 155 pairs that share a
  Wikidata item the names and descriptions agree, the pictures differ on 4 and the coordinates by
  more than 10 m on 2; World Heritage, whose names are UNESCO's own, will raise more.
- The pin of a place in several kinds has no single colour, and its drawing is a design question
  for #1245.

## References

- Related ADRs: ADR-0045 (kind, source, place, membership), ADR-0046 (identity and merge),
  ADR-0024 (admission), ADR-0025 (the gate), ADR-0069 (closed lists of writers)
- Related docs: `docs/tech/experiences.md` § Kinds and sources, § The place and its memberships
- PR / issue: #1244; Epic #755 and its slices #1245, #1246, #1247, #1251, #1252, #1253

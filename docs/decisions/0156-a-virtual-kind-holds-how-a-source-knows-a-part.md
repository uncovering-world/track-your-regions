# ADR-0156: A virtual kind holds how a source knows a part

**Date:** 2026-10-27
**Status:** Accepted
**Issue:** [#1426](https://github.com/uncovering-world/track-your-regions/issues/1426)
**Narrows:** [ADR-0100](0100-a-serial-sites-components-are-places-part-of-the-site.md) decisions 2 and 3

---

## Context

ADR-0100 made each component of a serial World Heritage site a place, part of the site. Decision 3
moves what a component has onto the part place: its picture, credit, description, article,
Wikidata item and the curator's claims. Migration 094 (2026-10-13) moved only the component's point.
Everything else stayed on that point. On the development catalogue on 2026-10-27:

- Beffroi de Mons (part 37725, one of the 56 parts of the Belfries of Belgium and France, 427) has
  no picture, description or item on its own row. Its point 8330 holds all three, Q1850707 among
  them. Over all 5,710 parts, the points hold 1,921 pictures, 3,677 descriptions and 3,956 items.
  The part rows hold 188 pictures and 3 descriptions, all of them on parts merged with another
  kind's place.
- `part_follows_point()` copies the point's name and coordinate onto the part. The readers in
  `db/placePoints.ts` fall back from the point to the part (`pointPictureSql`, `pointArticleSql`,
  `pointNameSql`). #1946 and #1924 were defects at that seam.
- Since #2061 the component point is UNESCO's view of the part (`placeViewsSql`): the name and
  coordinate the World Heritage list gives the component. A kind's run that reaches the part is
  contested by that view.

An ordinary place keeps none of this on a point. Its own fields are on its row. How each source
knows it and what that source says about it are on the source's membership: the id it knows the
place by (`external_id`), its items (`wikidata_items`) and its view (`reported_*`). A part has no
membership, because ADR-0100 decision 2 keeps it out of the site's kind. Otherwise every list,
count and traveller's progress of World Heritage Sites would read the 56 belfries as 56 sites.
So the part's equivalent of a membership was spread over its point, its relation and a trigger.

## Decision

1. **A kind may be virtual.** `experience_kinds.is_virtual` (default false) marks a kind that
   records how a source knows a place, and offers none. A membership of a virtual kind never
   makes its place offered: `membershipOfferedSql` and every other predicate in `db/membership.ts`
   that asks whether a place is offered, admitted or visible leave it out, so no list, count,
   search, filter, map, kind chip or progress reads it. Every read that enumerates kinds (the
   kinds a reader may browse, the admin panel's kinds, the coverage register) leaves out a
   virtual kind too. A part is still offered only through its whole (`partOfferedSql`), or
   through another kind it holds.
2. **World Heritage components is a virtual kind.** It is filled by its own source, which the
   World Heritage run writes in the same pass as the site's membership, as the grouped Wikidata
   pass writes several sources. Every part of a serial site holds one membership in it. The
   membership belongs to the part's relation: it is written when a component becomes a part, moved
   when a merge or its undo moves the relation, and dropped with the place's last relation. A place
   that is a component of two sites holds one, keyed by its earliest relation. It holds:
   - `external_id` names the part's relation (`component:<experience_parts.id>`). The list's own
     reference is not unique, so it cannot be the key: on the development catalogue on 2026-10-27,
     119 references named two parts each. Western Tien-Shan renumbered its components, and
     Phong Nha-Ke Bang and Hin Nam No share `951ter-001`;
   - `wikidata_items` is the component's item (Q1850707 for the Belfry of Mons), read as P757 is
     read today;
   - `reported_*` is UNESCO's view of the part: the name and coordinate the list gives the
     component, and the picture, credit and article its item has.

   The part's relation (`experience_parts`) keeps the whole, the part, the site's membership, the
   reason and the component's reference (Mons: `943-029`). The point's copy of the reference goes.
3. **A part's own fields are its row's, written as any place's are.** Its name, picture, credit,
   description and article are on the part row. The run writes them from its view under the rules
   every place's fields follow: claims, contested fields (`contestedFields`) and the gate. The
   point holds only where the part stands and the bookkeeping of a point (placements, missing,
   state, the curator's verdicts on it). `part_follows_point()`, `follow_component_site()`, the
   point's content columns and the fallbacks in `db/placePoints.ts` are deleted.
4. **The curator is asked as today.** A part's arrival, withdrawal and refusal are asked about its
   point. A change UNESCO proposes to a part's fields is asked as a row on the site's card. That
   is the maintainer's answer of 2026-10-26, recorded on #1426. A component membership carries no gate
   of its own: it is never pending and opens no card.

This narrows ADR-0100 decision 2: a part holds a membership, in a virtual kind and never in the
site's kind. It narrows decision 3: the item and the source's view are on that membership, and the
part's own fields are on its row.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A membership of the site's kind (World Heritage Sites) on each part | Every list, count, filter and progress of the kind would read the 5,710 parts as sites, unless each reader learnt to skip them. ADR-0100 decision 2 refused this. |
| The item on the relation (`experience_parts`), the content on the part row | Smaller, but the relation would become a second, part-only kind of membership. The view (#2061), the claims and the run's lookups would keep a path no other place has. |
| The item and the view stay on the point | The point would keep saying what the part is as well as where it stands, and the copy trigger and the fallback readers would stay. |

## Consequences

**Positive:**
- A part reads, is written and is identified by the code every place uses. The copy trigger,
  the fallback readers and the component arm of `placeViewsSql` go.
- The identifier registry reads a part's item from a membership, as for every place. The point arm
  of `place_identifier_claims` goes.
- A later kind of part (the Neues Museum on Museum Island, a monument on Red Square) has a model to
  follow.

**Negative / Trade-offs:**
- Every reader that enumerates kinds or memberships has to leave out a virtual kind. A miss
  shows parts as a kind of their own. The predicates in `db/membership.ts` are the one place this
  is stated. A database test asserts that no reader-facing list or count changes when the
  component memberships are written.
- A migration writes one membership per part, 5,710 on the development catalogue, and the World
  Heritage run gains a second source to write.
- The source has no run of its own: the World Heritage run writes it, so the admin panel gives it
  no card.

## Amendments

- 2026-10-27, before acceptance: decision 2 keys the membership by the relation rather than by the
  component's reference, after a measurement on the development catalogue found references that
  name two parts. The reference stays on the relation. Decision 1 names the column
  `experience_kinds.is_virtual`, the name the schema uses, and the consequences say the source has
  no card in the admin panel, as `getSources` reads it. Decision 2 says a place of two sites holds
  one record, keyed by its earliest relation, after the review found a part could lose its record
  with the relation that owned it.

## References

- Related ADRs: ADR-0084, ADR-0088, ADR-0095, ADR-0100, ADR-0143, ADR-0153
- Related docs: `docs/tech/experiences.md` § A part reads as a place, § A serial site's components are places
- Issue: #1426, Epic #1422

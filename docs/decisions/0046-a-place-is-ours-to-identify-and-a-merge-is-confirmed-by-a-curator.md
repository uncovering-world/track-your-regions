# ADR-0046: A place is ours to identify, and two rows become one place by a merge a curator confirms

**Date:** 2026-09-03
**Status:** Accepted

---

## Context

ADR-0045 decided that a place and its membership in a kind are different things — Cologne
Cathedral is one place that is both a World Heritage site and a cathedral, with a card in each
list and one visit seen through both — and left open how two rows are recognised as one place.
The schema holds no place: a row of `experiences` is at once the place and its membership in a
source, `UNIQUE(category_id, external_id)` lets one building arrive once per source, and nothing
relates the rows afterwards. The Tower of Hercules and the Hiroshima Peace Memorial are two pins
each (#755); the catalogue carries two rows named *National Archaeological Museum*.

The obvious key is a Wikidata item, and it cannot be the identity. It is the strongest signal we
have — museum and public-art rows carry `metadata.wikidataQid`, and a World Heritage id resolves
to an item through P757 the way the picture lookup already does (ADR-0043): 1194 of the 1272
sites resolve, and 82 of them to *several* items, because a serial site's components carry the
site's id too. But the hundred-odd component locations of *Frontiers of the Roman Empire* mostly
have no item of their own, a curator-created place has none by definition, and a place is a place
whether or not Wikidata has heard of it.

What the two candidate signals do on the catalogue as it stood on 2026-09-03 was measured before
deciding, at location level for serial sites (a point is compared with each of the site's
`experience_locations`, never with the site's centroid):

- **An equal item, across kinds: 12 pairs, 12 true.** Ten public-art rows are World Heritage
  locations (Madara Rider, Tower of Hercules, the Genbaku Dome, Stonehenge, Kasubi Tombs,
  Osun-Osogbo Grove, Koutammakou, the Roman Walls of Lugo, the Cave of Altamira, Las Médulas); two
  museum buildings are also public-art rows (Museo Reina Sofía, the National Museum of
  Archaeology). The distance between the two points of one item runs from 0 m to **1531 m**: five
  are within 6 m, Stonehenge is 47 m from the component it matched, Kasubi and Koutammakou 115 and
  157 m, and the walls of Lugo, the cave at Altamira and the mining landscape of Las Médulas 682,
  753 and 1531 m — a place with an extent has no single point, and any distance rule alone would
  have missed three of the ten.
- **Within 300 m plus a similar name: 3 pairs at similarity ≥ 0.5, 3 true, every one a component
  location of a serial site** (Antwerp's cathedral in *Belfries of Belgium and France*, Saihō-ji in
  *Historic Monuments of Ancient Kyoto*, the fortifications of Kotor in the *Venetian Works of
  Defence*). At 0.3 the first false candidate appears; below it, one true match hides behind a
  component named in another language (Oviedo's cathedral, listed in French on the *Routes of
  Santiago*) and another behind a name that shares nothing with its site (the Aljafería in
  *Mudejar Architecture of Aragon*).
- **Distance alone is not identity but the sign of something else.** Of the 31 pairs within
  300 m, 19 are a monument or a museum that stands *inside* a World Heritage zone — the *Alte
  Nationalgalerie* on Museum Island, the *Portrait of the Four Tetrarchs* on St Mark's in Venice,
  the Veit Stoss altarpiece in the Historic Centre of Kraków, Minin and Pozharsky on Red Square.
  The one candidate that looked false, *Egyptian Museum of Berlin* 82 m from *Museumsinsel*,
  was a data error (#781: the row is the collection, the venue is the Neues Museum) and the same
  relation: one of the five museums the island is made of.

The maintainer's reading as a traveller settled the two calls the numbers could not: a person
who has been inside the Neues Museum has visited Museum Island — there is no other way to visit
it — and a monument that stands on Red Square is not Red Square; and a match that is probable
rather than certain is a question for a curator, not a write.

## Decision

**1. A place has an identity of its own.** It is one physical thing a traveller stands in front
of. A source's identifier — a Wikidata item, a World Heritage id, an OSM id — is a property of
the place's membership in a kind, never the place's key. A serial World Heritage site is an
experience made of several places: its locations are the places, and identity is decided per
location, never for the site as a whole. ADR-0045 decision 4 phrased the same site the other way
round — the site as the place and its locations as parts of it — and is narrowed here: the
location is what a traveller stands in front of, what another kind's row can be the same thing
as, and where the visit is recorded; the site is the card that gathers them.

**2. Two signals are universal, and they have different weights.** An equal Wikidata item on two
rows is a merge without a question: it was right twelve times in twelve, and it found the three
matches whose points lie hundreds of metres apart. Coordinates within a threshold *and* a name
whose similarity reaches 0.5 (trigram, on unaccented lower-case names, against both the
site's name and the location's) are a proposal. Distance on its own proposes nothing: within a
historic centre everything is within 300 m of something.

**3. The distance threshold belongs to the place's extent and to the kind.** A point monument is
found within metres, a grove or a tomb complex within a few hundred, a city wall or a mining
landscape within a kilometre or more; World Heritage rows carry `metadata.areaHectares` and the
threshold grows with it. Each kind declares its threshold and any signal of its own — a bridge's
Structurae id, a grave's Find a Grave id, a component's labels in the site's other languages —
when it arrives; this ADR fixes the two universal signals and the rule that the rest are per kind.

**4. A probable merge is a proposal, and the gate it goes through is the one the catalogue
already has.** The curator confirms or refuses it beside every other decision a run left open
(ADR-0025, ADR-0037). A refused pair is remembered so it is not proposed again. An equal item
merges on its own but writes the same history entry, without the question.

**5. A merge makes one place of two; nothing is deleted.** The surviving place takes both sets of
memberships and both sets of visits; the row that was absorbed stays in the history (ADR-0022)
and the merge names it. A traveller who had marked both rows — the common case for #755's pairs,
two pins on one tower — ends with one visit: the earlier date stands, the notes of both are
kept, and where both sides carry a rating and the ratings differ, the one recorded with the later
visit date stands (a location visit carries no rating today, so a place that is a location has
nothing to reconcile there); the absorbed visit row is kept for the undo. The address of the
absorbed row (ADR-0034: `/e/<id>-<slug>` in a link a visitor shared) answers with the survivor's
card, not with the silent degradation an unknown id gets; where the survivor is a location of a
serial site, that is the site's card opened at the location, since the address grammar has no
segment for a location yet — adding one is ADR-0034's to extend, not decided here.
Undoing a merge restores both places with their memberships; a visit stays with the place it was
recorded on, and anything written after the merge — a membership a source added, a visit a
traveller recorded — stays with the surviving place.

**6. "Part of" is a second relation, distinct from identity.** A place may lie within another —
the Neues Museum on Museum Island, a monument on Red Square, the Cámara Santa inside Oviedo
Cathedral. Its sources, in order of confidence: a Wikidata chain of *part of* (P361) or
*location* (P276); the site's own boundary and buffer polygons, which #714 is about sourcing; and
geometry alone, which only ever produces a proposal for a curator. Proximity does not make a
part: the Children's Peace Monument stands 175 m from the Genbaku Dome, inside the Dome's buffer
zone, and is not part of the Dome.

**7. A visit cascades upward and never downward.** Visiting a place that is part of another marks
the containing place visited: being inside the Neues Museum is being on Museum Island, standing at
Minin and Pozharsky is standing on Red Square. Visiting the whole says nothing about its parts.
For a serial World Heritage site a visit is recorded on the location; when the site as a whole
counts as visited — all of its locations, any of them, a share — is #768's decision and is not
taken here.

**8. Counts follow the two words of ADR-0045.** A kind's count is of memberships ("12 art museums
in Italy" counts Cologne Cathedral's art-museum membership, not the cathedral); a region's overall
count is of the cards it offers — a place, or a serial site counted once in every region that
holds one of its locations, its locations never counted separately, which is what
`COUNT(DISTINCT experience_id)` in the region counts does today — and Cologne Cathedral is in it
once.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The Wikidata item is the identity | 78 of 1272 World Heritage sites resolve to no item, 82 resolve to several, most components of a serial site have none, and a curator-created place never will; the item is a signal about a place, not the place. |
| A single distance threshold, no item, no name | It would have missed three of the twelve certain matches (Lugo, Altamira, Las Médulas at 682–1531 m) and proposed nineteen non-matches in historic centres; distance without a name or an item is the "part of" relation, not identity. |
| Merge automatically on coordinates plus name | At similarity 0.5 the measured candidates were all true, but three pairs is not a rule, the threshold has never met a second museum source, and a wrong merge silently joins two travellers' visits; the cost of a curator's click is small next to that. |
| Treat "part of" as identity — a monument inside a World Heritage zone *is* the zone | A traveller does not call the Alte Nationalgalerie "Museum Island" or Minin and Pozharsky "Red Square"; the cards, the kinds and the pins differ. What they share is the visit, which decision 7 gives them without merging them. |
| Merge only within a kind and leave cross-kind duplicates as two pins | The whole point of ADR-0045's split is the place in two lists with one visit; two pins on the Tower of Hercules is the bug #755 reports. |

## Consequences

**Positive:**
- #755's 22 pairs have a mechanism: twelve merge on the item alone, the rest are proposals or
  "part of" relations for a curator, and the Tower of Hercules is one pin in two colours.
- #764 (visit cascade) and #768 (what a visit counts toward) get their referent: the place, the
  location for a serial site, and an upward-only cascade.
- #714's polygons gain a second use — grounding "part of" — beyond drawing a site.
- Two sources can feed one kind (#581, #628): the second source's rows meet the first's through
  the item or through a proposal instead of arriving as duplicates.
- Every new place-bound kind (architecture, bridges, cemeteries, libraries, viewpoints) inherits
  the two signals and adds its own threshold; the model does not change with the count of kinds.

**Negative / Trade-offs:**
- A place table, a membership table, a merge history and a "part of" relation are new schema; the
  readers that treat an `experiences` row as the place — the map's pins, the region counts, the
  visit tables `user_visited_experiences` and `user_visited_locations` — have to learn the
  difference. Whether a location visit can carry a rating at all — `user_visited_locations` has
  none today — is a product choice the merge rule does not force: decision 5 reconciles ratings
  only where both sides have one. None of it lands with this ADR.
- Cross-language component names defeat name similarity; until a kind adds labels in other
  languages as a signal, matches like Oviedo's cathedral reach a curator only through geometry.
- Curators get a new queue — merges and "part of" proposals — on top of held proposals; the
  first pass over the current catalogue is a few dozen questions, not hundreds.
- The upward cascade is a product promise the code does not yet keep: until it does, a visit to
  the Neues Museum leaves Museum Island unvisited.

## References

- Related ADRs: ADR-0045 (kinds, sources, place vs membership — the decision this one completes;
  its decision 4 narrowed), ADR-0022 (marked, never deleted), ADR-0025 and ADR-0037 (the gate a
  proposal goes through), ADR-0028 (a reader is positioned by places they can go to), ADR-0034 (a
  shared link keeps working), ADR-0043 (the P757 lookup)
- Related docs: `docs/tech/experiences.md` § Kinds and sources, `docs/vision/vision.md`
- PR / issue: #780 (this decision); #755, #764, #768, #714, #581, #628, #781 shaped by it

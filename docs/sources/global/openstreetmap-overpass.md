---
slug: openstreetmap-overpass
name: OpenStreetMap, tourism=museum through Overpass
publisher: OpenStreetMap contributors
urls:
  home: https://www.openstreetmap.org/
  dataset: https://overpass-api.de/
  api: https://overpass-api.de/api/interpreter
  terms: https://opendatacommons.org/licenses/odbl/1-0/
family: global
kinds: [any]
tier: regional
unit: { level: any, code: none, name: "any unit with a boundary relation (area by its Wikidata tag), or a bounding box" }
row:
  identity: "an OSM id, unstable across re-mapping; the wikidata tag where set"
  wikidata_link: tag
  coordinates: all
  languages: [name and name:xx tags]
  signal: "none of its own"
terms:
  licence: "ODbL 1.0"
  database_right: share-alike
  attribution: "© OpenStreetMap contributors, ODbL"
  scraping: not-needed
access:
  mode: api
  format: "Overpass QL, JSON"
  cadence: continuous
  volume: "Paris 146, Florence 110, Berlin 247, Kraków 89, Lima 109 (box), Tbilisi 43, Tallinn 67, Estonia 350"
  rate: "the public instance's own guidance: under 10,000 queries and 1 GB a day; one query per unit, fifteen seconds apart, cached"
scorecard:
  date: 2026-09-06
  completeness: 2
  identity: 1
  coordinates: 2
  names: 2
  signal: 0
  terms: 1
  access: 2
  cadence: 2
  total: 12
  verdict: hold
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# OpenStreetMap through Overpass

The most complete *enumeration* of what stands — a farm museum and a school's museum room are
`tourism=museum` too — with a Wikidata tag on a third to four fifths of the objects and
pictures on almost none. Looked at on 2026-09-06 as the worked example of an enumerator that
is the yardstick before it is a source (`docs/tech/filling-a-kind.md` § 7.4, § 6.1).

**What was measured (2026-09-06).** `tourism=museum` inside the unit's boundary relation
(area by its Wikidata tag), with a Wikidata tag, with a picture, tagged `museum=art`: Paris 146,
120, 3, 17; Florence 110, 73, 0, 7; Berlin 247, 144, 22, 26; Kraków 89, 51, 0, 4; Tbilisi 43,
25, 0, 2; Tallinn 67, 26, 0, 3; Estonia 350, 104, 0, 5; Lima 109, 35 in the metropolitan box
(`-12.25,-77.20,-11.85,-76.80`), the city's relation not being found by its item. Estonia's
350 against Statistics Estonia's 160 museums (2024) says what the tag enumerates. Kraków's
tags carry five of the state register's nine (the National Museum Q195311, Manggha Q572206,
the Aviation Museum Q377904, the Ethnographic Museum Q194616, the Jagiellonian University
Museum Q11787234) and the Czartoryski Q1450630, which is the world tier's row; Lima's
carry the Larco Museum (Q1954240) and the Pedro de Osma museum (Q6033665) but not the Lima Art
Museum.

**Terms.** ODbL: attribution, and share-alike on a derivative database. Reading OSM to find
and count binds nothing; storing its rows beside rows from a CC BY register makes a derivative
database whose ODbL obligations reach the whole (ADR-0002 noted the same for boundaries).

**What decides it.** The yardstick and the finder for both tiers — what a unit holds that no
register lists — and a source of *rows* only once the share-alike question is answered for the
catalogue as a whole: the total is 12, and the verdict is `hold` by § 6.2's share-alike clause,
whatever the total. Identity is the other weakness: ids move on re-mapping, and only the
Wikidata tag is stable.

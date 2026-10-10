---
slug: pleiades
name: Pleiades, the gazetteer of ancient places
publisher: Pleiades (Institute for the Study of the Ancient World, New York University; the Ancient World Mapping Center), under the editors of pleiades.stoa.org
urls:
  home: https://pleiades.stoa.org/
  dataset: https://atlantides.org/downloads/pleiades/dumps/
  api: https://pleiades.stoa.org/places/<id>/json (one place at a time; the dumps are the bulk route)
  terms: https://pleiades.stoa.org/credits
family: global
kinds: [archaeology, world-heritage]
tier: world
unit: { level: any, code: none, name: "the ancient world — the Greek and Roman Mediterranean and its frontiers, from the Barrington Atlas outward" }
row:
  identity: "the Pleiades id (a number in the place URI); Wikidata links to it by P1584, on 15,224 items — about 44 % of the 34,878 places with a point, so a stable id of its own and an item on fewer than most rows (2026-10-10)"
  wikidata_link: P1584
  coordinates: most
  languages: [en, and the attested names in their own scripts with a transliteration]
  signal: "the feature type an editor filed — fort, settlement, archaeological-site, villa, temple, station — and a location precision (precise, rough)"
terms:
  licence: "CC BY 3.0"
  database_right: waived
  attribution: "Pleiades (pleiades.stoa.org), CC BY 3.0"
  scraping: not-needed
access:
  mode: dump
  format: "daily dumps on atlantides.org — pleiades-places-latest.csv.gz (places: id, title, description, reprLat, reprLong, featureTypes, locationPrecision …), pleiades-names-latest.csv.gz (pid, nameAttested, nameTransliterated, nameLanguage …), pleiades-places-latest.json.gz (135 MB, every place whole)"
  cadence: daily
  volume: "34,878 places with a representative point in the CSV dump of 2026-10-09"
  rate: "none for the dumps; pleiades.stoa.org closes /names/, /features/ and /collections/ to every agent in robots.txt, so the site is not read page by page"
scorecard:
  date: 2026-10-10
  completeness: 1
  identity: 1
  coordinates: 2
  names: 2
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 13
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# Pleiades

The scholarly gazetteer of the ancient world: one record per place the Barrington Atlas and its
successors name, with its ancient names, a representative point, a one-line description and a
feature type, edited by named contributors and cited by the archaeological literature. Looked
at by #1306 as a source of a *description and an ancient name* for a World Heritage component
that has no Wikidata item — a fort on the Dacian frontier, a lakeside settlement around the Alps.

**What was measured (2026-10-10).** The two CSV dumps of 2026-10-09 were matched locally to 401
component points of three serial sites on the development catalogue (`data/tmp-1306/pleiades.py`:
every place within 3 km, trigram similarity of the component's name against the place's title
and its attested and transliterated names):

| Site | Points | A Pleiades place within 1 km | Name similarity ≥ 0.5 | …with a description |
|---|---|---|---|---|
| Frontiers of the Roman Empire – Dacia (721) | 277 | 23 | 9 | 9 |
| Prehistoric Pile Dwellings around the Alps (418) | 111 | 10 | 2 | 2 |
| Aalto Works (1755) | 13 | 0 | 0 | 0 |

Read by hand, the Dacian near-misses are the right places under their *ancient* names: Bologa –
Grădiște has Resculum 279 m away, Vărădia – Chilii has Arcidava at 829 m, Teregova – La Hideg
has Ad Pannonios at 904 m, Tihău – Grădiște has Tihău at 755 m. The nomination's toponyms are a
modern village plus a field name, so a name match is the wrong test for this source and the
distance plus the feature type (`fort`, `fort-2`) is the right one. The descriptions run 46 to
205 characters — "Roman fort", one sentence — and there are no pictures at all. Around the
Alps the two hits (Ägelmoos at 64 m, Siedlung Forschner at 127 m) are the prehistoric sites
themselves; the other eight places within a kilometre are Roman-era neighbours (Turicum beside
Zürich's Enge Alpenquai, Tasgetium beside Insel Werd). Aalto's buildings are outside the
gazetteer's world by definition.

**Terms.** The site's credits page places the content under the Creative Commons Attribution
3.0 licence; the dumps on atlantides.org carry the same. `robots.txt` on pleiades.stoa.org
closes `/names/`, `/features/` and `/collections/` to every agent and is silent on `/places/`;
atlantides.org has no `robots.txt` (404), which allows. The dumps are read in bulk, the site is
not.

**What it is for.** Not a picture — there is none — and not a paragraph, but the ancient name,
a stable URI with a scholarly bibliography behind it, and a feature type for a Roman-era point.
For a component the catalogue holds under a modern field name, Pleiades is what tells a curator
"this is Resculum" and gives the card one line and one link. Where the component is prehistoric
or modern it answers nothing. A Pleiades id found by place is a proposal for a curator, as a
Wikidata item found by place is (ADR-0046).

---
slug: wikidata-squares
name: Wikidata, the world's squares and streets
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://query.wikidata.org/sparql
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [squares-and-streets]
tier: world
unit: { level: any, code: none, name: "the world, cut once by three signals" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: all
  languages: [all]
  signal: "Wikipedia editions of the place, a year of its readers, and whether a Wikivoyage edition uses its item"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL, or the local subset (ADR-0119); readers from the pageview dumps; Wikivoyage usage from its dumps"
  cadence: continuous
  volume: "419 candidates with 15 or more editions; 326 at the line (2026-10-23)"
  rate: "the Query Service refuses heavy patterns; the run asks in fame bands and pauses between questions"
scorecard:
  date: 2026-10-23
  completeness: 2
  identity: 2
  coordinates: 2
  names: 2
  signal: 2
  terms: 2
  access: 2
  cadence: 2
  total: 16
  verdict: adoptable
status: adopted
issue: 1867
looked_at: 2026-10-23
---

# Wikidata, read for the world's squares and streets

The kind *Squares & streets* (ADR-0131) holds a square, a street, a promenade or a stairway a
visitor walks as a sight in itself: Red Square, Piazza Navona, the Spanish Steps, the
Champs-Élysées, the Arbat. Its world tier is read from Wikidata by the source *Squares & streets*
(`experience_sources` row 9), which decides from the place pass's gather (ADR-0132 decision 5).
The rule is code, and is not restated here: the classes are
`backend/src/services/sync/squares/classes.ts`, the verdict `squareTest.ts` and the line
`kind.ts`, with the two-door line read by `places/guidedLine.ts`. This record holds what the
search measured and why the line is where it is.

## The candidates (2026-10-23, the dev subset)

Five roots are asked with their trees, each checked with `wbgetentities`: square Q174782 (56
classes), street Q79007 (218), promenade Q787113 (5), stairs Q12511 (124) and pedestrian zone
Q369730 (20). A sixth, thoroughfare Q83620, is asked by itself and not by its tree. Moscow files
the Arbat and Tverskaya Street, Rome the Via Veneto and Beijing Wangfujing as a thoroughfare and
nothing narrower, while its tree of 3,144 classes holds every motorway, railway, port and bridge:
asked whole it brought 1,382 candidates and six more survey entries. The pool, which asks for
items with 15 or more Wikipedia editions, named 419 candidates.

What Wikidata files under these classes and another kind offers, among the 419:

- archaeological sites: the Roman Forum and the imperial fora, the amphitheatres of Nîmes and
  Arles, which Archaeology offers;
- bridges Prague and Dresden file as streets: the Charles Bridge, the Mánes and Augustus bridges,
  which Bridges & engineering marvels offers;
- bullrings, plazas de toros to Wikidata: Las Ventas, the Maestranza;
- motorways: the M25, the A8;
- a place of worship: Al-Aqsa, filed as a square for its esplanade.

A neighbourhood is no refusal. Wikidata files a shopping street under neighbourhoods, so a rule
that refused neighbourhoods refused Oxford Street, Fifth Avenue, Regent Street, Nanjing Road and
Khaosan Road, and kept nothing out that the line does not.

## What the line was chosen on

The list below is the reading the line was chosen on, drawn from the run's own candidates. The
list the line is checked against after every run is the canon in
`db/catalogue-coverage/calibration/squares-and-streets.jsonl` (#1951), compiled independently of what the line
measures (`docs/tech/catalogue-coverage.md`).

The list was assembled from three independent sources, among the candidates:

- the coverage surveys' entries under this kind that the pool names: 45, from Red Square and
  Tiananmen Square to the Via Giulia and Yerevan's Abovyan Street;
- the 12 candidates on the World Heritage list, such as the Grand-Place and Naqsh-e Jahan
  Square;
- the 76 candidates four or more Wikivoyage editions use (`wikivoyage_usage`), such as Trafalgar
  Square, the Place de la Concorde and the Römerberg.

That is 114 places.

## Why three signals

A guide naming a square tells the squares a visitor goes to from the ones only read about, as
for bridges. But a guide often names the monument on a square rather than the square: no
Wikivoyage edition uses the item of Havana's Malecón or of the Piazza della Rotonda, in front of
the Pantheon, though both are read some 35,000 times a year. So the readers' door stays low.

## The line

Measured with the draft rule on the candidates, with a "no guide and no heritage listing" count as
a rough measure of what a curator will turn away:

| line | admitted | with no guide and no heritage listing | the reading's places |
|---|---|---|---|
| 25,000 readers | 273 | 54 | 95/114 |
| 15,000 readers | 343 | 82 | 103/114 |
| 50,000, or 10,000 with a guide | 283 | 23 | 101/114 |
| 50,000, or 5,000 with a guide | 291 | 23 | 107/114 |
| **30,000, or 5,000 with a guide** | **317** | **43** | **110/114** |
| 25,000, or 5,000 with a guide | 329 | 54 | 111/114 |

**The line is 15 editions and 30,000 readers a year, or 5,000 where a Wikivoyage edition uses
the place's item.** At 50,000 the Malecón and the Piazza della Rotonda fall out. Below 30,000
the one place gained, Patan Durbar Square, is a World Heritage component that kind already
shows. A place the source holds stays while it keeps 12 editions and 21,000 readers, or 3,500
with a guide. With no year of readership folded, nothing new enters; with no Wikivoyage usage
built, the guide door is shut.

## Calibration (2026-10-23, the dev subset, read-only in the dev container)

The branch's own code, gathering for this kind alone: of the 419 candidates the source would
admit **326** and refuse **28**. By type: 177 squares, 136 streets, 8 promenades and 5 stairways.
By refusal: 13 archaeological sites, 6 bridges, 4 bullrings, 3 motorways, 1 place of worship and
1 destroyed. The reading's places: 109 of 114. Of the five not admitted, Al-Aqsa is offered by
Places of worship; Bhaktapur and Patan Durbar Squares and São Francisco Square are World Heritage
components; and Yerevan's Abovyan Street, with 7,900 readers a year, is a regional tier's.

**What a curator reads.** The doors let in some districts (Akihabara, Bur Dubai, HafenCity, the
London Docklands), a fairground (the Theresienwiese), the Ho Chi Minh trail and a ladder in the
Church of the Holy Sepulchre that Wikidata files under stairs. These arrive for a curator, like
every arrival of this source.

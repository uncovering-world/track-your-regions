---
slug: wikidata-bridges
name: Wikidata, the world's bridges and engineering works
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://query.wikidata.org/sparql
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [bridges-and-engineering]
tier: world
unit: { level: any, code: none, name: "the world, cut once by three signals" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: all
  languages: [all]
  signal: "Wikipedia editions of the work, a year of its readers, and whether a Wikivoyage edition uses its item"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL, or the local subset (ADR-0119); readers from the pageview dumps; Wikivoyage usage from its dumps"
  cadence: continuous
  volume: "566 candidates with 15 or more editions and 149 of a canal's works with 3 or more; 342 at the lines (2026-10-24)"
  rate: "the Query Service refuses heavy patterns; the run asks in fame bands and pauses between questions"
scorecard:
  date: 2026-10-22
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
issue: 1860
looked_at: 2026-10-22
---

# Wikidata, read for the world's bridges and engineering works

The kind *Bridges & engineering marvels* (ADR-0131) holds a bridge, aqueduct, dam or tunnel a
traveller goes to or through for itself: the Golden Gate Bridge, the Charles Bridge, the Pont du
Gard, the Hoover Dam, the Channel Tunnel. Since #1947 it also holds a canal's lock, flight of
locks, boat lift or inclined plane, each one place (§ A canal's works), and no canal: a canal is a
long object and waits for a model of its own (#1948). Its world tier is read
from Wikidata by the source *Bridges & engineering marvels* (`experience_sources` row 8), which
decides from the place pass's gather (ADR-0132 decision 5). The rule is code, and is not restated
here: the classes are `backend/src/services/sync/bridges/classes.ts`, the verdict
`bridgeTest.ts` and the line `kind.ts`. This record holds what the search measured and why the
line is where it is.

## The candidates (2026-10-22, the dev subset)

Five roots name a work, each checked with `wbgetentities`: bridge Q12280, aqueduct Q474, dam
Q12323, canal Q12284 and tunnel Q44377. Their trees hold 406, 13, 170, 95 and 73 classes. The
pool, which asks for items with 15 or more Wikipedia editions, named 595 candidates: 349 under
bridge alone, 89 canals, 77 dams, 45 tunnels and 19 aqueducts, and the rest under two roots.

What is no work a traveller visits, among the 595:

- destroyed: the Polcevera Viaduct in Genoa, the I-35W bridge, the Ludendorff Bridge, the
  Malpasset Dam;
- proposed or being built: the Fehmarn Belt link, the Brenner Base Tunnel, the tunnels under
  the Gulf of Finland and the Korea Strait;
- rivers Wikidata also files as canals: the Amstel, the Upper Rhine;
- railway lines in a tunnel: London's Waterloo & City line;
- Roman aqueducts that stand only as a site, Aqua Marcia and the Eifel Aqueduct, and ancient
  tunnels such as Eupalinos', which Archaeology offers. A Roman bridge still standing and crossed
  is a bridge.

A street is no refusal: Prague files the Charles Bridge as one, and Amsterdam the Magere Brug.

## What the line was chosen on

The list below is the reading the line was chosen on, drawn from the run's own candidates. The
list the line is checked against after every run is the canon in
`db/catalogue-coverage/calibration/bridges-and-engineering.jsonl` (#1951), compiled independently of what the line
measures (`docs/tech/catalogue-coverage.md`).

No reference list of bridges a traveller expects existed, so one was assembled from four
independent sources, among the 595 candidates:

- the coverage surveys' 15 entries under this kind that the pool names, from the Sydney Harbour
  Bridge to Ponte Sisto and Yerevan's Victory Bridge;
- the 16 candidates on the World Heritage list, such as the Forth Bridge, Vizcaya Bridge and
  the Rideau Canal;
- the 53 candidates four or more Wikivoyage editions use (`wikivoyage_usage`), such as the Kiel
  Canal, Ljubljana's Dragon Bridge and the Triple Bridge. The London metro line was taken off by
  hand: guides name it to get about;
- the American Society of Civil Engineers' Seven Wonders of the Modern World and the BBC's Seven
  Wonders of the Industrial World, as Wikipedia lists them: the Channel Tunnel, the Golden Gate
  Bridge, the Itaipu Dam, the Panama Canal, the Zuiderzee and Delta works, the Brooklyn Bridge
  and the Hoover Dam.

That is 79 works. The Channel Tunnel is on the engineers' list, and a traveller rides it for
itself, so transport tunnels stay in the kind and the line decides them.

## Why three signals

Readers alone mislead in two ways. A disaster fills a year of readers: the Vajont Dam has 20
editions and 482,000 readers, and the Francis Scott Key Bridge in Baltimore 195,000 after it fell.
And an expressway viaduct can be read as much as a bridge a traveller crosses Isfahan for: the
Burapha Withi Expressway has 27 editions and 43,000 readers, and the Khaju Bridge 25 and 43,000.
What tells them apart is whether a travel guide names the work, so the line reads Wikivoyage too.

## The line

Measured with the draft rule, which refused the destroyed, the proposed, the rivers and the
London metro line, but not yet archaeological sites or railway lines by class. Every option keeps
15 editions, the pool's floor, since any higher bar loses calibration works
with 15 to 19 editions (the Tyne Bridge, Ponte d'Augusto, the Glenfinnan Viaduct). Measured on
the candidates with the rule applied, with a "no guide and no heritage listing" count as a rough
measure of what a curator will turn away:

| readers to enter | admitted | with no guide and no heritage listing | the reading's works |
|---|---|---|---|
| 25,000 | 384 | 94 | 71/79 |
| 15,000 | 461 | 125 | 74/79 |
| 10,000 | 516 | 150 | 78/79 |
| 50,000, or 10,000 with a guide | 379 | 43 | 77/79 |
| 25,000, or 10,000 with a guide | 444 | 94 | 77/79 |

**The line is 15 editions and 50,000 readers a year, or 10,000 where a Wikivoyage edition uses
the work's item.** It keeps 77 of the 79, and the fewest works no guide or register vouches for.
The two it misses are the Proserpina Dam, a part of Mérida's World Heritage property that the
rule leaves to Archaeology as a site, and Yerevan's Victory Bridge, with 5,800 readers a year, a
regional tier's. A work the source holds stays while it keeps 12 editions and 35,000 readers, or
7,000 with a guide. With no year of readership folded, nothing new enters, as for Towers; with no
Wikivoyage usage built, the guide door is shut and only the readers' door is open.

## Calibration (2026-10-22, the dev subset, read-only in the dev container)

The branch's own code, gathering for this kind alone: of the 595 candidates the source would
admit **376** and refuse **30**. That is the 379 of the table's chosen row less three, which the final rule
refuses as archaeological sites no bridge class names: Aqua Marcia, Hezekiah's Tunnel and the
tunnel of Eupalinos. The reading's works: 77 of 79. By type: 238 bridges, 58 canals,
45 dams, 22 tunnels and 13 aqueducts. By refusal: 11 archaeological sites, 8 destroyed, 4 rivers,
4 proposed, 2 railway lines, 1 under construction.

**What a curator reads.** The doors let in working hydroelectric dams the world reads about (the
Bhakra, Atatürk and Sayano–Shushenskaya dams), long waterways with one point on the map (the
Volga–Don and White Sea–Baltic canals) and record road bridges (the Danyang–Kunshan Grand Bridge).
The maintainer chose to let the line decide dams and canals rather than refuse them by class, so
these arrive for a curator, like every arrival of this source.

## A canal's works (2026-10-24, the dev subset, #1947)

The product review of 2026-10-24 decided the kind offers only what is one place. The canal root
and type left it: the 58 canals it held, 55 of them still waiting for a curator, are refused with
a reason that names #1948. Three roots came in, each read from the local subset: lock Q105731,
flight of locks Q1784096 and boat lift Q14908, with canal inclined plane Q912618 under boat
lift. Wikidata files a flight of locks under canal, so a canal is refused only where no other
class of the kind names it.

**The candidates.** A lock is written about in few languages however many people stop at it.
The pool's floor of 15 editions names only the Falkirk Wheel (41) and Strépy-Thieu (20); the
Anderton Boat Lift has 11, the Caen Hill flight 3. So the kind asks these classes below the floor,
at 3 editions, for itself alone. At 2 editions or more they name 413 candidates: 338 locks, most
of them the navigation dams of large rivers (the Mississippi's Lock and Dam works, the
Dnieper's hydroelectric plants), 15 boat lifts, 5 flights and 4 inclined planes. A lock
Wikidata also files as a dam is a lock, the Soo Locks and Seattle's Ballard Locks, unless the dam
is a power station: the Kyiv, Kaniv and Kremenchuk plants pass ships and are dams.

**The canon.** No reference list of the locks and lifts a traveller expects existed, so one was
compiled by the canon's method (`docs/tech/catalogue-coverage.md`): 18 entries, each named by
the compiler's own list and at least one independent selection. Those were the Seven Wonders of
the Waterways, the World Heritage list, the American engineering societies' landmarks, the
ICOMOS international canal monuments list, and travel publishers' pages, kept under
`docs/local/`. The canon is in `db/catalogue-coverage/calibration/bridges-and-engineering.jsonl`.
Four of its entries are out of the kind's reach by Wikidata's typing, not by the line:
Neptune's Staircase and the Fonseranes locks are filed as a built structure, the Canal du Centre
lifts as an architectural ensemble (World Heritage holds them), and the Three Gorges ship lift and
the Elbląg Canal's inclined planes have no item of their own in the subset.

**The line**, measured on the candidates the rule passes as a lock, flight, lift or inclined plane,
against the 16 canon entries with an item:

| enter | admitted | canon |
|---|---|---|
| 3 editions, 15,000 readers, or 10,000 with a guide | 16 | 9/16 |
| 3 editions, 15,000 readers, or 5,000 with a guide | 23 | 11/16 |
| 3 editions, 15,000 readers, or 4,000 with a guide | 24 | 12/16 |
| 3 editions, 25,000 readers, or 5,000 with a guide | 20 | 10/16 |
| 4 editions, 15,000 readers, or 5,000 with a guide | 17 | 8/16 |
| 3 editions, 10,000 readers, or 5,000 with a guide | 26 | 11/16 |

**The line is 3 editions and 15,000 readers a year, or 4,000 where a Wikivoyage edition uses the
item** (`WATERWAY_LINE`); a work stays on 3 editions and 10,000 readers, or 3,000 with a guide. It
keeps 12 of the 16, and every canon entry the kind's classes reach but one, the Kirkfield Lift
Lock (2 editions, 2,900 readers), a regional tier's. A lower readers' door lets in places a guide
does not vouch for (Camden Lock, a market; the Louis Joubert lock). Beside the canon it admits the
Soo Locks, Ronquières, Scharnebeck, Montech's water slope, the Krasnoyarsk ship lift and the Big
Chute marine railway, which a traveller goes to see, and a few navigation locks of large rivers
(Iffezheim, Nußdorf, McAlpine, Rothensee, the Crossed Locks in Emden). It also admits the Kakhovka
Dam, destroyed in 2023 and not yet marked so in Wikidata. Those are a curator's to refuse, like
every arrival of this source.

**Calibration**, main's code beside the branch's over the same subset, read-only in the dev
container: the branch admits 342 against main's 376. The 58 canals leave, all with the reason
naming #1948, and 24 of a canal's works enter: 13 boat lifts, 9 locks and 2 inclined planes.
Wikidata types the Arzviller inclined plane as a lift and the Bingley Five Rise flight as an
inclined plane. No other verdict changes: 238 bridges, 45 dams, 22 tunnels and 13 aqueducts.

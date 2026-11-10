# A walked street read from the venues around it (2026-11-10)

The question #2311 asked: Squares & streets admits a street by how widely it is described and read,
and a traveller walks many streets for something fame does not measure, the life along them. The
kind's misses are such streets: Bauman Street, Kazan's pedestrian heart, refused by the run of
2026-11-03 at 8 editions; Bergmannstraße and Kastanienallee in Berlin at 4. Its junk is the other
way round: through streets and quiet squares a curator refuses, Majakowskiring and Schloßplatz in
Berlin among them.

**Short answer.** The cafés, restaurants and bars within 200 m of a street's point separate the
streets a traveller walks from the through streets in all three cities read. Measured against the
liveliest places of the kind around it, a street passes at half the median of the ten liveliest:
39 places of two editions or more in Berlin, 10 in Istanbul and 7 in Kazan, the walked streets fame
misses among them and neither street a curator refused in Berlin. ADR-0192 adopts it as a test of
the kind's surroundings tier.

## The population

Every candidate of Squares & streets on the local Wikidata subset (the kind's roots and their class
closure, with a point) within 15 km of Berlin's centre, 20 km of Istanbul's and 15 km of Kazan's:
9,031, 217 and 680 items, whatever their editions. The answer key: the coverage surveys' Squares &
streets entries (Berlin 16, read by the maintainer; Istanbul 8), the curators' refusals on the
development catalogue, and Bauman Street.

## The signals read

1. **Fame** (Wikipedia editions) reads the famous squares and avenues, Unter den Linden and
   Potsdamer Platz at 48 editions each, and misses every walked street at 3 or 4 editions
   (Bergmannstraße, Kastanienallee, Oranienstraße, Boxhagener Platz) and Bauman Street.
2. **Buildings on the street** (items whose `P669` names it, and those of them with a heritage
   designation, `P1435`) follow how a country records its buildings: in Berlin 2,356 of the 9,031
   streets carry one, Bauman Street 23 (17 listed); in Istanbul 5 of 217, İstiklal Avenue 14 with
   none listed. A regional signal, not a world one.
3. **Venues**: OpenStreetMap's objects tagged `amenity` = `cafe`, `restaurant`, `bar`, `pub`,
   `fast_food`, `ice_cream` or `biergarten`, read through the QLever mirror of the planet and kept
   on the development machine (`data/cache/2311-streets/`).
4. **Photographs** were not read: the venues answer the question, and the sources of geotagged
   photographs that would have to be read for it are not used elsewhere.

## The signal

Venues were counted two ways: along each street's OpenStreetMap line (within 25 m of it, per
100 m), matched to the item by its `wikidata` tag or its name, and within a radius of the item's own
point. The line reads a long street best, but 871 of Berlin's items and 581 of Kazan's matched no
line by name. The point needs no match and ranks the same streets at the top:

| Street | City | Editions | Venues within 200 m | Rank in its city |
|---|---|---:|---:|---|
| Boxhagener Platz | Berlin | 5 | 94 | 3rd of 9,031 |
| Bergmannstraße | Berlin | 4 | 54 | 27th |
| Kastanienallee | Berlin | 4 | 51 | 32nd |
| İstiklal Avenue | Istanbul | 36 | 108 | 2nd of 217 |
| Bauman Street | Kazan | 9 | 69 | 2nd of 680 |
| Majakowskiring | Berlin | 9 | 0 | among the last |
| Schloßplatz (Berlin-Mitte) | Berlin | 17 | 5 | — |

A street whose point stands off its lively stretch reads lower than its line: Oranienstraße has 18
venues within 200 m of its point. The famous quiet avenues read middling, Unter den Linden 11 and
Karl-Marx-Allee 1, and fame admits them already.

## The share

Each candidate is measured against its own city as the tier measures a place against its
surroundings: the reference is the median of the ten liveliest candidates (Berlin 73, Istanbul 71,
Kazan 53.5), and a candidate of two editions or more passes when its count reaches a share of it.

| Share | Berlin | Istanbul | Kazan |
|---:|---:|---:|---:|
| 0.6 | 22 | 8 | 6 |
| 0.5 | 39 | 10 | 7 |
| 0.4 | 73 | 11 | 7 |
| 0.33 | 106 | 15 | 9 |
| 0.25 | 152 | 17 | 13 |

At half, read as a traveller, the places that pass and that the development catalogue did not hold
on 2026-11-10 (Boxhagener Platz, Savignyplatz, Kottbusser Tor, Bankalar Caddesi and the Camondo
Stairs pass too, and were already held, waiting for a curator):

- in Berlin, the walked streets and squares fame misses: Simon-Dach-Straße, Bergmannstraße,
  Kastanienallee, Oderberger Straße, Helmholtzplatz, Lausitzer Platz, Marheinekeplatz, Rosenthaler
  Platz and Wilmersdorfer Straße; streets of a neighbourhood with cafés, such as Rykestraße,
  Kopernikusstraße, Nostitzstraße and Gneisenaustraße; and busy streets a curator may turn down,
  such as Torstraße, Skalitzer Straße, Kottbusser Damm, Schönhauser Allee and Karl-Liebknecht-Straße;
- in Istanbul, Bağdat Avenue, the Mese and the Forum of Constantine (the old city's avenue and forum,
  whose ruins another kind may hold), and Tarlabaşı Boulevard, a traffic artery beside Beyoğlu;
- in Kazan, Bauman Street, which the run had refused, Tuqai Square, Universitetskaya Street and three
  more of the city's streets, and one item that is a Commons category of stairs, which the
  kind's rule has to refuse.

Neither street a curator refused passes: Majakowskiring (0) and Schloßplatz (5). Walther-Schreiber-Platz,
a traffic square (33, 0.45 of the reference), and Hermannstraße (20, 0.27) stay out. Oranienstraße
(0.25), Auguststraße (0.30) and Winterfeldtplatz (0.33) also stay out, their points off their lively
stretches. A third lets in 106 places in Berlin, a quarter 152: at those shares the neighbourhood
streets outnumber the walked ones.

## Reproducing it

The inputs are kept on the development machine under `data/cache/2311-streets/`, written on
2026-11-10:

- `streets_pop.tsv`: the population, 9,928 rows of city, item, Wikipedia editions, label and
  point (Berlin 9,031, Istanbul 217, Kazan 680), read off the local Wikidata subset by the kind's
  class closure, every item of them with a point within the city's radius.
- `venues_<city>.tsv`: every OpenStreetMap object with an `amenity` or a `tourism` tag around the
  city, with its key, its value and its geometry as WKT, read from the QLever mirror of the planet
  (`osm-planet`) in six questions, one per city and key. Berlin holds 22,708 objects, Istanbul
  16,360 and Kazan 2,875.
- `ways_<city>.tsv` and `labels.tsv`: the named ways and the items' labels, for the count along a
  street's line.

The questions themselves were asked in one working session, and only their answers are kept. Two
scripts beside the inputs reproduce every number in § The signal and § The share from them:

- `door.py <out.json>` counts each item's food-and-drink venues within 200 m, by a planar distance
  corrected for latitude;
- `shares.py <out.json> <share>` reads the references, the counts at each share and the places
  that pass.

Run them with `python3 -I`, from the directory that holds them.

They count the venues mapped as points. The ones mapped as an outline (a way or a relation) are
not counted: 732 of Berlin's 12,531 food-and-drink venues, 762 of Istanbul's 12,819 and 116 of
Kazan's 1,955, 5.8 to 5.9 % in each city. The layer keeps those at a point too (ADR-0191
decision 2), so the run counts them and the dry run reads them.

## Where the measurement stops

- The reference here is the city's ten liveliest within a fixed radius of its centre. The run reads
  the ten liveliest of the kind within 150 km of each candidate, which in these cities is the same
  core. The dry run on the development catalogue reads it as the run does.
- A street must have a Wikidata item: Nevizade Sokak and Cezayir Sokağı in Istanbul have 2 or 3
  sitelinks.
- Three cities is a small sample for a share. The dry run lists every street the test adds in every
  surveyed region, for a traveller's reading, and checks that the famous streets keep their places
  on a crowded city's map.

# What the databases Wikidata links places to could do for the catalogue

Research for #1977, done on 2026-10-24 and 2026-10-25 on the Wikidata dump of 2026-10-19 and the
development catalogue of 2026-10-24.

## The question

Every kind but World Heritage Sites decides what a traveller sees by counting an item's
Wikipedia editions against a line. The calibration canons of #1864 show where that number fails:
a famous fountain or mural, or a museum in a city that writes in one language, has few articles
in other languages. Wikidata also links its items to thousands of other databases through
external-identifier statements: national heritage registers, specialist catalogues, travel
platforms and other encyclopedias. The question is which of those databases could serve the
catalogue, in three ways:

- as a signal of fame or significance;
- as a list a kind's regional tier could be filled or checked from;
- as a source of facts the catalogue lacks.

The question covers the live kinds, the kinds proposed in the coverage register
(`db/catalogue-coverage/kinds.jsonl`) and the canons' misses.

## Method

**One pass over the full dump.** `wikidata-20261019-all.json.gz` is 156.6 GB compressed and
1,844.6 GB of JSON in 121,971,281 lines. It was streamed once on the development machine. The
decompression ran in parallel (`rapidgzip`) and the lines were handed to ten worker processes.
The pass took 41 minutes and kept three things:

- **Every item with a coordinate (P625, 12,224,671 items) as a compact record.** The record holds
  the item's English label, its classes (P31), its country (P17), its heritage designations
  (P1435), its count of Wikipedia editions, its first coordinate and every claim whose datatype is
  `external-id`. For each such claim it keeps the property, the first value and the number of
  values.
- **The 7,576 items the research asked about, whole.** These are every place the catalogue holds
  under any kind (admitted or refused), every entry of the eight canons of #1864 and every entry
  of the coverage surveys. 7,575 were found. The missing one is the Sydney survey's Cronulla
  Beach (Q21922366): the dump holds no entity under that id, so it is a redirect or a deleted
  item, and none of the figures here counts it.
- **How many items carry each property, over the whole dump.**

A second pass collected the property entities themselves, which hold each property's formatter
URL and its issuer. The results are kept under `data/cache/1977-external-ids/` on the
development machine.

**No live Wikidata service was asked.** The classes of each property and the English labels of
classes and countries come from the local subset (`workbench.wikidata_labels`,
`workbench.wikidata_entities`). Which items a Wikivoyage edition uses comes from
`workbench.wikivoyage_usage`, taken from the Wikivoyage dumps: 285,317 items, 248,088 of them
with a coordinate.

**Groups of places by kind.** Places were grouped by kind through Wikidata's own classes. Each
kind, live or proposed, got a few root classes, and every class below them in the local subset's
subclass closure (`workbench.wikidata_class_closure`) counts as the kind. For example, Castles &
fortresses is castle (Q23413), fortification (Q57821), fort (Q1785071), fortress (Q57831),
citadel (Q88291) and castle ruin (Q17715832). Each root was looked up by its English label and
its use as a class, never from memory. A group is therefore broader than what the kind's own run
admits. It is "everything Wikidata calls a castle", and the figures below describe the pool a
kind draws from, not the kind.

**Two independent marks of fame.** The research measures each candidate signal against two
marks:

- **Use by a Wikivoyage edition.** It is the project's existing check of whether a guide lists a
  place. Of all places with a coordinate, 2.0 % carry it.
- **The canon entries of #1864.** These are the places nobody who knows them would dispute,
  compiled from editorial selections and not from Wikidata. The four merged canons are Towers,
  Bridges, Squares & streets and Places of worship. The four compiled in their slices as they
  stood on 2026-10-24 are Art Museums, Public art, Monuments & memorials and Archaeology. Together
  they hold 723 entries. The 718 with a coordinate are the ones the tables below count; two
  squares and three works of public art have none.

"Under the line" below means fewer than 22 Wikipedia editions, the line most kinds inherited
from the art museums. It is used here as the line the catalogue draws today, not as a
recommendation.

## What the places carry

2,089 external-identifier properties are carried by 50 or more of the places with a coordinate.
Grouped by the class Wikidata gives each property:

| Family (the property's own class) | Properties | Statements on places |
|---|---|---|
| places and gazetteers | 421 | 15,483,382 |
| cultural heritage registers and architectural catalogues | 356 | 4,026,291 |
| organisations and companies | 256 | 1,806,966 |
| library authority files (VIAF and its members) | 92 | 1,298,466 |
| tourism, hotels and restaurants | 62 | 485,213 |
| encyclopedias (142) and subject dictionaries | 152 | 382,936 |
| protected areas | 55 | 222,631 |
| online accounts | 35 | 213,634 |
| museums and art | 77 | 68,752 |
| the ancient world | 27 | 53,202 |

A property can be in more than one family. Almost all of the volume is national: the largest
heritage properties each cover one country. Examples are Sweden's Open Cultural Heritage URI
(P1260), carried by 99,091 archaeological places; the Bavarian monument authority (P4244); and
England's National Heritage List (P1216), carried by 400,429 items in all. A handful are
worldwide.

## The databases behind each kind

The table gives the share of each live kind's admitted places on the development catalogue that
carry each identifier. Generic authority files, which every famous place carries, are left out.
They include VIAF, the Library of Congress, the GND, Freebase and the Google Knowledge Graph.

| Kind (admitted) | The specialist and travel identifiers its places carry |
|---|---|
| World Heritage Sites (1,302) | World Heritage Site ID (P757) 100 %, OpenStreetMap relation (P402) 24 %, Encyclopædia Britannica (P1417) 25 %, Atlas Obscura (P7772) 14 %, World Database on Protected Areas (P809) 13 %, Pleiades (P1584) 9 % |
| Art Museums (108) | Britannica 62 %, Sotheby's Museum Network (P6155) 75 %, Athenaeum museum (P4146) 56 %, Tripadvisor (P3134) 34 %, Structurae (P454) 20 %, Atlas Obscura 9 % |
| Public art (100) | Atlas Obscura 48 %, OpenStreetMap node (P11693) 45 % and way (P10689) 39 %, Britannica 27 %, Vanderkrogt's statues (P3711) 10 %, Tripadvisor 9 % |
| Places of worship (1,086) | Kültür Envanteri (P11729) 50 %, OpenStreetMap way 39 %, archINFORM (P5383) 37 %, Structurae 36 %, Britannica 30 %, GCatholic (P2971) 29 %, Atlas Obscura 20 % |
| Archaeology (1,133) | Pleiades 52 %, Britannica 47 %, Kültür Envanteri 38 %, ToposText (P8068) 33 %, Digital Atlas of the Roman Empire (P1936) 32 %, Grove Art Online (P8406) 27 %, Atlas Obscura 22 %, vici.org (P1481) 20 % |
| Monuments & memorials (131) | OpenStreetMap way 50 %, Atlas Obscura 34 %, Britannica 32 %, Structurae 21 %, Tripadvisor 16 %, Kültür Envanteri 15 % |
| Towers (107) | Structurae 70 %, CTBUH Skyscraper Center (P1305) 43 %, SkyscraperPage (P1699) 35 %, Emporis (P455) 30 %, Atlas Obscura 23 % |
| Bridges & engineering (376) | Structurae 73 %, Britannica 43 %, Brückenweb (P4328) 40 %, OpenStreetMap relation 28 % and way 27 %, Atlas Obscura 19 % |
| Squares & streets (328) | Britannica 22 %, OpenStreetMap relation 20 % and way 10 %, Paris's street code (P630) 9 %, France's FANTOIR street code (P3182) 9 % |

The pools of the proposed kinds carry specialist databases as well. Each entry below gives the
number of places that carry the identifier and what share of them a Wikivoyage edition uses,
rounded down.

| Proposed kind (places in its Wikidata pool) | Specialist databases its pool carries |
|---|---|
| Castles & fortresses (84,399) | Kültür Envanteri 14,768 (14 %), Alle Burgen (P12884) 4,768 (15 %), Burgenwelt (P12823) 4,633 (28 %), Atlas of Hillforts (P4102) 4,143 (1 %) |
| Palaces & residences (18,188) | Italy's ICCD catalogue (P9051) 464 (10 %) and its S forms (P6286) 431 (30 %), Spain's Bien de Interés Cultural code (P808) 440 (18 %), Lombardy's heritage register (P3503) 1,766 (4 %) |
| Lighthouses (9,816) | Admiralty List of Lights number (P3562) 6,895 (8 %), the US NGA list (P3563) 5,207 (8 %), ARLHS World List of Lights (P2980) 4,417 (15 %), USCG (P3723) 663 (19 %) |
| City gates & walls (5,699) | Kültür Envanteri 529 (20 %), Mérimée (P380) 298 (19 %), Burgenwelt 236 (13 %) |
| Skyscrapers (4,526) | CTBUH Skyscraper Center 2,571 (14 %), SkyscraperPage 2,001 (15 %), Emporis 1,480 (15 %, a defunct site), Structurae 1,243 (21 %) |
| Parks & gardens (135,357) | World Database on Protected Areas 4,861 (52 %), Tripadvisor 3,103 (49 %), Botanic Gardens Conservation International (P5818) 1,410 (48 %), Atlas Obscura 1,076 (49 %) |
| National parks & reserves (156,779) | World Database on Protected Areas 73,784 (5 %), the European designated areas database (P4762) 47,609 (2 %), Natura 2000 (P3425) 26,328 (0 %), iNaturalist place (P7471) 4,670 (21 %) |
| Zoos & aquariums (2,689) | Tripadvisor 1,049 (62 %), Petit Futé (P5760) 196 (56 %), Botanic Gardens Conservation International 122 (90 %) |
| Theme & amusement parks (2,276) | Roller Coaster DataBase (P2751) 399 (57 %), Tripadvisor 324 (57 %), The Park Database (P5765) 150 (83 %) |
| Entertainment venues (16,252) | Carthalia (P5652) 5,040 (25 %), the European Theatre Architecture database (P4535) 3,805 (25 %), Cinema Treasures (P4129) 1,935 (20 %) |
| Sports venues (17,919) | StadiumDB (P5288) 1,651 (24 %), Structurae 674 (39 %) |
| Cemeteries (442,071) | Find a Grave (P2025) 208,795 (0 %), Geneanet (P9189) 37,756 (0 %), the Commonwealth War Graves Commission (P1920) 5,407 (2 %) |
| Hiking trails (3,237) | AllTrails (P7127) 181 (22 %), Hiking Project (P7116) 89 (23 %) |
| Wineries & workshops (3,964) | Whiskybase (P9242) 248 (24 %), RateBeer (P2905) 394 (9 %), Untappd (P3002) 386 (8 %) |
| Markets (5,574) | Mérimée 259 (10 %), Kültür Envanteri 164 (17 %), Tripadvisor 102 (44 %) — no specialist database |
| Beaches (20,018) | the EU bathing-water register (P9616) 118 (17 %), BEACON (P7225) 102 (48 %) — national gazetteers only |

Three databases stand out because they are worldwide and cross the kinds:

- **Atlas Obscura** (P7772) is carried by 17,638 items: museums, archaeological sites, sculptures
  and curiosities. It sits on a third to a half of the admitted public art and monuments, and a
  Wikivoyage edition uses 44 % of the places that carry it.
- **Kültür Envanteri** (P11729) is carried by 70,293 items: Ottoman, Byzantine and classical
  heritage from Turkey across the Balkans, the Middle East and Europe. It sits on half of the
  admitted Places of worship.
- **Structurae** (P454) is carried by 24,840 items. It is the engineering catalogue behind
  nearly three-quarters of the admitted towers and bridges.

## A signal of fame?

**On the canons.** For each kind, the table counts the canon entries under the line and those the
kind does not offer on the development catalogue. It then gives how many of each carry:

- a travel platform's identifier: Tripadvisor (P3134), Atlas Obscura (P7772), Foursquare (P1968),
  Yelp (P3108), Michelin's travel guide (P4161), Petit Futé (P5760), the Touring Club Italiano
  (P5601), AAA (P8828), Routard (P4986), Visit Tuscany (P8083), Komoot (P10862), the Japan
  Tourism Agency's sightseeing database (P12907) or Google Arts & Culture (P10297);
- the identifier of one of the 142 properties Wikidata classes as related to encyclopedias;
- use by a Wikivoyage edition.

| Canon | Entries | Under 22 editions | …with a travel ID | …in an encyclopedia | …used by Wikivoyage | Not offered | …with a travel ID | …in an encyclopedia | …used by Wikivoyage |
|---|---|---|---|---|---|---|---|---|---|
| Art Museums | 96 | 15 | 9 | 7 | 15 | 49 | 30 | 39 | 49 |
| Public art | 49 | 34 | 20 | 9 | 19 | 36 | 22 | 11 | 21 |
| Monuments & memorials | 64 | 18 | 12 | 6 | 17 | 29 | 16 | 13 | 28 |
| Places of worship | 155 | 12 | 4 | 5 | 8 | 17 | 9 | 10 | 13 |
| Archaeology | 113 | 10 | 4 | 2 | 7 | 17 | 8 | 8 | 14 |
| Towers | 70 | 27 | 4 | 8 | 21 | 23 | 4 | 7 | 17 |
| Bridges & engineering | 83 | 14 | 6 | 8 | 12 | 12 | 4 | 8 | 8 |
| Squares & streets | 88 | 25 | 8 | 5 | 19 | 20 | 7 | 5 | 15 |

Three readings:

- **Wikivoyage's use is the strongest independent mark.** It covers 118 of the 155 canon entries
  under the line, and every Art Museums miss: the Guggenheim Bilbao, MASP, the Victoria and Albert
  Museum, the Centre Pompidou (as Musée National d'Art Moderne), the National Palace Museum in
  Taipei and the rest. It is a different measure from Wikipedia editions, not a weaker copy.
- **Atlas Obscura carries public art.** Atlas Obscura marks 20 of the 34 Public art entries under
  the line, and no other travel platform marks one it does not. Among them are the Crown Fountain
  (13 editions), Cadillac Ranch (10), the Kelpies (17), Salvation Mountain (10), Spoonbridge and
  Cherry (2), Puppy in Bilbao (9) and Escadaria Selarón (11). A fountain or mural famous in one
  country has few articles in other languages but is listed by the guide to curiosities.
- **Eight Public art misses are marked by nothing.** They are Maman, The Thinker, the Wynwood
  Walls, The History of Mexico, the Chicago Picasso, the Fontaine du Trocadéro, the Grand Cascade
  of Peterhof and the Bethesda Fountain. For three of them the canon's item is not the one the
  articles are about:
  - Maman is entered as the Bilbao cast (Q66913618, 2 sitelinks), while the series by Louise
    Bourgeois (Q180887) has 21.
  - The Thinker is entered as the Musée Rodin's cast (Q154571), while the type of sculpture
    (Q18003128) has 53.
  - The Wynwood Walls (Q123138647) are a new item beside the Wynwood neighbourhood (Q8040258).

  These three misses are a question of which item a place is, not of fame.
- **Encyclopedias add little beyond editions.** A place in three or more encyclopedias almost
  always has many Wikipedia editions already. Only 0 to 4 canon entries per kind are under the
  line and in three or more encyclopedias.

**What a signal would cost.** The second table counts the places in each kind's Wikidata pool
that the signal would bring in under the line. In brackets is the share of them a Wikivoyage
edition uses, the closest available measure of how many are worth a curator's look.

| Pool | Places | 22+ editions | Under the line with a travel ID | …in 3+ encyclopedias | …used by Wikivoyage |
|---|---|---|---|---|---|
| Art Museums | 12,143 | 248 | 1,672 (48 %) | 53 (83 %) | 3,433 |
| Public art | 196,121 | 186 | 1,333 (23 %) | 14 (43 %) | 2,262 |
| Monuments & memorials | 550,691 | 447 | 1,961 (33 %) | 71 (46 %) | 5,540 |
| Places of worship | 775,117 | 974 | 6,409 (25 %) | 122 (68 %) | 26,049 |
| Archaeology | 332,308 | 1,086 | 1,368 (43 %) | 264 (46 %) | 5,215 |
| Towers | 33,370 | 90 | 418 (38 %) | 7 (86 %) | 2,185 |
| Bridges & engineering | 210,979 | 275 | 986 (25 %) | 59 (37 %) | 2,267 |
| Squares & streets | 563,534 | 181 | 484 (26 %) | 18 (28 %) | 2,255 |

Atlas Obscura's share of the travel figure is small and concentrated. Of the 1,050 sculptures,
statues, murals and fountains it lists, 64 have 20 or more editions. A Public art tier admitted
through Atlas Obscura's listing would be a pool of about a thousand places, and the canon's
misses are inside it. Tripadvisor's listing is much broader: 3,677 places of worship and 1,432 art
museums. It comes nearer to a directory than to a selection. The Wikivoyage figure is the largest
of the three because Wikivoyage's listings name every museum and church a city article mentions.
As a gate it admits thousands per kind. As a check on a line it names the misses.

The signal needs no visit to the database. That an item carries an Atlas Obscura or a
Tripadvisor identifier is a Wikidata statement, published under CC0 and read from the dump.
Neither site's pages, terms or rate limits are involved until the catalogue wants something from
the database itself.

## A significance grade within a country

National registers grade what they protect, and Wikidata records the grade as a heritage
designation (P1435) on the item. The higher grade is the one a guide lists:

| Register (its identifier) | Higher grade: places, used by Wikivoyage | Common grade: places, used by Wikivoyage |
|---|---|---|
| National Register of Historic Places, US (P649) | National Historic Landmark: 2,506, 36.6 % | listed on the National Register: 85,628, 5.4 % |
| Monuments in Portugal, SIPA (P1700) | National Monument: 901, 30.2 % | heritage without legal protection: 4,723, 2.7 % |
| Mérimée, France (P380) | classé: 16,781, 14.4 % | inscrit: 36,416, 4.8 % |
| kulturnoe-nasledie.ru, Russia (P1483) | federal: 13,933, 11.0 % | regional: 40,550, 2.4 % |
| National Heritage List for England (P1216) | Grade I: 9,398, 9.9 % | Grade II: 350,430, 0.3 % |
| Historic Environment Scotland (P709) | category A: 6,655, 4.6 % | category B: 34,739, 0.3 % |

This is a regional-tier signal (ADR-0048) that is already in the dump: comparable within one
country, maintained by the state and present on hundreds of thousands of places. A Grade I church
in England or a classé one in France is what the country itself calls significant, whatever its
count of foreign-language articles.

## Lists for a regional tier

The registers above are lists a kind's regional tier could be filled or checked from. The
identifier on the item matches a row of a register to an item without any name matching.
Mérimée was read whole as the example:

- **Mérimée** is the Ministry of Culture's list of buildings protected as historic monuments,
  published on data.gouv.fr under the Licence Ouverte 2.0 and updated weekly. The CSV of
  2026-10-22 holds 46,761 rows: 14,996 classé, 31,317 inscrit and 448 other. 44,504 rows have WGS84
  coordinates. 45,602 of the rows' references are on a Wikidata item's Mérimée ID, and since the
  pass kept only an item's first value, that count is a floor. It is
  [recorded](../sources/heritage/fr-merimee.md).
- **England's National Heritage List** is on Historic England's open-data hub, under that hub's
  own terms. The terms page is on `historicengland.org.uk`, where every page fetched,
  `robots.txt` and the terms page included, answered 403. So the terms were not read and no
  record was written.
- **Others.** The US National Register is a federal record. Sweden's Open Cultural Heritage, the
  Bavarian monument authority, Denmark's Fund og Fortidsminder, Canmore and the Andalusian and
  Spanish registers each carry tens of thousands of places. Each is a regional-tier candidate for
  its country and is judged when a kind's issue looks at that country (`docs/tech/filling-a-kind.md`
  § 6.1).

Worldwide specialist lists exist only in narrow fields. Lighthouses have the ARLHS World List of
Lights and the Admiralty and NGA lists. Skyscrapers have the CTBUH Skyscraper Center. Theme parks
have the Roller Coaster DataBase and The Park Database. Theatres have Carthalia and the European
Theatre Architecture database. Botanic gardens have Botanic Gardens Conservation International.
Protected areas have the World Database on Protected Areas.

## Facts the catalogue lacks

- **An outline.** An OpenStreetMap relation (P402) or way (P10689) identifier names the object
  whose outline OpenStreetMap holds. Among the admitted places, a relation sits on 24 % of World
  Heritage Sites and 28 % of bridges, and a way on 50 % of monuments, 39 % of places of worship,
  35 % of towers and 27 % of bridges.
  The catalogue already reads outlines from the OpenStreetMap planet (ADR-0059). The Wikidata
  identifier is the link from an item to that outline where OpenStreetMap carries no `wikidata`
  tag.
- **Height and completion of a tower or skyscraper.** The CTBUH Skyscraper Center holds these for
  the 43 % of admitted Towers it lists. The site publishes no terms page, and its record is
  provisional.
- **A protected area's boundary and designation.** The World Database on Protected Areas holds
  both, but its terms bar redistribution and sub-licensing within derived works, which an
  outline drawn through the catalogue's vector tiles would be
  ([recorded](../sources/global/wdpa-protected-planet.md)).
- **A heritage grade.** It is already in the dump as P1435, above.

## Terms and access

Every site was judged by `docs/sources/site-access.md` and the `/coverage-survey` ground rules,
and the lines are in that table. In short:

| Database | `robots.txt` | Terms | What it allows |
|---|---|---|---|
| Atlas Obscura | open | page answered 403, not read | the identifier from Wikidata; pages not counted on |
| Tripadvisor | disallows ClaudeBot | Content API terms reserve the data (existing record) | the identifier from Wikidata only |
| Kültür Envanteri | open | bar copying data into databases by bots or scraping | the identifier from Wikidata only |
| Structurae | disallows ClaudeBot and `anthropic-ai` | — | the identifier from Wikidata only |
| archINFORM | disallows every Anthropic agent | — | the identifier from Wikidata only |
| Find a Grave | disallows every Anthropic agent | — | the identifier from Wikidata only |
| Rijksmonumentenregister (the Dutch register's site) | disallows ClaudeBot and `anthropic-ai` | — | the identifier from Wikidata only |
| Peakbagger | answers 403, as does every page fetched | — | the identifier from Wikidata only |
| Historic England | answers 403, as does every page fetched | not read | the identifier from Wikidata; the open-data hub's terms unread |
| CTBUH Skyscraper Center | open | no terms page linked | provisional |
| World Database on Protected Areas | open | publish only what cannot be downloaded; no redistribution; no sub-licensing | refused for outlines, which vector tiles and dumps redistribute; the identifier from Wikidata |
| Mérimée on data.gouv.fr | open | Licence Ouverte 2.0 | adoptable |
| Encyclopædia Britannica | open | page answered 403, not read | the identifier from Wikidata |
| GCatholic | open | no terms page linked | the identifier from Wikidata |

The pattern is the finding. The commercial and community catalogues worth most as a signal close
their pages to an AI agent, bar scraping or answer 403. They cannot be read, but their presence
on an item is Wikidata's own data. The databases that can be read whole are the states' registers
under open licences.

## How to rerun it

**The dump pass.** Each line of the dump is one entity, so the filter is applied line by line.
A line whose id is a target is written whole. A line that holds a coordinate claim
(`"P625":[{"mainsnak"`) is parsed and reduced to its compact record. Every claim key
(`"(P\d+)":\[\{"mainsnak"`) is counted. The external identifiers are the claims whose first
statement has `"datatype": "external-id"`, and the editions are the sitelinks ending in `wiki`,
leaving out Commons, Species, Meta, MediaWiki, Wikidata, Wikisource's shared site, Wikimania,
Incubator, Outreach, Foundation, Wikifunctions and the test wikis. In outline:

```python
with rapidgzip.open("wikidata-20261019-all.json.gz", parallelization=10) as f:
    for line in f:                                   # in 64 MB blocks, split across workers
        line = line.rstrip(b",\n")
        m = re.match(rb'^\{"type":"item","id":"(Q\d+)"', line)
        if not m:
            continue                                 # a property or a lexeme
        if m.group(1) in targets or b'"P625":[{"mainsnak"' in line:
            ent = orjson.loads(line)                 # → targets.jsonl / places.jsonl
```

**The local subset's reads** (development database, `track_regions`):

```sql
-- a kind's pool: every class under its roots
SELECT ancestor, class FROM workbench.wikidata_class_closure
WHERE ancestor IN ('Q23413', 'Q57821', 'Q1785071', 'Q57831', 'Q88291', 'Q17715832');
-- the items a Wikivoyage edition uses
SELECT item, string_agg(site, ',') FROM workbench.wikivoyage_usage GROUP BY item;
-- a property's own classes, which give the families
SELECT e.id, v->>'value' FROM workbench.wikidata_entities e,
       jsonb_array_elements(e.entity->'claims'->'P31') v
WHERE e.id = ANY ($1);
-- the catalogue's places, by kind
SELECT m.kind_id, m.admission, q
FROM experience_kind_memberships m
CROSS JOIN LATERAL unnest(CASE WHEN m.external_id ~ '^Q\d+$' THEN ARRAY[m.external_id]
                               ELSE coalesce(m.wikidata_items, '{}') END) q;
```

A root class was chosen as the item with that English label (`workbench.wikidata_labels`) used
most often as a class (P31). Every table above is a count over the compact records joined to
these reads. A place is in a pool when any of its classes is in the pool's closure. "Used by a
Wikivoyage edition" means the item is in `wikivoyage_usage`, and "under the line" means fewer
than 22 editions.

## What this does not show

- **A group is a pool, not a kind.** The groups are Wikidata's class trees under a few roots. The
  counts of a pool are not what a kind's run would gather, and the costs above are an upper bound
  of what a signal would bring before the kind's own rules.
- **Wikivoyage's use is not a selection by a guide's author alone.** An item is used when any
  listing or article in any edition links it. It marks "a guide names it", which for hotels and
  restaurants says little about fame.
- **Coverage is Wikidata's.** An identifier missing from an item may still exist in the database.
  The shares say how far the link can be read, not how far the database reaches.
- **First values only.** The compact records kept an item's first value of each identifier, so a
  match of a register's rows to items is a floor.
- **The canons of Art Museums, Public art, Monuments & memorials and Archaeology** were read as
  compiled on 2026-10-24, before their pull requests merged. The merged Public art canon
  (`db/catalogue-coverage/calibration/public-art.jsonl`) has since taken the works' own items,
  Maman as Q180887 and The Thinker as Q18003128, so of the three item questions in
  § A signal of fame? only the Wynwood Walls remains. The Bridges & engineering canon has gained
  lock and lift entries since the measurement (85 against the 83 counted here). The figures are
  left as measured.
- **Nothing here was tried as a rule.** No line was redrawn and no source was adopted. The figures
  say where each database could help, and what it would cost, on the data of these two days.

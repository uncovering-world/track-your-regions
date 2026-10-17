# Which source can give a place its street address, per kind (2026-10-17)

The measurement #1189 asked for. A card says where a place is in words a source wrote —
Groeningemuseum is "art museum in Bruges, Belgium" — and holds its coordinate, but no street
address: no sync reads one and `experiences.metadata` has no key for it. A traveller recommending
the museum, or walking to it, wants "Dijver 12, Bruges". Which source can supply that, for how much
of each kind, and in what form? This report states no plan; the issue that shows an address (#1193)
does. It closes with the recommendation #1189 asks for.

## The catalogue measured

Every place admitted to a kind on the development catalogue on 2026-10-16
(`experience_kind_memberships` with `admission = 'admitted'` and `missing_since IS NULL`), with the
Wikidata item it is known by: the membership's own `external_id` for the four kinds Wikidata fills,
and for World Heritage every item whose "World Heritage Site ID" (P757) equals the site's number
(`wikidata_claims`, the subset the catalogue keeps). A World Heritage site with several such items
counts once, as having an address when any of them has one.

| Kind | Places | With an item |
|---|---|---|
| World Heritage Sites | 1,272 | 1,192 |
| Art Museums | 92 | 92 |
| Public Art & Monuments | 178 | 178 |
| Places of worship | 1,082 | 1,082 |
| Archaeology | 1,111 | 1,111 |

3,412 distinct items in all. A further 83 items were read for the named places below that the
development catalogue does not admit, Groeningemuseum among them (refused in Art Museums). Those
are left out of every count.

## Candidates and their terms

- **Wikidata** — "street address" (P6375, a monolingual text: the address as one string, with its
  language), and "located on street" (P669, an item) with the qualifier "house number" (P670).
  CC0, as the register's records already quote
  ([`global/wikidata-qlever.md`](../sources/global/wikidata-qlever.md)); an address read from it
  carries no obligation.
- **OpenStreetMap** — the `addr:*` tags (`addr:street` or `addr:place`, `addr:housenumber`,
  `addr:postcode`, `addr:city`, `addr:full`) of the object that carries the place's item in its
  `wikidata` tag, which is how the catalogue's existing OpenStreetMap door joins OSM to a row
  ([`global/openstreetmap-qlever.md`](../sources/global/openstreetmap-qlever.md)). ODbL 1.0, on the
  terms of [ADR-0059](../decisions/0059-what-the-catalogue-takes-from-openstreetmap-it-keeps-separable-and-offers-under-odbl.md):
  a fact taken from OSM is stored with its provenance (the object and the tag), the OSM-derived part
  is offered under ODbL, and "© OpenStreetMap contributors" is shown wherever that fact is shown —
  on a card that shows an address read from OSM, beside it. ADR-0059 decision 4 asks the connector's
  register record to quote the guidelines that apply before any code reads OSM for this; for an
  address that includes the OSMF Geocoding guideline beside the ones the record already quotes.
- **Reverse geocoding the stored coordinate** is not a candidate (the issue's own exclusion): it
  sends every place to a third party and returns the nearest address, not the place's.

## Method

- **Wikidata**: `wbgetentities` on `www.wikidata.org/w/api.php` (`props=claims`, `maxlag=5`), 50
  items a request, one request at a time with 1.5 s between them, the project's bot User-Agent
  (`userAgent({ bot: true, purpose: 'street-address survey #1189' })`), 70 requests, read on 2026-10-16. Not the SPARQL endpoints: the set is small and the live API answers it
  directly. A statement of rank *deprecated* is not counted.
- **OpenStreetMap**: QLever's `osm-planet` endpoint (`qlever.dev/api/osm-planet`), the mirror the
  Archaeology door already reads ([`global/openstreetmap-qlever.md`](../sources/global/openstreetmap-qlever.md)),
  on 2026-10-17. Every object carrying `wikidata=<item>` for 100 items a question, with its
  `addr:street`, `addr:place`, `addr:housenumber`, `addr:postcode`, `addr:city` and `addr:full`
  tags. The questions were sent one at a time, each held back for as long as the last one took and
  never less than a second. A 429 would have ended the pass, with no retry. 35 questions read all
  3,412 items that have one, and the slowest took 573 ms. The join is by tag across the whole planet,
  with no radius around the stored point. A first pass on 2026-10-16 through Overpass instances was
  stopped at 995 items: overpass-api.de was at capacity, and the fallback answered 8 items a
  question. The figures below come from the QLever pass alone.
- **Counted as an address**: in Wikidata, a P6375 value, or a P669 street with a P670 house
  number; in OSM, a street (or `addr:place`) with a house number, or `addr:full`. A street with no
  number is counted separately: for a monument on a square it is the right answer, for a museum it
  is not enough to walk to.

The scripts lived in `~/.cache/tyr-dl/1189/` and are not in the repository; the questions they sent
are above.

## Results

### Wikidata, every admitted place

| Kind | Places | P6375 | P669 street | P669 + P670 number | An address (P6375, or street + number) | Any of them |
|---|---|---|---|---|---|---|
| World Heritage Sites | 1,272 | 82 | 17 | 9 | **84 (6.6 %)** | 89 (7.0 %) |
| Art Museums | 92 | 66 | 33 | 25 | **72 (78.3 %)** | 75 (81.5 %) |
| Public Art & Monuments | 178 | 23 | 30 | 5 | **27 (15.2 %)** | 49 (27.5 %) |
| Places of worship | 1,082 | 297 | 134 | 59 | **319 (29.5 %)** | 357 (33.0 %) |
| Archaeology | 1,111 | 136 | 39 | 21 | **142 (12.8 %)** | 152 (13.7 %) |

By type within a kind (places with an address / places):

| Kind | Type | With an address |
|---|---|---|
| World Heritage | cultural | 78 / 990 (7.9 %) |
| World Heritage | natural | 4 / 240 (1.7 %) |
| World Heritage | mixed | 2 / 42 (4.8 %) |
| Public Art | monument | 15 / 90 (16.7 %) |
| Public Art | sculpture | 12 / 88 (13.6 %) |
| Places of worship | synagogue | 8 / 13 (61.5 %) |
| Places of worship | church | 117 / 229 (51.1 %) |
| Places of worship | chapel | 13 / 27 (48.1 %) |
| Places of worship | shrine | 11 / 23 (47.8 %) |
| Places of worship | cathedral | 101 / 287 (35.2 %) |
| Places of worship | monastery | 27 / 162 (16.7 %) |
| Places of worship | temple | 22 / 152 (14.5 %) |
| Places of worship | mosque | 18 / 175 (10.3 %) |
| Archaeology | museum | 80 / 105 (76.2 %) |
| Archaeology | site | 62 / 1,006 (6.2 %) |

By country, the fifteen with the most places, all kinds: Italy 156 / 355 (43.9 %), Japan 33 / 76
(43.4 %), France 60 / 151 (39.7 %), Germany 47 / 140 (33.6 %), the United Kingdom 26 / 118
(22.0 %), Russia 16 / 78 (20.5 %), Spain 18 / 128 (14.1 %), Israel 7 / 63 (11.1 %), Mexico 5 / 70
(7.1 %), Greece 9 / 148 (6.1 %), Turkey 6 / 136 (4.4 %), India 4 / 135 (3.0 %), Egypt 4 / 137
(2.9 %), China 0 / 66, Iraq 0 / 58. The languages of the P6375 values follow: Italian is the most
common in four kinds of five (107 of 297 among places of worship).

### OpenStreetMap, every admitted place

| Kind | Places | An OSM object | A street (`addr:street` / `addr:place`) | Street + number, or `addr:full` | Wikidata's address (above) | Both | OSM alone | **Either source** |
|---|---|---|---|---|---|---|---|---|
| World Heritage Sites | 1,272 | 726 (57.1 %) | 69 (5.4 %) | 43 (3.4 %) | 84 (6.6 %) | 16 | 27 | **111 (8.7 %)** |
| Art Museums | 92 | 90 (97.8 %) | 64 (69.6 %) | 53 (57.6 %) | 72 (78.3 %) | 44 | 9 | **81 (88.0 %)** |
| Public Art & Monuments | 178 | 167 (93.8 %) | 21 (11.8 %) | 11 (6.2 %) | 27 (15.2 %) | 5 | 6 | **33 (18.5 %)** |
| Places of worship | 1,082 | 1,032 (95.4 %) | 403 (37.2 %) | 264 (24.4 %) | 319 (29.5 %) | 106 | 158 | **477 (44.1 %)** |
| Archaeology | 1,111 | 928 (83.5 %) | 104 (9.4 %) | 56 (5.0 %) | 142 (12.8 %) | 37 | 19 | **161 (14.5 %)** |

Across the five kinds, 863 of 3,735 places have an address from either source. 644 have one from
Wikidata, and OpenStreetMap adds 219 that Wikidata lacks. OSM adds the most to places of worship,
158 of its 219: a church or a mosque is mapped by people who walk past it, while its Wikidata item
was often made from a list.

By type, with either source:

| Kind | Type | With an address |
|---|---|---|
| World Heritage | cultural | 104 / 990 (10.5 %) |
| World Heritage | natural | 5 / 240 (2.1 %) |
| World Heritage | mixed | 2 / 42 (4.8 %) |
| Public Art | monument | 21 / 90 (23.3 %) |
| Public Art | sculpture | 12 / 88 (13.6 %) |
| Places of worship | synagogue | 11 / 13 (84.6 %) |
| Places of worship | church | 157 / 229 (68.6 %) |
| Places of worship | cathedral | 177 / 287 (61.7 %) |
| Places of worship | chapel | 15 / 27 (55.6 %) |
| Places of worship | shrine | 11 / 23 (47.8 %) |
| Places of worship | mosque | 42 / 175 (24.0 %) |
| Places of worship | monastery | 36 / 162 (22.2 %) |
| Places of worship | temple | 26 / 152 (17.1 %) |
| Archaeology | museum | 89 / 105 (84.8 %) |
| Archaeology | site | 72 / 1,006 (7.2 %) |

14 places of worship carry no type, and 2 of them have an address.

For museums and places of worship by country, the thirteen with at least 25 places:
- above 85 %: Germany 60 / 67 (89.6 %), the United States 25 / 29 (86.2 %);
- 65 to 80 %: Russia 35 / 46 (76.1 %), Japan 31 / 42 (73.8 %), Italy 101 / 148 (68.2 %), France 43 / 66 (65.2 %);
- 13 to 27 %: the United Kingdom 16 / 60 (26.7 %), Spain 12 / 48 (25.0 %), Turkey 13 / 55 (23.6 %), China 4 / 29 (13.8 %);
- under 5 %: India 2 / 48 (4.2 %), Egypt 1 / 28 (3.6 %), Greece 1 / 38 (2.6 %).

What OSM holds is in the local script and order, as Wikidata's values are. For example:
- Hagia Sophia: "Ayasofya Meydanı 1, 34122 İstanbul";
- the Hermitage: "Дворцовая набережная 38 литА";
- the Louvre Abu Dhabi: "Jacques Chirac St 133, Abu Dhabi".

Japan's block addresses do not fit OSM's street and number. The Tokyo National Museum carries a
house number "9", a postcode and the ward 台東区, but no street. Kinkaku-ji carries a postcode and
a city only. Wikidata holds both in full, in Japanese.

### Where both sources answer

184 places carry both a Wikidata P6375 value and an OSM street with a number. In 152 of them the
house numbers share a digit group. The other 32 are of two kinds:

- **Wikidata has the street and no number**, and OSM has the number: Am Markt (OSM 21) for Bremen's
  Town Hall, Woodward Avenue (5200) for the Detroit Institute of Arts, Karlsplatz (10) for the
  Karlskirche, Place du Palais (1) for Avignon Cathedral.
- **The two name different doors of one building.** Each is an address a visitor could be
  sent to, and the choice is not one a rule can make:
  - the Hermitage: Дворцовая набережная 34 against 38;
  - the Kunsthistorisches Museum: Museumsplatz 2 against Burgring 5, with the Natural History
    Museum opposite the same pair, Museumsplatz 3 against Burgring 7;
  - Antwerp Cathedral: Handschoenmarkt against Groenplaats 21;
  - Würzburg Cathedral: Kiliansplatz 4 against Domstraße 42;
  - Bremen Cathedral: Sandstraße 10–12 against Am Dom 1;
  - St Peter's Church, Riga: Skārņu iela 19 against Reformācijas laukums 1;
  - the Neues Museum, Berlin: Bodestraße through the James-Simon-Galerie against Bodestraße 1.

  The Marine Corps War Memorial is the one case of a plain mismatch: "US Marine Memorial Circle"
  against Marshall Drive 1000.

### The form of what Wikidata holds

561 of the 3,412 items carry a P6375 value that is not deprecated. Of those 561:
- 109 (19 %) carry several values that differ;
- 344 (61 %) hold more than a street and a number, that is, a comma;
- 234 (42 %) hold a postcode-shaped token: four to six digits, or a letter followed by a digit;
- 435 (78 %) hold a digit at all.

Read on named places:

| Place | P6375 | P669 + P670 | Reads as |
|---|---|---|---|
| Groeningemuseum, Bruges | "Dijver 12" (nl) | — | the street and number, no town; the postcode 8000 is a separate statement (P281) |
| St Bavo's Cathedral, Ghent | "Sint-Baafsplein 1A" (nl) | — | the same shape; P281 9000 |
| Rijksmuseum, Amsterdam | "Museumstraat 1" (nl) | Museumstraat, 1 | both agree |
| Uffizi Gallery, Florence | "Piazzale degli Uffizi 6, I-50122 Firenze" (it) | Piazzale degli Uffizi, 6 | a whole address, pasteable |
| Kunsthistorisches Museum, Vienna | "Museumsplatz 2" (de) | Burgring, 5 | two statements naming two different addresses; Museumsplatz is the MuseumsQuartier's square across the road |
| Mauritshuis, The Hague | "Plein 23" and "Plein 29" (nl) | Plein, 29; Korte Vijverberg, no number | two values of each, all of normal rank |
| Pantheon, Rome | three variants of "Piazza della Rotonda", one with "18" | — | three values, none preferred |
| Notre-Dame de Paris | "Place du Parvis de Notre-Dame 6" (fr) | parvis Notre-Dame – place Jean-Paul-II, 6 | agrees |
| Hermitage Museum, Saint Petersburg | "Санкт-Петербург, Дворцовая набережная, 34" (ru) | — | whole, in Cyrillic |
| Kiyomizu-dera, Kyoto | "京都府京都市東山区清水1丁目294" (ja) | — | whole, in the Japanese order and script |
| Cologne Cathedral | — | Domkloster, 4 | an address only through P669 |
| Louvre Museum | — | Rue de Rivoli, no number | a street, not an address; P281 75001 |
| Sultan Ahmed Mosque, Istanbul | — | — | none |
| Belfries of Belgium and France | — | — | none, and none can exist: 56 belfries in two countries |

A random twelve of them show the same spread: "Via Labicana 95, Roma 00184 Italia", "Am
Haddebyer Noor 32, 4866 Busdorf", "Maršala Tita br. 14, 71000 Sarajevo" are whole; "Stephansplatz
1" and "via di Roma, 53" are a street and a number with no town; "Tallinn, Vene tänav 18" puts the
town first; "Pla Seu, 3, Comtes, 1, Pietat, 1, Bisbe, 10 i Santa Llúcia, 2" is a building on four
streets; "A. B. Dietmayr-Straße 1, u. a." carries an "and others"; the Grand Palace in Bangkok's is
a Thai postal address.

## Which kinds an address fits

- **A museum** — an art museum, or Archaeology's museum type — has a door with a number on it, and
  Wikidata already gives three in four of them one (78 % and 76 %).
- **A synagogue, church, chapel or shrine** has one too, and Wikidata gives about half (8 of the 13
  synagogues); cathedrals a third.
  A monastery, temple or mosque often stands in its own grounds or outside a town's street grid,
  and Wikidata's figures fall to 10–17 %: Sultan Ahmed Mosque has none, Kiyomizu-dera a Japanese
  block address.
- **A monument or a sculpture** stands on a square or in a park: the street (a square's name) is
  the useful answer and a house number is usually absent — 49 of 178 have a street or an address,
  27 a number.
- **A World Heritage site or an excavation** has a location, not an address, in the great majority:
  a serial site (the Belfries, 56 belfries), a natural site (1.7 %), a dig in open country (6.2 % of
  Archaeology's sites). The exceptions are single buildings — Cologne Cathedral (Domkloster 4),
  Notre-Dame — that the catalogue also holds under another kind.

## What it does not show

- Coverage is counted on the development catalogue, whose admitted rows are the world tier the
  runs produced on 2026-10-16; a region's own tier, when it is filled, may differ.
- "Pasteable into a maps app" was read by hand on the named places, not tested in an app; a
  street and a number with no town ("Dijver 12") is counted as an address although it needs the
  town the card already names beside it.
- OSM's `wikidata` tag points at the item of the mapped object, which is not always the item the
  catalogue holds (ADR-0059 decision 4's Pompeii case). A miss in OSM may therefore be a tag on a
  neighbouring object, and a hit may be a building inside a larger site: 726 World Heritage sites
  have an OSM object, but only 43 an address.

## Recommendation

- **Sources: both, Wikidata first.** In order:
  1. Wikidata's P6375;
  2. P669 with P670;
  3. OpenStreetMap's street and number (or `addr:full`), with `addr:postcode` and `addr:city` beside them.

  Wikidata alone covers 78 % of art museums and 30 % of places of worship. OSM raises those to 88 %
  and 44 %, and it is the larger gain for churches and mosques. Both already have a register
  record, with the read #1193 adds to it. What is taken from OSM is kept with the object and the
  tag it came from, and "© OpenStreetMap contributors" is shown beside the address it supplies
  (ADR-0059), so the OSM part stays separable. Reverse geocoding stays out.
- **Kinds: offer an address only where a building has a door.**
  - Offer it for art museums, Archaeology's museums, and synagogues, churches, cathedrals, chapels
    and shrines, which are at 48 % to 88 % with both sources.
  - Offer it on a mosque, monastery or temple when a source holds one (17 % to 24 %), with no
    expectation that it will.
  - Offer a street or square alone for a monument or sculpture: the square is the useful answer
    there.
  - Never offer one for a World Heritage site, an excavation or a natural site. At 2 % to 10 %, an
    address there is usually one building of the site, which the catalogue holds under its own kind
    when it matters (Cologne Cathedral among the places of worship).
- **Stored shape: one named fact under #574's model**, `address`. It holds the text, its language,
  the source and, for OSM, the object, and it does not repeat the town or country the card already
  names. Each source's view is kept the way a membership keeps `reported_*`. Two views that name
  different doors, as for the Hermitage, are a contradiction the curator settles, under the same
  rule as a contradicted name or coordinate (#1246). A rule cannot tell which door a visitor wants,
  and the 32 cases above show the two sources are each sometimes the better one.
- **When there is none, the card shows nothing.** It keeps its line ("art museum in Bruges,
  Belgium") and *Open in* (#1194), which hands the stored point to a maps app and is the route for
  every place without an address. An empty "Address" row tells a visitor nothing they can act on.
  Where an address is shown, it is selectable and copyable, as the card's name already is (#1190).

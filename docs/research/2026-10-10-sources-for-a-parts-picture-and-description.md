# Which open sources give a World Heritage component its picture and description (2026-10-10)

The survey #1306 asked for: a component of a serial World Heritage site that has no Wikidata item
shows the site's picture and no description of its own (#1270, #1272). Which open sources name
such a component, what do they give — a Commons picture, a description, an official id, a road to
the item — and under which terms? Each source read has its record in `docs/sources/`; this report
is the measurement those records cite. It states no plan: the issues that cite it do (#1337,
#1339, #1340, #1341).

## The sample

401 component points of three serial sites on the development catalogue on 2026-10-10
(`experience_locations` rows of `experiences` 721, 1755 and 418, with `missing_since IS NULL`;
the country by GADM level-1 containment):

| Site | Points | With a Wikidata item | Countries |
|---|---|---|---|
| Frontiers of the Roman Empire – Dacia (721) | 277 | 0 | Romania 277 |
| Aalto Works (1755) | 13 | 0 | Finland 13 |
| Prehistoric Pile Dwellings around the Alps (418) | 111 | 108 | Switzerland 56 (3 without an item: Spitz, Les Grèves, Les Roseaux), Italy 19, Germany 18, France 11, Austria 5, Slovenia 2 |

The Pile Dwellings are the control: a site Wikidata already covers, so a source is measured on
what it adds where an item exists and on the three Swiss points where none does.

## Method

Every read used the project's bot User-Agent (`userAgent({ bot: true, purpose: 'source survey
#1306' })`), one request at a time with a pause of at least a second, back-off on 429 and 5xx with
`Retry-After`, and a dump wherever the question was a bulk one. Each site's `robots.txt` and terms
were read before its first request. Names were compared by trigram similarity (the Jaccard index
of trigram sets over folded names, as `nameSimilarity` in `componentItemMatching.ts` does); a
source "names" a point when a feature within the radius scores ≥ 0.5, and where that test is the
wrong one the hand-read count is given beside it. The scripts lived in `data/tmp-1306/` and are
not in the repository; the queries they sent are here.

- **Wikipedia and Commons:** `GET https://<lang>.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=<lat>|<lon>&gsradius=500&gslimit=20&gsprop=type|name` per point, in the site's languages and English (Dacia ro, en; Aalto fi, en; the Alps de, fr, it, sl, en); the same on `commons.wikimedia.org` with `gsnamespace=6&gsradius=300&gslimit=50`; `action=query&titles=Category:<name>` on Commons; for Romania a second pass with `gsprimary=all&gsradius=1000&gslimit=30`; for Aalto `generator=geosearch&ggsradius=500&prop=pageprops|coordinates&ppprop=wikibase_item`.
- **OpenStreetMap:** Overpass (`https://overpass-api.de/api/interpreter`), one bounding-box question per site — Dacia `nwr["historic"~"^(archaeological_site|castle|fort|fortress|ruins|city_gate|citywalls)$"]` or `nwr["name"~"castr",i]`; Aalto `nwr["architect"~"Aalto"]` or `nwr["name"~"Aalto"]` — `out center tags`, a minute apart; the Alps through QLever's osm-planet mirror in one question: `?s osmkey:historic "archaeological_site" . ?s geo:hasGeometry/geo:asWKT ?wkt . BIND(geof:centroid(?wkt) AS ?c)` filtered on `geof:latitude(?c)`/`geof:longitude(?c)` to the Alpine box, with `osmkey:name|wikidata|wikipedia|wikimedia_commons|image|description` optional (3,153 objects, 7 s), after a per-point Overpass pass with `around:1000` had spent ninety minutes in back-offs without an answer.
- **Pleiades:** the CSV dumps `pleiades-places-latest.csv.gz` and `pleiades-names-latest.csv.gz` of 2026-10-09 from `atlantides.org/downloads/pleiades/dumps/`, matched locally within 3 km (34,878 places with a representative point).
- **Wikidata by register code:** one QLever query (`https://qlever.dev/api/wikidata`): `SELECT ?item ?code ?coord ?label ?image WHERE { ?item wdt:P1770 ?code . ?item wdt:P625 ?coord . OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "ro") } OPTIONAL { ?item wdt:P18 ?image } }` (7,234 rows, 2.8 MB, 2 s), matched locally within 1.5 km.
- **National registers:** the Finnish Heritage Agency's WFS (`https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs`, GetFeature as GeoJSON in EPSG:4326 for `maailmanperinto_piste` and `suojellut_rakennukset_piste`, then `cql_filter` ILIKE questions by Finnish name on the point and area layers); the Swiss KGS inventory's INTERLIS dump (`https://data.geo.admin.ch/ch.babs.kulturgueter/kulturgueter/kulturgueter_2056.xtf.zip`, release of 2026-09-28, LV95 converted with swisstopo's approximate formulas); Romania's list read only through Wikidata and the Romanian Wikipedia, the institute's own site reserving its content (below).
- **Terms read:** museovirasto.fi (the geodata CC BY 4.0), rky.fi (a page's text and photographs © Museovirasto), opendata.swiss (`terms_open`, "Open use"), pleiades.stoa.org/credits and atlantides.org (CC BY 3.0; the site's `robots.txt` closes `/names/`, `/features/`, `/collections/`), patrimoniu.ro *Termeni și condiții* (no copying or downloading without written permission), map.cimec.ro and eism.geo-spatial.ro (no `robots.txt`, an ArcGIS service with empty `copyrightText`), gazetteer.dainst.org (`robots.txt` allows all; CC BY 4.0 per its record), the Wikimedia terms of use and API etiquette.

## Results

### Wikipedia by place, and the item it carries

| Site | Points | An article within 500 m | Title ≈ name | Of the points without an item: a named article |
|---|---|---|---|---|
| Dacia | 277 | 46 | 2 | 2 |
| Aalto | 13 | 13 | 6 | 6 |
| Alps | 111 | 88 | 34 (fr 19, de 13, en 12, it 7) | 1 of 3 |

The name test under-counts. Read with `pageprops`, **all 13 Aalto components have an article
with a Wikidata item within 500 m, and for 11 of them it is the building itself at 4–34 m**:
Villa Mairea (Q2706241, 12 m), Villa Aalto for the Aalto House (Q17405833, 5 m), Studio Aalto
(Q17380008, 13 m), Aalto-keskus (Q4250273, 23 m), Finlandia Hall (Q1142522, 34 m), Paimio
Sanatorium (Q368706, 30 m), Kulttuuritalo (Q6305770, 8 m), the Church of the Three Crosses
(Q3674365, 4 m), Säynätsalo Town Hall (Q2456080, 9 m), Muuratsalon koetalo (Q5755595, 5 m,
Finnish edition only), the Kela head office (Q11869698, 12 m, Finnish only); the twelfth, Sunila,
has the district's article (Q3977023) at 311 m, and the thirteenth, the Aalto Campus, has
Seminaarinmäki (Q11892928), the campus hill, at 71 m. The class-based item finder (#1272) had proposed none of them. For Dacia the primary
pass finds the village: 46 of 277 points have any article within 500 m, two of them named for
the place (the villages of Spermezeu). Asked with `gsprimary=all` within 1 km, the Romanian
edition answers for 65 points with an article, **23 with a castra article** — *Castrul roman de
la Gresia*, *de la Pojejena*, *de la Hoghiz* and *de la Rucăr* at 1 m, *Pons Augusti* at Voislova
at 0 m, *Resculum* at Bologa at 280 m, *Buridava* at 343 m, *Ad Pannonios* at 578 m, *Largiana* at
650 m — whose coordinates GeoData holds as secondary and a primary-only search never returns,
and 46 with a row of the county's *Lista monumentelor istorice* or *Lista siturilor arheologice*
(11 within 300 m), each row with its LMI code, address, coordinate and Commons picture. Around
the Alps the primary pass matches 34 of 111 by name (Robenhausen, Egolzwil 3, Lavagnone,
Hautecombe, Môtier) in a site where 108 already have an item; of the 3 Swiss points without one,
1 has a named article.

### Wikimedia Commons by place

Geotagged files within 300 m: Dacia 14 of 277 points, none named for the fort; Aalto 11 of 13,
4 named (Villa Mairea 17 files, Paimio 18; Finlandia Hall and the Aalto Centre at the 50-file
cap); the Alps 68 of 111, 4 named. A Commons category of the component's English name exists
for none of the 401. A geotag says where the camera stood, not what it shows — at a lakeshore
the files are of the lake.

### OpenStreetMap

| Site | Points | A historic object within 1 km | Name ≈ | Top object with `wikidata` | With `wikimedia_commons`/`image` | With `description` |
|---|---|---|---|---|---|---|
| Dacia | 277 | 27 | 2 | 15 | 1 | 1 |
| Aalto | 13 | 11 | 5 | 9 | 5 | 0 |
| Alps | 111 | 48 | 8 | 29 (13 the point's own item) | 5 | 2 |

The `wikidata` tag is a second road to the item: Villa Mairea at 9 m (Q2706241), Paimion
Parantolan päärakennus at 11 m (Q368706), Säynätsalon Kunnantalo at 6 m (Q2456080), Castrul
roman Buridava at 324 m (Q612849); of the three Swiss pile dwellings with no item, two have a
tagged object — "Morges - Les Roseaux" at 31 m (Q3324041) and the "Village lacustre" at Les
Grèves, 180 m (Q3558997). OSM carries almost no picture of its own (one `image` tag among the
277 Dacian points) and no description.

### Wikidata items that carry a national register code

Romania's LMI code (P1770): 7,045 items with a coordinate, all with a Romanian label, 2,921 with a
picture. 34 Dacian points have one within 1 km; 20 of those carry an archaeology code (`XX-I-…`),
17 are castra by label (Gresia and Pojejena at 0 m, Buridava 340 m, Tibiscum 483 m, Ad Pannonios
577 m, Livezile 674 m, Târsa 687 m), 19 have a P18. The other 14 are the village's wooden church
or a roadside cross 300–1,000 m away (Muncel, Lozna, Șintereag): the code's group letter and the
label tell a fort from its neighbour, distance alone does not. Of the 22 castra-like items within
1 km, the finder's near rule (≤ 500 m and similarity ≥ 0.3, or the same name within 1 km) passes
2: seven are within 500 m with similarity 0.0–0.27 ("Gresia - La Biserică" against "Castrul roman
de la Gresia" scores 0.21 at 0 m — the generic "Castrul roman de la" dilutes the shared toponym
under the Jaccard index), thirteen are 500–1,000 m away. A whole-word toponym test takes eleven
of the 22. Switzerland's PCP reference number (P381) is on 13,604 items, 13,490 with a
coordinate; Finland's RKY id is P4009.

### Pleiades

| Site | Points | A place within 1 km | Name ≥ 0.5 | …with a description |
|---|---|---|---|---|
| Dacia | 277 | 23 | 9 | 9 |
| Alps | 111 | 10 | 2 | 2 |
| Aalto | 13 | 0 | 0 | 0 |

The Dacian near-misses are the right forts under their ancient names — Bologa – Grădiște has
Resculum 279 m away, Vărădia – Chilii has Arcidava at 829 m, Teregova – La Hideg has Ad Pannonios
at 904 m — so the name test is the wrong one for this source; the descriptions run 46–205
characters ("Roman fort"), and there are no pictures. Around the Alps the two hits (Ägelmoos,
Siedlung Forschner) are the prehistoric sites; the other eight within a kilometre are Roman
neighbours (Turicum, Tasgetium).

### The national registers

| Register | Terms | Of the sample | Fills where Wikidata does not |
|---|---|---|---|
| Switzerland — KGS inventory (BABS, INTERLIS dump of 2026-09-28; `docs/sources/heritage/ch-kgs-inventar.md`) | opendata.swiss «Open use» | 51 of 56 Swiss pile-dwelling points have an A-object within 300 m whose description names the nomination's component code ("Spitz (CH-FR-03), Fundstelle der UNESCO Welterbestätte…"); 6 with a picture, each a third party's ("© www.picswiss.ch"), none a Commons file | 3 of 3 (Spitz, Les Grèves, Les Roseaux) |
| Romania — LMI through Wikidata and the Romanian Wikipedia (`docs/sources/heritage/ro-lmi.md`) | Wikidata CC0; Wikipedia CC BY-SA 4.0; patrimoniu.ro reserves its content, map.cimec.ro states no terms | 34 of 277 Dacian points have an LMI-coded item within 1 km, 17 castra, 19 with a Commons picture; 46 have a county list row | 17 of 277 — an item, not yet a picture of the part |
| Finland — Museovirasto WFS (`docs/sources/heritage/fi-museovirasto-suojellut.md`) | CC BY 4.0 geodata; rky.fi text and photographs © Museovirasto | the RKY *area* layer holds Paimion parantola, Sunilan tehtaat ja asuinalue, Seinäjoen Aalto-keskus, Säynätsalon teollisuusyhdyskunta, Finlandia-talo/Kulttuuritalo; the protected-buildings layer holds 1 of 13 (the Church of the Three Crosses), its other hits being neighbours | a Finnish description page to link, no picture |

## What it does not show

- No sample point *without an item* lies in France, the Netherlands, England or Austria — the
  11 French and 5 Austrian Pile Dwellings points all carry one, as do the Italian, German and
  Slovenian ones — so Mérimée, the Rijksmonumenten register, Historic England's list and
  Austria's Denkmalliste, named in #1306, had no gap to measure and were not read. Mérimée's
  portal moved to a JavaScript-only site on the day of reading, Historic England answers a bot
  with a 403 challenge page, which is not a reading, and data.gv.at's CKAN endpoint answered
  404; their terms are unread here. Europeana needs an API key and is `provisional`.
- The trigram name test is the finder's own rule, not a judgement of the sources: every "named"
  count above is a lower bound, and the hand-read counts beside them say by how much.
- A geotagged Commons file was counted, never opened: whether it shows the component is a
  curator's reading, not a measurement.
- Pleiades and the registers were matched on a representative point; a Pleiades place or a KGS
  area object with a rough location can be the right place further than the radius.

## The issues that act on it

#1337 (one connector shape for national registers, designed before the first is adopted), #1339
(Wikipedia by place as the item finder's second door), #1340 (a whole-word toponym rule and a
register code as a second key), #1341 (the Commons files near a point as a curator's pick), and
#1342 (the component card's map and shape). The product decision they rest on — the general
sources first, no national register adopted for the parts now — is recorded on #1306.

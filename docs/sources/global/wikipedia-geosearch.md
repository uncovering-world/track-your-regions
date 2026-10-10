---
slug: wikipedia-geosearch
name: Wikipedia, the articles near a point (list=geosearch, with every coordinate a page carries) and their Wikidata items
publisher: Wikimedia Foundation (the service); the editions' contributors (text under CC BY-SA 4.0)
urls:
  home: https://www.wikipedia.org/
  dataset: https://www.mediawiki.org/wiki/Extension:GeoData
  api: https://<lang>.wikipedia.org/w/api.php?action=query&list=geosearch (or generator=geosearch with prop=pageprops|coordinates)
  terms: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, asked one point at a time in the country's languages and English" }
row:
  identity: "the article, and through pageprops its Wikidata item (wikibase_item) — the item is the identity"
  wikidata_link: itself
  coordinates: all
  languages: [every edition asked — the country's languages and en]
  signal: "an article exists, in the local edition or in English; with gsprimary=all, a row of a list article (the Romanian county monument lists) carries its own coordinate"
terms:
  licence: "CC BY-SA 4.0 (the text); the pictures are Commons files under their own licences"
  database_right: share-alike
  attribution: "Wikipedia (<lang>), CC BY-SA 4.0 — and nothing of the text is copied: the item is what is read"
  scraping: not-needed
access:
  mode: api
  format: "MediaWiki API; list=geosearch (gsradius ≤ 10 km, gsprimary primary|secondary|all, gsprop type|name), or generator=geosearch with prop=pageprops (ppprop=wikibase_item) and prop=coordinates to get the item and the distance in one call"
  cadence: continuous
  volume: "per point, 0–20 articles within 500 m on the sample"
  rate: "Wikimedia's API etiquette: one request at a time, a descriptive User-Agent (userAgent() with the bot marker), back off on 429 and 5xx with Retry-After"
scorecard:
  date: 2026-10-10
  completeness: 1
  identity: 2
  coordinates: 2
  names: 2
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 14
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# Wikipedia, by place

An article about a building or a fort carries its coordinate, and almost every article carries a
Wikidata item. Asked by place, Wikipedia is a class-free, language-aware door to the item a
component is — which is then the door to its picture (P18, P373) and description, as #1270
already reads them. Looked at by #1306 because the item finder (#1272) proposes candidates by
Wikidata class and name and had found nothing for the Aalto Works and 7 candidates for 277
Dacian forts.

**What was measured (2026-10-10).** `data/tmp-1306/wiki.mts` asked `list=geosearch` within
500 m of each of 401 component points in the site's languages and English (Dacia: ro, en;
Aalto: fi, en; the Alps: de, fr, it, sl, en), primary coordinates only, one request a second:

| Site | Points | Points with an article within 500 m | …a title resembling the name (≥ 0.5) |
|---|---|---|---|
| Frontiers of the Roman Empire – Dacia (721) | 277 | 46 | 2 (the villages of Spermezeu) |
| Aalto Works (1755) | 13 | 13 | 6 |
| Prehistoric Pile Dwellings around the Alps (418) | 111 | 88 | 34 (fr 19, de 13, en 12, it 7) |

The name test under-counts Aalto: `aalto-items.mts` read the same 500 m with
`generator=geosearch` and `prop=pageprops` and found that **all 13 components have an article
with an item within 500 m, and for 11 of them it is the building itself at 4–34 m** — Villa
Mairea Q2706241 (12 m), Villa Aalto Q17405833 for the Aalto House (5 m), Studio Aalto Q17380008
(13 m), Aalto-keskus Q4250273 (23 m), Finlandia Hall Q1142522 (34 m), Paimio Sanatorium Q368706
(30 m), Kulttuuritalo Q6305770 (8 m), the Church of the Three Crosses Q3674365 (4 m), Säynätsalo
Town Hall Q2456080 (9 m), Muuratsalon koetalo Q5755595 (5 m, Finnish edition only), the Kela
head office Q11869698 (12 m, Finnish only); the twelfth, Sunila, has the district's article
Q3977023 at 311 m, and the thirteenth, the Aalto Campus, has Seminaarinmäki Q11892928, the
campus hill, at 71 m. The class-based finder
proposed none of these, because a sanatorium, a villa, a concert hall and a town hall are not
among the classes it learned for a site with no resolved component.

Dacia is the opposite case: 46 of 277 points have any article within 500 m by primary
coordinate, and it is the village's. Asked with `gsprimary=all` within 1 km
(`ro-lists.mts`), the Romanian edition answers for 65 points with an article, **23 with a
castra article** — *Castrul roman de la Gresia* (1 m), *de la Pojejena* (1 m), *de la Hoghiz*
(1 m), *Pons Augusti* at Voislova (0 m), *de la Rucăr* (1 m), *Resculum* at Bologa (280 m),
*Buridava* (343 m), *Ad Pannonios* (578 m), *Largiana* (650 m) — whose coordinates GeoData holds
as *secondary* and a primary-only search never returns, and 46 with a row of the county's
*Lista monumentelor istorice* or *Lista siturilor arheologice* (11 within 300 m), each row with
its LMI code, address, coordinate and Commons picture (`ro-lmi`). Around the Alps the primary
pass alone matches 34 of 111 by name (Robenhausen, Egolzwil 3, Lavagnone, Hautecombe, Môtier),
in a site where 108 of 111 already have an item; of the 3 Swiss points without one, 1 has a
named article.

**Terms.** The text is CC BY-SA 4.0 and none of it is copied: what is read is the article's
coordinate, its title and its item. The Foundation's terms of use and API etiquette ask for a
descriptive User-Agent and serial requests, which `userAgent()` and the one-at-a-time pacing
give. Share-alike binds nothing the product stores from this source, since the item id is not
the text.

**What it is for.** The second door of the item finder: for a component with no candidate by
class and name, the articles within the kind's radius in the country's languages and English,
with their items and distances, proposed to a curator as #1272's matches are (ADR-0046) — the
item then brings the picture and description #1270 reads. With `gsprimary=all` it also reaches
the list rows and the articles whose coordinate is secondary, which is where Romania's forts
are.

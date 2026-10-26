# How Wikivoyage's IsPartOf hierarchy agrees with its Regions sections (2026-10-27)

The measurement #2088 asked for, before #2090 rebuilds the Wikivoyage extraction without model
calls. English Wikivoyage states a destination's place in two ways. Every article names its parent
with `{{IsPartOf|…}}`, and a status template names its type (`{{usablecountry}}`,
`{{outlineregion}}`). A region's Regions section (`{{Regionlist}}` or a bullet list) names the
regions it is divided into. The world-view import reads only the Regions sections. The questions:
how often do the two agree, what do their disagreements look like, and how does the tree
`IsPartOf` gives on its own compare with the Wikivoyage world view built today.

**Short answer.** They agree almost everywhere. Of 4 911 pages that a region lists in its Regions
section and that have an article, 4 781 (97.4 %) name that region in `IsPartOf`. Every region and
country article but one carries `IsPartOf`, and the continents are the only roots. Of the 4 245
rows of the current world view that have a page, 4 113 (96.9 %) sit under the page their
`IsPartOf` names. The
disagreements are few, and they fall into a handful of recognisable shapes, listed below with
named cases.

---

## Method

**Data.** The dump `enwikivoyage-20261001`, from `dumps.wikimedia.org/enwikivoyage/20261001/`, with
the SHA-1 sums the dump publishes:

| File | SHA-1 |
|---|---|
| `enwikivoyage-20261001-pages-articles.xml.bz2` | `6e5b1f933488f5d64445324870da5aef48aadbc1` |
| `enwikivoyage-20261001-page_props.sql.gz` | `03c3193539d9e995518ed7bfed13e006cc3878c2` |
| `enwikivoyage-20261001-page.sql.gz` | `7419e0bbd943ca3e1914c30ff577266c5cc824de` |
| `enwikivoyage-20261001-redirect.sql.gz` | `321e386153c55a6e81b1cde9ed6d05c0dba3956c` |

Main-namespace pages were split into 34 716 articles and 34 012 redirects. A page's Wikidata item
is its `wikibase_item` row in `page_props`.

**What was read from each article:**

- **Parent:** every `{{IsPartOf|X}}` (case and spacing ignored). X is normalised (underscores to
  spaces, first letter upper case, an `#anchor` dropped) and followed through redirects.
- **Type:** the first status template `{{(outline|usable|guide|star)<type>}}`. `{{star nomination}}`
  and the like are not a status: Central Asia carries one ahead of `{{outlineregion}}`. Also
  recorded: `{{extraregion}}` and the disambiguation banners.
- **Regions section:** the first heading of any level that starts with one of the import's own
  prefixes (`REGION_SECTION_PREFIXES` in `backend/src/services/wikivoyageExtract/parser.ts`:
  regions, countries, states, provinces, districts, islands, prefectures, counties, subregions,
  cantons, municipalities, departments, territories, federal subjects). The section runs to the
  next heading of the same or a higher level, which is what the Action API returns for a
  section. The text is parsed with the import's own `parseRegionlist` and `parseBulletLinks`, as
  `populateFromRegionSection` in `treeBuilder.ts` does. A linked region is a listed page. A
  plain-text group (Alsace's "Bas-Rhin", "Haut-Rhin") lists its items. Link targets are
  normalised and followed through redirects like parents.

**Hierarchy page.** A page with a region, country or continent status that is neither an extra
region nor a disambiguation page: 3 547 pages (3 323 regions, 217 countries, 7 continents).
Counts of "listed" below use only the Regions sections of hierarchy pages. A topic, a city or an
extra region with a Regions section is not a parent in the hierarchy.

**The world view.** World view 2, "Wikivoyage Regions", on the development database, read on
2026-10-27. Each region's page is its `region_import_state.source_url`, resolved like a link, and
its parent is the nearest ancestor that has a page. 56 rows have no page: they are grouping nodes,
such as "Cyrenaica" under Libya or "Galilee" under Israel.

**What it does not show.** The world view was built by the model-driven extraction and then
edited by curators. A difference from it can come from either, and this report does not tell them
apart. The parse reuses the import's functions but none of its later steps: the model parser for
ambiguous sections, the dead-end filter and the depth rule. Nothing here says which reading is
right on the ground. Where a case is named as wrong, the reason is given.

---

## 1. Listed regions whose IsPartOf names another parent, or none

969 hierarchy pages list at least one page in their Regions section, 5 110 listings in all.

| Listed page | Listings |
|---|---:|
| has `IsPartOf` naming the listing page | 4 781 |
| has `IsPartOf` naming another page | 127 |
| has no `IsPartOf` | 3 |
| has no article (a red link) | 199 |

The 199 red links are entries with no page yet, mostly the municipalities of a province: Balete,
Banga and Lezo under Aklan; Bergenfield and Closter under Bergen County; Filicudi and Alicudi under
the Aeolian Islands. The three without `IsPartOf` are Central Minnesota and two disambiguation
pages a section links to by mistake: Kef (disambiguation) under Saharan Tunisia, and Yulin under
South Guangxi.

The 127 that name another parent fall into five shapes:

| Shape | Listings | Named cases |
|---|---:|---|
| A city, rural area, park or page with no status listed as a region | 54 | Moscow under Central Russia (`IsPartOf` Moscow Oblast); Los Angeles under Antelope Valley (Southern California); Labuan under Sabah (Malaysia); Tierra del Fuego under Argentina (South America) |
| The child names a page above the listing page | 21 | Kosovo under Serbia (`IsPartOf` Balkans); Abkhazia and South Ossetia under Georgia (Caucasus); Isle of Man and the Channel Islands under the United Kingdom (Britain and Ireland) |
| The child names a page on another branch | 21 | Russia under Asia (Eastern Europe); Fujian under Taiwan (East China); North Caucasus under the Caucasus (Southern Russia); Kern County under Antelope Valley (San Joaquin Valley) |
| The child names a page below the listing page | 18 | Upper, Middle and Lower Franconia under Bavaria (Franconia); Hampton Roads under Virginia (Eastern Virginia); Monaco under Europe (Alpes-Maritimes); Åland under the Nordic countries (Finland) |
| The page lists itself | 13 | Moldova's Regionlist names `[[Moldova]]` beside Transnistria. The Andaman and Nicobar Islands list `[[Nicobar Islands]]`, a redirect back to the page. Also Bangsamoro, Azad Kashmir and Balochistan |

One case is a plain wrong link. Alsace's Haut-Rhin group lists `[[Saint-Louis]]`, the town on the
Swiss border, but on Wikivoyage that title is Saint-Louis in Senegal (`IsPartOf` Northern
Senegal).

## 2. Articles whose IsPartOf names a region that does not list them

The 3 547 hierarchy pages carry 3 546 `IsPartOf` links to a parent.

| The named parent | Links |
|---|---:|
| lists the page in its Regions section | 3 402 |
| has a Regions section that does not list it | 55 |
| has no Regions section | 78 |
| is a city: Los Angeles, parent of its seven districts (Antelope Valley, San Fernando Valley, Westside and four more) | 7 |
| is an extra region: Islands of the Atlantic Ocean (Azores and Madeira, which also name Portugal; Saint Helena), South Aegean Islands (Small Cyclades) | 4 |

Where the parent does not list the page, the page is almost always linked elsewhere on it. A
parent with no Regions section names it under *Other destinations* (24: the Aeolian Islands in
Messina, the Amalfi Coast in Salerno, the Cinque Terre in Liguria), under *Cities* (12: Cappadocia
in South Central Anatolia), in the lead (8: Chalkidiki in Macedonia), or under a heading the
import's prefixes do not match: *Divisions* (Rajasthan's seven divisions), *Main islands*
(Hebrides), *Understand* (Gotō Islands). Where the parent has a Regions section, the page sits in
another part of it. Bucks, Chester and Delaware County are listed in the description of Delaware
Valley, an extra region inside Philadelphia Region's Regionlist. Aruba is an item of the Leeward
Antilles, an extra region inside the Caribbean's Regionlist. Corfu and Lefkada are listing
templates (`name=[[Corfu]]`) under the Ionian Islands' *Islands* heading, which the bullet parser
does not read.

Six link targets in Regions sections are HTML-encoded or carry a direction mark, so the import's
parser resolves them to no page: Centre-du-Qu`&eacute;`bec, Chaudi`&egrave;`re-Appalaches,
Abitibi-T`&eacute;`miscamingue and Lanaudi`&egrave;`re in Quebec, Rheingau followed by U+200E in
Hesse, and one Washington, D.C. district. The first three and Rheingau are in the world view under
those spellings.

## 3. Region-type articles with no IsPartOf or no status template

**No `IsPartOf`:** 8 hierarchy pages, the 7 continents and Central Minnesota. Every other region,
country and continent names its parent. The `IsPartOf` tree therefore has the continents as its
only roots. Walked down from them it reaches 3 536 of the 3 547 hierarchy pages. Of the 11 it does
not reach, eight hang under Los Angeles, a city: its seven districts, and Catalina Island under
one of them (South Bay). Two have an extra region as their only parent (Saint Helena, Small
Cyclades), and one is Central Minnesota. The Azores and Madeira are reached through Portugal, their
second parent.

**No status template:** 460 articles that are not disambiguation pages carry none. 344 are extra
regions, which carry `{{extraregion}}` instead: the Alps, Latin America, Delaware Valley, the
Andes. 31 pages without a status are listed in a hierarchy page's Regions section. 23 of them are
extra regions, such as Donbas under Eastern Europe or Tierra del Fuego under Argentina, and two
are disambiguation pages. Six look like ordinary destinations whose template is missing: Puebla
(state) under Central Mexico, Chiapas under Yucatán and the South, the Cocos (Keeling) Islands
under Oceania, Glacier Bay National Park under Southeastern Alaska, and the towns of Redwater and
Gibbons in the Edmonton Capital Region.

**Pages outside the hierarchy that have a Regions section:** 155 cities (Los Angeles, with its
valleys), 100 extra regions, 27 topics (Soviet Union, with its republics under *Countries and
territories*), 8 rural areas, 2 parks and 1 district. Their sections list pages that also have an
ordinary parent.

## 4. Pages listed under more than one parent

76 pages are listed in the Regions sections of two or more hierarchy pages. 61 of them are
region-type.

| What the page's `IsPartOf` names | Pages | Named cases |
|---|---:|---|
| every page that lists it | 6 | the Caucasus (Asia, Europe); Turkey (Eastern Mediterranean Europe, Middle East); Hawaii (Polynesia, United States); Easter Island (Chile, Polynesia); the Midway Islands; San Bernardino County |
| one of them | 68 | Russia (Eastern Europe; also listed by Asia); Egypt (North Africa; also by the Middle East); Kosovo (Balkans; also by Serbia); Somaliland (East Africa; also by Somalia); the Franconias (Franconia; also by Bavaria) |
| none of them | 2 | Quad Cities (Midwest; listed by Eastern Iowa and Western Illinois); the Empty Quarter (Middle East; listed by Oman and Yemen) |

29 articles name two or three parents in `IsPartOf`. Nine are region-type or have no status: the
Caucasus, Turkey, Hawaii, the Azores, Madeira, San Bernardino County, Spanish North Africa, Asian
Russia and Sierra Nevada (Spain). The rest are cities and parks on a border or across the sea,
such as Kruger National Park (Mpumalanga, Limpopo), Yellowstone (three regions in Idaho and
Wyoming) or Easter Island (Chile, Polynesia).

## 5. The IsPartOf tree against the current world view

World view 2 holds 4 301 rows: 56 grouping nodes and 4 245 rows with a page, 2 868 distinct
pages.

| A world-view row with a page | Rows |
|---|---:|
| a continent at the root, which has no `IsPartOf` | 7 |
| sits under the page its `IsPartOf` names | 3 982 |
| sits under it through a grouping node | 131 |
| sits under another page | 111 |
| its page has no `IsPartOf` (Coastal Plain, Central Highlands under Gabon) | 2 |
| its page is not in the dump | 12 |

**Under another page (111).** The page sits under a parent that lists it, while its `IsPartOf`
names a different one. These are the shapes of § 1 carried into the tree: Egypt under the Middle
East, Russia under Asia, Abkhazia and South Ossetia under Georgia, Somaliland under Somalia, the
West Bank and Gaza Strip under Israel. For 96 of the 111 the page `IsPartOf` names is also in the
world view, often as the other copy of the same page.

**Pages held more than once.** 775 pages are in the world view two to four times. The world view
holds a page with its whole subtree under each parent that lists it. 65 subtrees are copied, among
them Russia (114 rows) under Asia and Eastern Europe, France (66) under three grouping nodes
("France and Monaco" among them), Turkey (27), Hawaii (18) and Egypt (7).

**Not in the dump (12).** Four are the encoded or marked links of § 2. Iturup and Shikotan in the
Kuril Islands (held twice, with Russia), the Kivalliq Region and the Belep Archipelago are red
links. "Nusa Lembongan#Nusa Ceningan" and "#Greater Newcastle" are links to a section.

**What the `IsPartOf` tree has that the world view does not.** 978 region and country pages are
reached from the continents and are missing from the world view, such as Rajasthan's divisions,
Transylvania's counties or the provinces of the Valencian Community. For 696 of them the parent is
a leaf of the world view. 858 of them are listed in their parent's Regions section too, so both
structures hold them and the world view stops above them. That is the import's depth rule, not a
disagreement between the two structures.

**What the world view has that the `IsPartOf` tree does not.** 310 pages of the world view are not
hierarchy pages: 168 cities, 101 rural areas, 17 parks, 14 extra regions or pages with no status,
and 10 not in the dump. The import placed them as leaves where a Regions section lists them.

---

## What the builder can take from each structure

- **Parent and type, from `IsPartOf` and the status template.** Both are present on every
  region-type article but one, and they give a tree with only the continents as roots. Its links
  agree with the Regions sections at 97.4 %. A disagreement is a page listed by a parent its
  `IsPartOf` does not name, and that can be detected without a model.
- **Order, groups and the extra placements, from the Regions sections.** The sections give the
  order of a region's children, the plain-text groups that have no page (the 56 grouping nodes),
  and the second parents of § 4. They need four repairs before they are compared: decode HTML
  entities and strip direction marks in link targets; drop a link to the page itself or to a
  redirect back to it; drop red links; and treat a link to a city, park or rural area as a
  destination, not a child region.
- **Extra regions stay out of the tree.** The 344 pages with `{{extraregion}}` (the Alps,
  Delaware Valley, Islands of the Atlantic Ocean) list pages that already have an ordinary parent.
  The two pages whose only parent is an extra region (Saint Helena, the Small Cyclades) are cases
  for review, and so is a city with child regions (Los Angeles). The Azores and Madeira also name
  Portugal and stay under it.
- **The review items are the disagreements.** Each case of §§ 1–4 names the article and both
  readings, which is what #2090 asks the import review to show. On this dump there are 127
  listing disagreements, 133 parents that do not list their child, 76 pages listed under two or
  more parents and six listed pages with no status template. The admin reads a few hundred
  items, not four thousand.
- **The depth is not in either structure.** Both go below the world view's leaves (§ 5), so where
  to stop is the builder's own rule, which #2090 takes from Wikidata.

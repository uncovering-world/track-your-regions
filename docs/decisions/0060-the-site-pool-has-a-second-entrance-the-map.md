# ADR-0060: The site pool has a second entrance, what the map calls a dig, and one rule judges both

**Date:** 2026-09-15
**Status:** Accepted

---

## Context

ADR-0058 decision 4 admits an archaeological site through one entrance: Wikidata's
`archaeological site` class tree, with OpenStreetMap as the second signal where the classes
cannot tell a dig from a living town. The tree is the pool. What the tree does not name the
rule never sees — not admitted, not refused, no card for a curator — and #895 measured what
that costs: Ajanta Caves is `grotto, artificial cave, temple` (83 sitelinks), Mount Nemrut a
`mountain` (61), Sanchi a `compound` (54), the historical parks of Sukhothai and Ayutthaya a
`historical park of Thailand`, Jerash a `city` (54) whose dig, Gerasa, is its own item at 12
sitelinks; Vergina a village (47) whose dig, Aigai, is its own item at 14.

Measured on 2026-09-15 (the data is in `data/cache/895-site-doors/`, the counts in
`docs/sources/global/wikidata-archaeology.md`):

- **English Wikipedia's `Archaeological sites by country` is a shelf, not a door.** Walked as
  the museum door walks its category, it names 9,440 articles; 905 are at the place line and
  432 of those are in no class under the tree — and the top of them by fame is Istanbul,
  Tbilisi, Yerevan, Sanaa, Thessaloniki and Samarkand. The editors file the living city beside
  the dig (Athens sits in `Archaeological sites in Attica`). A run reads about 1,240 categories
  to walk it, twenty times the museum walk, for two or three additions in a hundred.
- **A World Heritage listing is a twin, not a door.** Every item carrying `P757` that names a
  row the catalogue holds: 1,296; in the site tree below the line 48, of which 17 stand within
  three kilometres of a site row this kind already admits (Delphi beside the Delphic Oracle,
  Knossos beside its palace, Carthage beside its site). Outside the tree, an OSM ruin tag
  read widely admits the Taj Mahal (`historic=tomb`) and the Alhambra (`historic=castle`).
- **The gazetteers of the ancient world hold the living cities too.** The German
  Archaeological Institute's iDAI.gazetteer types Rome, Constantinople, Athens, Thessaloniki,
  Tyre, Sidon and Syracuse `archaeological-site` beside `populated-place`, and knows nothing of
  India or Thailand; Pleiades (P1584) and the Digital Atlas of the Roman Empire (P1936) sit on
  Istanbul as on Gerasa. GeoNames codes a feature `ANS` or `RUIN` precisely and rarely —
  four of the 586 World Heritage twins — and a ruin feature within 1.5 km is noise in every
  historic city. A famous town's below-line dig, reached through `P131`/`P276`/`P361`, is a
  Roman villa per hamlet: 3,996 digs, Rome alone 325.
- **OpenStreetMap enumerates digs, and the map's word is a second entrance the classes can
  judge.** Every object tagged `historic=archaeological_site`, `archaeological_site=*`,
  `historic=ruins` or `ruins=*` that carries a `wikidata` tag: 63,630 rows, 41,163 objects
  naming 38,753 items, one question to the mirror; 774 of them at the place line, 564 already in the tree,
  **210 new**. Of the 210: municipalities whose article the mapper linked from a ruin
  (Potenza, Alcalá de Henares, eighteen comuni), living cities (Ashdod), buildings that no
  longer exist (the Hanging Gardens, the Colossus of Rhodes, Whitehall), castles under
  `ruins=yes` (Bodiam, Devín, Rochester), a bombed airport and a dam, living temples Indian
  mappers tag `archaeological_site` (Konark, the Chola temples) — and about forty real sites
  the kind lacked: Ajanta, Delos, Sigiriya, Jerash, Lagash, Kilwa Kisiwani, Gobustan, Chaco
  Culture, the Ziggurat of Ur, Elephanta, Alta, Zvartnots, Qalhat, Dmanisi, Eleusis, the Temple
  of Kukulcan, Silbury Hill, Spiennes, Kanheri, Beit Guvrin, the Thracian tombs, the Hồ
  citadel, the Alpine pile dwellings, Brattahlíð, Vergina, the Great Wall of Gorgan. A
  further 2,027 such objects carry a `wikipedia` tag and no `wikidata` tag (1,532 articles) —
  Nemrut's tumulus is `tr:Nemrut Dağı`; the 1,085 of them under `historic=archaeological_site`,
  the probe's set, resolve to 843 items, 39 of them new at the line.
- **What no entrance reaches.** Sanchi's Great Stupa is a way with a name and nothing else,
  the item on the village node; the Thai parks carry `ref:whc` and no item; Gerasa and Aigai
  stay below the line as items, and the fame their towns carry is the towns'.

## Decision

**1. The site pool is fed by two enumerations.** Beside the class tree of ADR-0058 decision 4,
unchanged, every OpenStreetMap object tagged `historic=archaeological_site`,
`archaeological_site=*`, `historic=ruins` or `ruins=*` — a `no` value left out, since it is the
mapper saying the opposite — that carries a `wikidata` tag, or a `wikipedia` tag and no
`wikidata` tag, names a candidate; a `wikipedia` tag naming a section of an article
(`es:Antuco#Historia` on a fort's node) names none, since a section is a part of what the
article is about and the article's item is not what the mapper linked. The enumeration is
asked once a run of whichever OSM door the operator named (ADR-0059's terms, `OSM_READER`):
one question through the mirror, one exact-match question per selector through Overpass,
every answer kept a day like every other; a whole article is resolved to its item through the
wiki the tag names; Wikidata
is then asked only for the sitelinks of the items the tree did not already name, five hundred
to a question, and for the full row only of those at the pool's floor. An admitted row is
fetched whatever its count, so that its refusal is named. An enumeration that answers with
nothing ends the run, as an empty batch does.

**2. One rule judges both entrances, and the classes veto what the tree did not vouch for.** A
candidate the tree names is judged exactly as ADR-0058 decision 4 judges it. A candidate only
the map named — no class under `archaeological site` on the item — meets, before the five
steps, what Wikidata's classes can say against the map's word:

1. *Nothing left to stand in.* `destroyed building or structure` (the Hanging Gardens, the
   Colossus) is refused: the map marks a place that was.
2. *A find is not a place.* A class under `archaeological artefact` (the Venus of Willendorf,
   whose coordinate is its find spot) is refused.
3. *Not a place to stand in, whatever the tag.* A flat list of classes read off what the
   first dry run through the entrance (136) would have created beside the digs — a business
   (Azovstal), a power station, a country house (Berghof), a concentration camp, a massacre
   and a council with a coordinate, a national library, a concert hall, a hospital, a disambiguation
   page — is refused with the item's own word. Flat, as `SITE_KILL_NATURAL` is: a closure
   under `organization` or `occurrence` would refuse rows nobody measured, and a row the list
   misses is one card and one more label.
4. *`ruins` is a condition, `archaeological_site` a nature.* A `ruins` tag alone cannot carry a
   fortification, a palace, a château, a structure of worship or a museum past the door (Devín,
   Bodiam, the Tower of David, St Nicholas in Hamburg, the Château de Blois): a monument in
   ruins is another kind's row or nobody's. `historic=archaeological_site` on the same item is
   the mapper saying otherwise and is not vetoed by a class (Tintagel Castle, the Thracian Tomb
   of Kazanlak, the Konark Sun Temple).
5. *A population statement is the living-place rule here.* For a row the tree vouches for it
   is the last word in one narrow dispute (ADR-0058); for a row only the map named it is the
   rule, because a comune of Italy or a municipality of Spain stands on no settlement branch
   and states its people all the same, and eighteen of them arrive on a ruin the mapper linked
   to the town's article. Two things outweigh it: the place being World Heritage itself
   (Delos), and English Wikipedia filing the article under `Archaeological sites in …`
   (decision 3).

What survives enters through the ordinary steps, the object that named it being its step-2
signal, and its card carries the question a curator answers: *no class of a site on Wikidata;
OpenStreetMap maps an archaeological site here (tag on object)*. A candidate only the map named
that the map no longer names, or that has no coordinate at all — a mapper's tag naming a person,
a class, an event — is `out`, never refused: it claimed nothing, and dry run 136 would otherwise
have named forty-three such cards.

**3. English Wikipedia's category is the second vote for a living place, not a door.** The
article's own categories are read — as the museum door reads a museum's, never a walk — only
of a candidate the map named that states a population, is not World Heritage itself, has an
English article and stands where the line would name its refusal. `Archaeological sites in …`
on it lifts the population veto: Jerash, Lagash, Kilwa Kisiwani, Qalhat, Písac and León Viejo
come in this way, and Ashdod is the measured false positive, one card for a curator.

**4. The World Heritage twin is not a door, and neither is any gazetteer measured.** The
records of what was looked at and not adopted — iDAI.gazetteer, GeoNames — are in
`docs/sources/` as `looked-at`, with the numbers, so the same source is not found again next
year with the same surprise (ADR-0048 decision 7); the twin's measurement is on the Wikidata
record, and the sites category's record is `adopted`, for the vote decision 3 gives it and
nothing more.

**5. What no entrance reaches is a curator's row.** Nemrut enters through its tumulus's
article; Sanchi, Sukhothai and Ayutthaya do not, and the register record names them. The
honest home of such places is the regional tier (#881) — the state antiquities services that
enumerate Turkey's ören yerleri, India's ticketed monuments and Thailand's historical parks
whole, with a fame signal of their own — or an edit to Wikidata itself (`historical park of
Thailand` under `archaeological park`), which the next run reads without a deploy.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| English Wikipedia's `Archaeological sites by country` as a door, the museum door's shape | The shelf holds Istanbul, Tbilisi and Yerevan beside the digs; with OSM's ruin as a required second signal it yields 26 rows, a third of them castles and Ashdod, for 1,240 category reads a run. |
| A World Heritage listing as the fame line for site-tree items below it | Adds a second pin beside a row the catalogue holds already, 17 of 48 within three kilometres of a site this kind admits; the merge is ADR-0046's (#755), and a run must not pre-empt it. |
| A World Heritage item outside the tree admitted on OSM's ruin tag | The wide ruin set admits the Taj Mahal and the Alhambra; the strict set admits 33 with a quarter of them living temples — and every one is a twin of a row held already. |
| iDAI.gazetteer, GeoNames, Pleiades, DARE as doors | Gazetteers of ancient *places* hold the living cities (Rome, Athens, Istanbul); GeoNames' `ANS`/`RUIN` on the item's own feature is precise and names four of 586 twins; proximity is noise in every historic city. |
| A famous town's below-line dig, through `P131`/`P276`/`P361` | 3,996 digs at 5–21 sitelinks linked to a famous item; Rome carries 325 of them. |
| The OSM enumeration with no class vetoes | Potenza, Ashdod, the Hanging Gardens, Bodiam Castle and a bombed airport walk in on the mapper's word alone; the vetoes are what makes the map's word judgeable. |
| The enumeration on `historic=archaeological_site` alone, never `ruins` | Cleaner by a third, and loses Sigiriya, Kilwa Kisiwani, Elephanta, Rani ki vav and the Temple of Kukulcan; the `ruins`-only veto on monuments keeps the castles out instead. |
| A worship-class veto beside the museum one | Reims, Palermo and Monreale cathedrals arrive under `historic=archaeological_site` — and so do Ajanta, Ellora, the mortuary temple of Hatshepsut and Esagila. ADR-0058 decision 6 already holds that a place in another kind is admitted here on the same terms; a curator's no on a living cathedral is one card, and losing Ajanta is the miss this issue opened with. |

## Consequences

**Positive:**
- Ajanta, Delos, Sigiriya, Jerash, Lagash, Kilwa Kisiwani, Gobustan, Chaco Culture, the
  Ziggurat of Ur, Elephanta, Alta, Nemrut and some thirty more places a traveller into
  archaeology expects reach the kind, each with a card that says which signal carried it.
- The pool has entrances and the rule has one door: a third enumeration — a national register,
  a Commons category — is a third entrance to the same pool and the same steps.
- Every refusal of a map-named row above the line is named, so a mapping slip (a ruin linked
  to the town's article) is a card, not silence.

**Negative / Trade-offs:**
- One planet-wide question to the mirror per run (66,417 rows — one per key an object matches:
  63,630 carrying an item, 2,787 an article alone, folding to 41,163 and 2,027 objects — a few
  megabytes, tags only)
  and about eighty sitelinks questions to the Query Service, all cached a day; and the wikis
  the `wikipedia` tags name are asked — some thirty requests over fifty languages. The
  enumeration is asked under a budget of its own on either door, because a planet-wide tag
  read does not fit a batch's two minutes on a slow afternoon: the mirror's question under
  nine minutes, inside the mirror's own deadline, and through Overpass eight questions of
  about two minutes each, one selector at a time under a declared 600 s (dry runs 134 and
  135).
- About a quarter of the map-named arrivals at the line are a mapper's slip or a living
  temple, refused by a curator from the card; the source is gated (ADR-0058 decision 7).
- Sanchi, the Thai historical parks, Gerasa and Aigai still wait for a curator or the
  regional tier.
- Three more class trees a run walks (fortification, palace, structure of worship), each
  cheap and cached.

## References

- Related ADRs: ADR-0058 (decision 4 narrowed by this one), ADR-0059 (the OSM terms this
  entrance reads under), ADR-0048 (the register), ADR-0046 (the merge this decision declines
  to pre-empt), ADR-0030 and ADR-0047 (the cache)
- Related docs: `docs/sources/global/wikidata-archaeology.md`,
  `docs/sources/global/openstreetmap-qlever.md`, `docs/sources/global/openstreetmap-overpass.md`,
  `docs/sources/global/wikipedia-archaeological-sites-categories.md`,
  `docs/sources/global/idai-gazetteer.md`, `docs/sources/global/geonames.md`,
  `docs/tech/experiences.md` § Archaeology
- PR / issue: #895

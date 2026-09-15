# ADR-0058: Archaeology is one kind of sites and museums, and a museum joins it for what it is, not for one find

**Date:** 2026-09-13
**Status:** Accepted — decision 4 narrowed by ADR-0060

---

## Context

A traveller browsing museums finds no archaeology museum in Egypt, Mexico, Turkey or Greece, and
in London gets art museums but not the British Museum: the art test (ADR-0024) rightly expelled the
institutions whose famous holdings are archaeological, and #581 promised them a kind of their
own. The 2026-08-05 decision sent "archaeology and history museums" to one future import;
ADR-0045 decision 1 and `EXPERIENCE-TYPE-AND-SIGNIFICANCE.md` already list archaeology museums
and history museums as two kinds. What was never decided is what admits a museum to the
archaeology kind, whether the excavations themselves belong in it, and how a museum that is at
once an art museum and an archaeology museum is treated.

Measured on 2026-09-13 (QLever over Wikidata; the numbers are in
`docs/sources/global/wikidata-archaeology.md`):

- **The class tree is not the boundary.** On Wikidata `archaeological museum` is a subclass of
  `history museum`, as are natural history, military, local and biographical museums; the
  history tree at 22 sitelinks holds 177 items, of which about twenty are history museums a
  traveller would name (the Deutsches Historisches Museum, the Carnavalet, the Museum of London),
  and none of those holds an object at 22 sitelinks. A history museum is visited for a story, an
  archaeology museum for what was dug up: two admission rules, so two kinds.
- **The class alone misses the canon.** 28 museums are typed archaeological at 22 sitelinks; the
  British Museum, the Pergamon Museum, the Neues Museum, the National Museum of Iraq, the Bardo
  and the Museo del Oro are not typed so at all.
- **A famous find alone admits the wrong museums.** The holders of a find at 22 sitelinks
  include the Uffizi (the Venus de' Medici), the Prado (a stale location of the Lady of Elche)
  and the Kunsthistorisches Museum (the Gemma Augustea) — art museums with one ancient object —
  and Museum Ulm (the Lion man) and the Sverdlovsk regional museum (the Shigir Idol), city and
  local-history museums with one famous find. A person who collects archaeology museums and is
  sent to the Uffizi has been misled; the maintainer's rule is that a museum belongs to a kind
  when a substantial part of *all* it shows is that kind, never for one or two masterpieces.
- **The share of all works cannot be read off Wikidata.** Items whose `collection` is the Louvre:
  18 (its works sit under department items); the Hermitage: 8,640, of which 23 archaeological,
  though its antiquities are among the world's best; the Uffizi 1,136 of which 9; the British
  Museum 995 of which 226. The share measures what volunteers have imported, not the museum —
  the trap ADR-0023 named for a composite that gates on documentation.
- **The English Wikipedia category is the honest signal of what a museum is about.** The
  editorial category `Archaeological museums in <place>` sits on the Louvre, the British Museum,
  the Pergamon Museum, the Neues Museum, the Egyptian Museum, the Museo Nacional de
  Antropología, the Acropolis Museum, the Ashmolean, the Larco Museum, the Bardo, the National
  Museum of Iraq, the Israel Museum, the Museo del Oro, Naples, the Museum of Anatolian
  Civilizations and Heraklion — every museum the class missed — and on Museum Ulm; it is absent
  from the Uffizi, the Prado, the Deutsches Historisches Museum, the Carnavalet and the
  Sverdlovsk museum; the Hermitage, the Kunsthistorisches Museum, the Pushkin Museum, the
  Vatican Museums and the Ny Carlsberg Glyptotek carry only department categories (`Museums of
  ancient Greece / Rome / the ancient Near East`, `Egyptological collections`).
- **OpenStreetMap's `museum=*` tag is too sparse for museums** (747 `archaeological` in the
  world; the Louvre `art`, Naples and Iraq `history`, the Hermitage none) and **rich for sites**:
  228,974 `historic=archaeological_site` objects, 26,682 with a `wikidata` tag, a site type on
  most, a polygon on the famous ones.
- **"Ancient" is not the criterion of a find.** The Aztec sun stone is a `sculpture` of 1510
  with no discovery place on its item; Sutton Hoo is AD 625, the Oseberg ship AD 820, the Benin
  Bronzes sixteenth-century. A date cut at AD 500 reads the Mediterranean as archaeology and the
  Americas, Africa and the North as not.
- **Sites: the leak is one branch of the tree.** The `archaeological site` tree at 22 sitelinks
  with coordinates holds 1,130 items, 273 of them World Heritage rows the catalogue holds; Athens
  (288 sitelinks), Cairo, Damascus, Cologne and Xi'an are in it through `free city`, `ancient
  city` and `Roman city`, classes that are also subclasses of `human settlement`. A population
  statement is not a rule: Ani (a ghost city) carries 75,000, Ctesiphon 500,000.
- **A famous find has fewer Wikipedia articles than the place that holds it.** Holders of a find
  at 22 sitelinks: 56; at 18: 78 (adding the National Museum of Iraq through the Warka Vase at
  20, the Acropolis Museum through the Kritios Boy at 18, Beirut, the Jordan Museum); at 15:
  101, where the noise begins (libraries holding papyri, a diamond vault). These counts are the
  measurement's widest reading of what a find is, which is wider than the pool decision 3
  collects: the Warka Vase is typed `container` and enters no class this kind asks for, so the
  Iraq Museum's road into the kind is its category and not its vase.

## Decision

**1. Archaeology is one kind with two types, `site` and `museum`.** A traveller into archaeology
wants Pompeii and the Naples museum in one list; the type is the chip and the filter inside it
(`EXPERIENCE-TYPE-AND-SIGNIFICANCE.md` § Axis 1). History museums are a kind of their own with a
rule of their own (a separate issue and ADR); a museum whose nature is local history, art or
natural history is not made an archaeology museum by a find it holds, and that find waits for
its museum's kind.

**2. A museum is admitted for what it is, never for one find.** A museum is archaeological by
nature when the English Wikipedia article carries the category `Archaeological museums in …`,
or the Wikidata item carries a class under `archaeological museum` or `egyptological museum`
(`Egyptological collections in …` on Wikipedia is a department category, not a nature: the
Hermitage carries it; Cairo and Turin are archaeological by the other two signals anyway). A museum archaeological by nature
enters at the place line, or below it when it holds a find above the find line (Delphi at 15
sitelinks with the Charioteer, Olympia at 17 with the Hermes, Heraklion at 21 with the Phaistos
disc). A museum whose categories name only an antiquities department (the Hermitage, the
Vatican Museums, the Kunsthistorisches Museum, the Pushkin Museum, the Glyptotek) arrives
**held**, flagged for a curator with the question "an antiquities department; is the
exposition substantially archaeology?" — the gate this source already stands behind (ADR-0025),
with one more reason on the card. A museum with neither signal is not admitted, whatever it
holds. A natural-history class is a veto **where the row carries no archaeological signal of its
own**: the Naturhistorisches Museum Wien (typed natural history only, its article under `Natural
history museums in Austria` and `Geology museums in Austria`) is not an archaeology museum for
holding the Venus of Willendorf. A museum typed both, or carrying the `Archaeological museums
in …` category beside the natural-history class, is a museum of both and enters on that signal
— the Yorkshire Museum, typed `natural history museum` and `archaeological museum`, filed under
`Archaeological museums in England` and `Museums of ancient Rome in the United Kingdom`, whose
draw is Roman York. Archaeological parks and open-air sites the museum tree also reaches are
sites (decision 4), not museums.

**3. A find is a treasure, never a door.** What an admitted museum holds that the world knows is
written as its treasures (ADR-0023's placement, ADR-0044's floor), with `foundAt` from the
item's discovery place (P189) in the treasure's metadata so the card can say "found at
Mycenae". A find is an item in the `archaeological artefact` tree or one of the find classes
read off the pool (inscription, stele, figurine and Venus figurine, death mask, sarcophagus,
hoard, papyrus, viking ship), or an item with a discovery place, or an object of the art pool
(sculpture, statue, group of sculptures, mosaic, fresco, vase) made before AD 500. Fossils,
skeletons, individual animals, minerals, gems and meteorites are natural history and are not
finds.

**4. A site is admitted through the `archaeological site` tree, with OpenStreetMap as the judge
where the classes cannot decide.** The pool is every item under `archaeological site` (Q839954)
with a coordinate and the places' fame line; the branch — whether one of the item's own classes
is under `human settlement` (Q486972) — decides what silence means, not what admission means. The
tree holds living cities (Athens enters it through `free city`, Cairo and Damascus likewise),
historical polities and inhabited islands typed `polis`, and the classes alone cannot tell them
from Troy, which Wikidata types `city-state, polis, Bronze Age settlement, settlement site` and
never as a dig.

So OpenStreetMap is read as a second signal on the terms of ADR-0059, and the rule is, in order:

1. **Refused by class or by name.** A shipwreck and its subclasses (58 in the pool, the Titanic
   among them) — an archaeological site, and not a place anybody stands in. A `lost city` unless
   the item also carries a direct site class, which takes Pripyat, Chernobyl and Thinis and
   leaves Al-Hirah. A lake, a reservoir, a desert or a mountain range with no ruin mapped on it
   and no World Heritage listing of its own, which takes Lake Bled, Qiandao Lake — whose dig, Shi
   Cheng, is thirty metres under the water a dam put there — and the Lop Desert, and leaves
   Tassili n'Ajjer and Tadrart Acacus. And one row by name, the Aysén Region of Chile, mis-typed
   on Wikidata as an archaeological site.
2. **OSM says ruin → a site**, whatever branch the item came in on: any object carrying
   `historic` in {`archaeological_site`, `ruins`, `tomb`, `castle`, `fort`, `monument`,
   `temple`, `citywalls`, `fortification`, `theatre`, `aqueduct`, `bridge`}, or `ruins=*`, or
   `archaeological_site=*`, or `man_made` in {`mound`, `tell`, `geoglyph`}. Troy, Petra, Palmyra,
   Byblos and Cyrene enter here — the last four being a living town beside the ruins with both
   mapped, where the ruin is what a traveller goes for. **`roman_road` and `memorial` are
   deliberately not in the set**: each decided a handful of rows in the measured pool and decided
   them wrongly — `roman_road` is Watling Street and the Via Flaminia, and a 430 km road is not a
   place a traveller stands in, while `memorial` is one row, the Lop Desert, whose only mapped
   object is a modern marker.
3. **OSM says a living place and nothing says ruin** — any object carrying `place` in {`city`,
   `town`, `village`, `hamlet`, `suburb`, `quarter`, `neighbourhood`, `borough`, `municipality`},
   or `boundary=census`, which is the outline a statistical office drew around a population it
   counts (the pool's four New Mexico census places — Acomita Lake, North Acomita Village,
   Skyline-Ganipa, Sunrise — are mapped `place=locality` with it and carry `archaeological site`
   besides) — **then a site only if** the item is a World Heritage site itself (`P757`, or `P1435` =
   Q9259) **or** carries a direct `P31` in the site classes (`archaeological site`, `tell`,
   `necropolis`, `ruins`, `settlement site`, `archaeological park`, `Ancient Egyptian
   archaeological site`, `Ancient Greek archaeological site`, `Paleolithic site`, `prehistoric
   necropolis`, `tumulus`, `ancient monument`) **and states no population** (`P1082` absent);
   otherwise refused by name. The card names only what the rule read: "a living place — OSM maps
   a town here and Wikidata counts its people" where the item states a population, "a living
   place — OSM maps a town here and Wikidata gives it no class of a site" where it states none —
   never a number the rule never checked. Bagan, Anuradhapura, Baalbek, Saqqara, Dahshur, Cumae
   and Bosra enter — Bosra (Q272680) on the World Heritage listing its own item carries,
   `P1435 = Q9259`, checked on 2026-09-14; the measurement's facts file had recorded no
   designation for it, and run 121 admitted it. Athens, Cairo, Asyut, Esna and Dendera are
   refused, and Dendera's temple complex and Meidum's pyramid are separate items on the site
   branch that enter on their own. `place=locality` (Pompeii, Sounion, Capernaum) and `place=island` (Rhodes,
   Samos) are **not** living-place signals: one names a spot, the other an island.
4. **Neither signal** — a weak tag (`heritage=*`, `boundary=protected_area|national_park`,
   `tourism=attraction`), an object with nothing of interest on it, or no OSM object at all: on
   the site branch, a site by class; on the settlement branch, a site with a direct site class, a
   World Heritage listing of its own, **or a weak tag on an item Wikidata counts no people for**,
   else refused by name. Angkor, Babylon, Thebes, Karnak and Olduvai Gorge enter by a class
   already on the item. The last clause is Carthage's (Q6343: `city-state, ancient city,
   emporium`, no site class, no population statement, one object — relation/8305288 — carrying
   `heritage=1`), and the measured pool holds exactly two rows of that shape: Carthage and
   Demetrias (Q1150349, relation/18138696, `heritage=2`, no population), both real sites. Rhodes,
   Milos, Akkad, Pataliputra and Sabratha are refused this way, and Sabratha's World Heritage row
   stands on its own; so is **Syracuse** (Q13670), whose only object is relation/39169,
   `boundary=administrative` — an outline of a comune is not a ruin, and the refusal says so with
   the map's own count: "one OSM object carries it, and it is not a ruin". Where the map maps an
   island the sentence says **island** rather than city, which 17 of the 60 rows it is written
   for are (Rhodes, Samos, Chios, Ithaca …).

   **The other known misses are refused a step earlier, as living places.** Tyre (Q82070,
   node/803018184 `place=city`), Sidon (Q163490, node/4799206602 `place=city`) and Agrigento
   (Q13678, node/67253674 `place=city`) carry a town on the map, no site class that `wdt:P31`
   reads, and a stated population; Side (Q152405) is the same with node/8822516201 `place=village`
   and relation/15871010 `place=suburb`, and its `archaeological site` statement is **deprecated**
   on Wikidata (checked 2026-09-14), so the class door never sees it. Not one of the four carries
   a weak tag at all: the card reads the living-place sentence, not step 4's. What they have in
   common is the miss itself — a living city standing for a famous excavation that has no item of
   its own in the pool — and it is only a miss where the dig is unnamed: Agrigento's Valle dei
   Templi (Q636774, `archaeological park, archaeological site`, 38 sitelinks) *is* in the pool and
   is admitted by class, so Agrigento loses nothing, while Tyre's and Sidon's digs have no item to
   find. Each refusal is a curator's to return from the kept-out card.
5. Then the fame line, hysteretic, as it is decided for every kind — and it decides whether a
   refusal is *named*: 830 of this pool's rows sit between 15 and 21 sitelinks, and naming a
   village down there would bury the refusals a curator has to read.

**A population statement is not the living-place rule.** It is the last word in the one narrow
dispute of step 3 — OSM says town, Wikidata says site — and nowhere else: Pompeii states a
population of 0 and is admitted without the number ever being read. Of the 86 settlement-branch
items with only a living-place object, 6 are World Heritage sites themselves, 8 more state no
population, and the other 20 are counted towns (Asyut 562k, Esna 463k, Ajloun 190k, Dendera 53k).
Bosra, counted at 20k, is in that measured bucket and is admitted all the same: the facts file
recorded no designation for it, and the item carries `P1435 = Q9259` (checked 2026-09-14).

**OSM's polygon is the site's extent**, where OSM has one: among the item's ruin objects and the
protected areas drawn around them, **a designated one first — an object carrying `heritage=*`, the
line a heritage body drew — and among those, or among all of them where none is designated, the
one covering the most ground**. Not the ruin object first, because at the Nazca Lines the ruin
object traces one group of geoglyphs at 0.0015 km² while the World Heritage zone around the whole
desert of lines (`heritage=1`) measures 774 km² (both by the writer's own expression, 2026-09-14),
and the speck is not what a reader is asking to see; not the most ground alone, because the outer
archaeological reserve there is a four-corner box of 5,638 km² that nobody designated; and by
ground rather than by how finely a polygon is traced, because replayed on the mirror's answers for
the 836 items with an extent (2026-09-14) the two disagree on twenty and the finer tracing is the
smaller shape where they do — Sarmizegetusa Regia's castle speck against its site, a hundred times
the ground; Preah Khan's central temple against its enclosure. At
Petra the ruin object *is* the park. It is
stored in `experiences.boundary` with its area beside it and its provenance on the row (ADR-0059
decision 2); 516 of the 651 items with a ruin signal have a polygon on the ruin object itself. The
extent follows the source through the gate rather than being held with a gated row's other
columns: an outline is what somebody surveyed, and a published site whose extent was frozen would
keep the first run's polygon for ever while the run's own note of where it came from moved on.

*Amended in place on 2026-09-14 (#581 PR 2), while this ADR was Draft: the signal sets, the
population tie-break, the kill lists, the census boundary, the weak-signal lift and the choice of
extent are what the measurement of that day and the dry runs on it settled. The shape of the
decision — the site tree, the settlement branch, OSM as the second signal, a population statement
that is not a rule — is unchanged.*

**5. Two lines on the source row, not one, and not 22 by inheritance.** `enterSitelinks` /
`staySitelinks` for places (sites and museums) and `findEnterSitelinks` / `findStaySitelinks`
for finds, both pairs on `experience_sources.api_config` and edited from the admin panel
(`sourceLine.ts`, ADR-0052). The first values are 22 / 18 for places and 18 / 15 for finds,
read off the measurements above and to be confirmed by the dry run; the number is a property
of this kind's data, which is thinner for finds than for paintings.

**6. A place another kind already holds is admitted here on the same terms, as its own row.**
The Louvre is an art museum and, by decision 2, an archaeology museum: two rows, two pins, two
memberships on two places, until the merge of ADR-0046 (#755) makes them one place with two
memberships. Nothing is refused for being in another kind; the honesty owed to a traveller is
that each list holds what its name says, which decision 2 secures.

**7. The kind is offered only when both types are filled.** ADR-0045 decision 2 forbids a list
that claims the world and holds half of it: "Archaeology" without Pompeii is such a list. The
source is seeded gated (`requires_curation = true`) and its first live run follows the site door,
not the museum door alone. The regional tier (ADR-0048 decision 3) — the state antiquities
services that enumerate archaeology museums nearly whole in Greece, Turkey, Egypt, Mexico, Italy
and France — is a separate issue, as it is for every other kind.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A kind of archaeology *museums* only, sites left to World Heritage | To a traveller into archaeology the excavation and the museum of its finds are one interest; Wikidata itself files `archaeological park` under `archaeological museum`, and the public-art import already refuses Stonehenge, Babylon and the Madara Rider as "archaeological site, not public art" — rows that want this kind. Type, not kind, is the distinction (ADR-0045 decision 1). |
| The find as a door, in ADR-0023's works-first shape | Admits the Uffizi for one statue and Museum Ulm for one figurine; a museum's nature is what a traveller browsing by kind expects, and the share of all works is not measurable (below). Finds stay as treasures. |
| The share of the museum's Wikidata collection that is archaeological | The Louvre has 18 items, the Hermitage 8,640 with 23 archaeological: the share measures the imports, not the museum, and would rank the Hermitage below the Uffizi. |
| A threshold of two famous finds for an art museum | Two masterpieces say nothing about the other ten thousand objects; it is the same rule as one find with a bigger number. |
| Inception before AD 500 as the definition of a find | Eurocentric: the sun stone, the Benin Bronzes, Sutton Hoo and the Viking ships are archaeology and fail it. Kept only as the fourth way in for the ancient sculpture the art pool already holds. |
| Population as the living-city rule for sites | Unreliable on the items where it matters: Ani 75,000, Ctesiphon 500,000; and it loses Babylon, Baalbek and Bagan, whose items fuse the ruins with the town. The class branch is the leak, so the class branch is the rule. |
| OpenStreetMap as the enumeration of sites now | 229,000 objects with no fame signal of their own; a tumulus in a field is not a traveller's day. The world tier is Wikidata's line; OSM is the second signal here and the regional tier's candidate later. |
| One fame line for places and finds | At 22 it loses the National Museum of Iraq and the Acropolis Museum; at 18 it widens the sites to about 1,700 with the long tail. Two lines cost two more keys on the source row. |
| Refuse a place already admitted by another kind | Hides the Louvre from a traveller into archaeology to spare a second pin; the pin is the cost of #755 not having landed, not a fact about the Louvre. |

## Consequences

**Positive:**
- Egypt, Greece, Turkey, Mexico, Iraq, Tunisia and Colombia get their museums back under the
  name a traveller uses, and the British Museum returns to London.
- Every admission names its reason a person can check: a category on Wikipedia, a class on
  Wikidata, a find above a line, a site class outside the settlement branch.
- The Wikipedia category is a human editorial judgement of the museum as a whole, which is what
  "a substantial part of the exposition" asks for and no count of items gives.
- A find's discovery place is stored, which is this kind's own story ("found at Mycenae, shown
  in Athens") and the seed of the site-to-museum link (#823).

**Negative / Trade-offs:**
- The Louvre, the Capitoline Museums, the Israel Museum and every museum that is both kinds
  stand as two rows and two pins until #755, and a visit marked on one is not seen on the
  other.
- The Venus of Willendorf and Lucy reach no kind until natural history is one; the Lion man
  and the Shigir Idol reach none until local history is one.
- The English Wikipedia category is English-language editorial work: a museum with no English
  article or an unsorted one is judged by its Wikidata class alone, which the survey shows
  misses famous museums; the dry run's refusals are read by name for that reason.
- Wikidata's site tree loses Troy, Carthage, Mohenjo-daro, Delphi and Meroë through the
  settlement branch; OSM returns some (Troy), World Heritage holds them all, and the rest is a
  curator's row.
- A second pair of lines is two more keys the admin panel's source card must read and write.
- The finds pool is a second specification over the shared works collector, which now has to
  take its roots and its extra filter as a parameter rather than as constants.

## References

- Related ADRs: ADR-0023 (works-first; the shared collector and placement), ADR-0024 (the art
  test's refusals are the seed), ADR-0025 (the gate), ADR-0043 (pictures), ADR-0044 (the works
  floor), ADR-0045 (kinds, types, memberships; decision 1 named this kind), ADR-0046 (the merge
  that will join the two rows of one museum), ADR-0048 (two tiers; the register), ADR-0052 (two
  doors on one source; the line on the source row), ADR-0059 (OpenStreetMap-derived data)
- Related docs: `docs/sources/global/wikidata-archaeology.md`, `docs/tech/filling-a-kind.md`,
  `docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md`, `docs/tech/experiences.md` § Archaeology
- PR / issue: #581; #755 (the merge), #823 (part of), #628 (the same two-tier shape for art)

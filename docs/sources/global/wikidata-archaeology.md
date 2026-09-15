---
slug: wikidata-archaeology
name: Wikidata, the world's archaeological sites, archaeology museums and the finds inside them
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://query.wikidata.org/sparql
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [archaeology]
tier: world
unit: { level: any, code: none, name: "the world, cut by two lines: one for places, one for finds" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: all
  languages: [all]
  signal: "sitelinks of the place; sitelinks of a find it holds"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL (the Query Service for the run, banded; QLever for the measurements)"
  cadence: continuous
  volume: "1130 sites at 22 sitelinks with coordinates; 44 museums typed archaeological at 22 (14 at 40 or more, 30 between 22 and 39); 56 museums holding a find at 22, 78 at 18 (2026-09-13); 1,960 site candidates with coordinates at 15 sitelinks, 1,126 at 22 (2026-09-14)"
  rate: "the Query Service refuses heavy patterns; the run asks in fame bands and pauses between questions"
scorecard:
  date: 2026-09-13
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
issue: 581
looked_at: 2026-09-13
---

# Wikidata, read for the whole world through three doors

The fifth kind filled from Wikidata, after art museums (ADR-0023), public art (#754) and places
of worship (ADR-0052), and the first whose subject is two things a traveller browses together:
the site where something was dug up, and the museum where it is shown. One source fills the kind
*Archaeology* through **three doors**: a site the world knows by name, a museum the world knows
by name *and* Wikidata types archaeological, and a museum holding a **find** the world knows.
All three are the world tier of ADR-0048 decision 2; the cuts are the ranking's own, stated on
the source row and applied to the whole world. Two lines rather than one, because finds have
fewer Wikipedia articles than the places that hold them (below). What a museum is *about* has a
second signal this source does not carry, and the run reads it beside the classes: English
Wikipedia's `Archaeological museums in …` categories, which are a record of their own
([`wikipedia-archaeological-museum-categories`](wikipedia-archaeological-museum-categories.md)).

**The rule itself is the ADR this record is written for** (#581) and is not restated here. What
this record holds is what the search left behind: what was measured and when, what the source
cannot reach, and the runs that adopt it.

**How the scorecard was read.** As for the places-of-worship record: § 6.2 of
[`docs/tech/filling-a-kind.md`](../../tech/filling-a-kind.md) is worded for the regional tier;
Signal 2 is here a signal comparable across the world (the sitelink count), Completeness 2 a
stated subset with its rule written, with the misses named below.

## What was measured (2026-09-13, through QLever's endpoint)

**The class tree is not the boundary.** On Wikidata `archaeological museum` (Q3329412) is a
subclass of `history museum` (Q16735822), and so are `natural history museum`, `military
museum`, `local museum` and `biographical museum`. The history tree holds about 16,000 items,
177 at 22 sitelinks; after taking out the archaeology, natural-history, military and
biographical subtrees, 69 remain, of which about twenty are history museums a traveller would
name (the State Historical Museum in Moscow 40, the Museum of London 36, the Carnavalet 32, the
National Museum of American History 30, the Deutsches Historisches Museum 29, POLIN 29). None of
those holds an object at 22 sitelinks: a history museum is visited for a story, an archaeology
museum for a find — which is why the two are two kinds with two admission rules, and only the
second is this record's.

**Museums typed archaeological** (`P31/P279*` under Q3329412, minus `archaeological park`):

| sitelinks | museums |
|---|---|
| ≥ 40 | 14 |
| 22–39 | 30 |
| 15–21 | 43 |
| 10–14 | 88 |

At 22: the Louvre 169, the Egyptian Museum 63, the Grand Egyptian Museum 48, the Capitoline
Museums 46, the Egyptian Museum of Berlin 42, the National Archaeological Museum of Athens 41,
the Museo Nacional de Antropología 41, the Museum of Anatolian Civilizations 39, Naples 39, the
Museo Egizio 38, the Acropolis Museum 37, the Istanbul Archaeology Museums 36, the Museo
Nazionale Romano 35, Madrid's National Archaeological Museum 32, the Cyprus Museum 28, Beirut 25,
Thessaloniki 24, Luxor 23, Florence 23, the Rockefeller Museum 23. **Below the line by class**:
Heraklion 21, Larco 18, Olympia 17, Delphi 15. **Not typed archaeological at all**: the Pergamon
Museum (`art museum, museum`, 61), the Neues Museum (`museum, museum building`, 47), the British
Museum (`art museum, national museum`, 109), the National Museum of Iraq (`national museum`,
36), the Bardo (`museum`, 35), the Museo del Oro (`museum`, 28) — which is why the class alone is
not the door.

**Museums holding a famous find.** A find in *this measurement* is an item that is ancient
(inception before AD 500), or carries a discovery place (P189), or sits in the `archaeological
artefact` tree (Q220659), and is located in or in the collection of a museum-class venue — the
widest reading, so that what each way in drags along could be counted. The rule read off it and
built is narrower on one point: the pool is collected **by class** (the artefact tree, the find
classes, the ancient-art roots), and a discovery place is a reason to keep a work the pool
already holds rather than a door into the pool, so an item of no collected class never reaches
the rule at all (`archaeology/finds.ts`). Holders by the line on the find:

| line on the find | museums | what the band adds |
|---|---|---|
| 22 | 56 | the British Museum (17 finds: the Rosetta Stone, the Elgin Marbles, the Cyrus Cylinder, the Standard of Ur …), the Egyptian Museum (5), Naples (5), the National Museum of Denmark (4), Istanbul (3), the Capitoline (3), Athens (3: the Artemision Bronze, the Antikythera mechanism, the Mask of Agamemnon), the Pergamon Museum (the Pergamon Altar), the Neues Museum (Nefertiti), Heraklion (the Phaistos disc), Delphi (the Charioteer), Olympia (the Hermes), New Delhi (the Dancing Girl) |
| 18 | 78 | the National Museum of Iraq (the Warka Vase, 20), the Acropolis Museum (the Kritios Boy, 18), Beirut (the Ahiram sarcophagus, 18), the Jordan Museum (the Copper Scroll, 21), the Museo Nazionale Romano (the Boxer at Rest, 18), the Pushkin Museum (Priam's Treasure, 20), the Glyptothek, the Kunsthistorisches Museum (the Gemma Augustea) |
| 15 | 101 | the Museum of Anatolian Civilizations (the Seated Woman of Çatalhöyük, 15), the National Museum of Afghanistan, the National Museum of Indonesia, and the first noise: libraries holding papyri (Chester Beatty, the Austrian National Library), the Diamond Fund, a country house with an obelisk (Kingston Lacy) |
| 12 | 135 | Paestum (the Tomb of the Diver), the Bihar Museum, and more noise: a meteorite, Japanese scrolls, a manuscript library |

The classes those finds carry, at 15 sitelinks or more: sculpture 47, archaeological artefact
33, statue 21, archaeological find 20, inscription 12, Venus figurine 9, hoard 8, manuscript 7,
figurine 5, stele 5, tablet 4, sarcophagus 4, papyrus 4, mosaic 3, group of sculptures 3, death
mask 2, viking ship 2. The artefact tree covers about half; the other half is ancient sculpture
that the art-museum pool already reads, plus inscriptions, figurines and manuscripts. What the
widest reading of the discovery place let into the measured pool that is not archaeology: three
`individual animal` / `skeleton` rows (Lucy, Sue the tyrannosaur), two diamonds (the Hope
Diamond), a meteorite, a coprolite — natural history, refused by class. The rule as built
refuses them twice over: each reaches the pool only if a collected class carries it, and the
natural-history veto then refuses the row whatever else it holds.

**"Ancient" is not the criterion.** The Aztec sun stone is typed `sculpture`, made in 1510,
with no discovery place on its item; the Benin Bronzes are sixteenth-century; Sutton Hoo is
AD 625; the Oseberg ship AD 820. A date cut at AD 500 reads the Mediterranean as archaeology and
the Americas, Africa and the North as not. The criterion is *dug up*: the artefact tree, the
find classes, a discovery place — with the date cut kept only as the fourth way in for the ancient
sculpture and mosaics the art pool already holds (the Doryphoros, the Laocoön, the Alexander
Mosaic), which are the finds that make Naples and the Vatican worth an archaeology traveller's
day.

**Sites** (`P31/P279*` under `archaeological site`, Q839954, with coordinates):

| sitelinks | sites | with a World Heritage id (P757) | in the worship tree |
|---|---|---|---|
| ≥ 60 | 149 | 67 | 12 |
| 40–59 | 247 | 91 | 18 |
| 30–39 | 268 | 53 | 29 |
| 22–29 | 466 | 62 | 35 |
| 15–21 | 830 | 65 | 64 |

At 22, 1,130 sites, 273 of them World Heritage rows the catalogue already holds (Pompeii,
Delphi, Mycenae, Persepolis, Petra, Chichen Itza), 94 in the worship tree (the Parthenon, Angkor
Wat, Borobudur, Abu Simbel). **The tree also holds living cities**, because Wikidata types
Athens an `ancient city`, Cologne a `Roman city`, Xi'an an `ancient city`: the top of the tree by
fame is Athens 288, Cairo 261, Damascus 242, Cologne 190, Alexandria 176. What tells them apart
is a population statement (P1082): of the 1,130 sites at the line, 614 carry no population and no
populated-place class, 393 carry an `ancient city`-type class and no population (Akshak,
Alexandria Eschate, Amorium), 117 carry a population (the living cities), 6 a population and no
such class. Pompeii carries a population of 0. A rule that refuses a population above zero
loses the items on which Wikidata has fused the ruins with the modern town — Babylon (150,000),
Baalbek (81,052), Anuradhapura, Bagan, Samarra, Ctesiphon — every one of them a World Heritage
row already. Shipwrecks (the Titanic 160, the Amoco Cadiz, the ARA San Juan) and a `lost city`
that is a modern evacuation (Pripyat, Chernobyl) are in the tree too and are refused by class.

**The site door as it was built (2026-09-14, #581 PR 2).** The measurement that settled it is
kept in `data/cache/osm-sites/` and summarised in
[`openstreetmap-qlever`](openstreetmap-qlever.md): of the 1,126 items at the line with
coordinates and an English label, 885 carry at least one OSM object and 510 are on the settlement
branch. That 79% is the observed baseline, and the run holds the mirror to a lower floor: a read
that answers with an object for fewer than **half** of the items it asked about fails the run by
name rather than being read as "nothing is mapped there", and its answers are dropped from the
cache so the next run asks again. Under the rule ADR-0058 decision 4 now states, the settlement branch — the 500 of its 510
that step 1 does not kill — comes out at 261 sites by a ruin signal, 15 by a weak signal with a site class (Angkor, Babylon, Mesa Verde),
26 more with a weak signal and no class of their own — mostly the Aegean poleis (Rhodes, Milos,
Chios among them), refused this way except the two that state no population, Carthage and
Demetrias, which the weak signal now admits — 78 with no OSM object
but a direct site class (Thebes, Karnak, Napata), 86 refused as living places and 34 refused for
a city with no ruin on the map. The site branch adds roughly 610. The refusals worth checking by
name after a run are Athens, Cairo, Asyut, Esna, Dendera, Rhodes, Milos, Sabratha, Syracuse,
Tyre, Sidon, Agrigento, Side, Akkad and Pataliputra.

**The known misses, and how each is actually refused.** **Syracuse** (Q13670) is the step-4 one:
its only OSM object is relation/39169, `boundary=administrative`, so the card reads "a city
Wikidata files under archaeological sites, with no ruin on the map (one OSM object carries it,
and it is not a ruin)". **Tyre** (Q82070, node/803018184 `place=city`), **Sidon** (Q163490,
node/4799206602 `place=city`), **Agrigento** (Q13678, node/67253674 `place=city`) and **Side**
(Q152405, node/8822516201 `place=village` beside relation/15871010 `place=suburb`) are refused a
step earlier, as living places: a town on the map, a stated population, and no site class —
Side's `archaeological site` statement is deprecated on Wikidata (checked 2026-09-14), so
`wdt:P31` never reads it. **None of the four carries a weak tag**, so step 4 and its lift never
come into it. The miss they share is the shape rather than the sentence: a living city standing
for a famous excavation. Where the dig has an item of its own the door finds it and the town's
refusal costs nothing — Jericho is refused and Tell es-Sultan (Q2402267) admitted, Athens and the
Acropolis of Athens (Q131013), Dendera and the Dendera Temple complex (Q735254), Xi'an and the
Mausoleum of the First Qin Emperor (Q910180), **Agrigento and the Valle dei Templi** (Q636774,
`archaeological park, archaeological site`, 38 sitelinks). Tyre's, Sidon's and Side's digs have no
item to find, which is what makes those three the real losses; on the development catalogue Tyre
has a World Heritage row of its own (as do Syracuse, through "Syracuse and the Rocky Necropolis of
Pantalica", and Agrigento) while **Sidon and Side have none at all**, so for those two the kind
holds nothing. **Carthage (Q6343) is not among the misses**: it carries relation/8305288 with
`heritage=1` and no population statement, which is the weak-signal lift the final pass added, and
Demetrias (Q1150349, relation/18138696, `heritage=2`) is the only other row of that shape in the
pool. Bosra (Q272680) is admitted rather
than refused — the item carries `P1435 = Q9259` (checked 2026-09-14), which lifts it over the
20,000 people Wikidata counts there.

## What the admitted museums hold, read from their side (2026-09-15, #890)

The finds pool is collected by class, and two of the four roads into a find are not classes (a
discovery place, a date before AD 500), so an object an admitted museum holds could keep a pool row
and never get one. Measured over the 83 museums the development catalogue admitted, through the
live query service, by every current `P195` or `P276` statement naming one of them (no end time,
not deprecated), against what the catalogue already links there; raw answers under
`data/cache/890-venue-side/`:

| | at 10 sitelinks or more | at 15 or more |
|---|---|---|
| objects the 83 museums hold | 468 | 252 |
| linked at no museum that holds them | 274 | 134 |
| no treasure of any kind | 115 | 49 |

The difference between the last two rows is the art run's treasures — the Louvre's, the Vatican's and
the Hermitage's paintings and frescoes, which are no finds. Among the objects that are no treasure at
all: the Pergamon Altar (`altar`, dug up at Pergamon, 38 sitelinks), the Library of Ashurbanipal
(`library`, 51), the Benin Bronzes (`group of sculptures`, 38, undated and with no find spot), the
Oxyrhynchus Papyri (`manuscript collection`, 29, with one), Xochipilli (`Aztec deity`, 29), and the
2015 attack the Bardo's `P276` names (`mass murder`, 30). The Ishtar Gate (55) is not in this count
at all: its collection statement names the Vorderasiatisches Museum, which is not an admitted row
but folds into the Pergamon — which is why the read asks the fold sources beside their survivors.
The read keeps what `findReason` keeps (the Altar by its find spot, the Gate by its date, the
Papyri by their find spot) and reports the rest with their classes, named at or above the finds'
stay line; the class list that would widen the pool is #891's.

**The question had to be measured into shape.** One question carrying the objects' classes,
discovery places and inceptions beside the label service answered 502 and 504 for twenty venues
holding the Louvre; split into a holdings question and a by-id question it answers — and only
written venue-first (`?st ps:P195 ?venue` before `?w p:P195 ?st`) under `hint:optimizer "None"`:
left to the planner, or written work-first, one venue timed out at 65 s, while fifty of these museums
answer in 12 s (683 rows) venue-first.

## What this source cannot reach

- **A museum famous as an institution whose finds are not itemised, and which Wikidata types
  only `museum` or `national museum`**: the Bardo (35 sitelinks; the only item located there at
  10 or more is the 2015 attack), the Museo del Oro in Bogotá (28; the Muisca raft at 9), the
  National Museum of Iraq (36; its Warka Vase is typed `container` and never enters the finds
  pool), the Larco Museum (18, typed archaeological but under the line), the National Museum of
  Korea, the Tokyo National Museum (whose famous holding is a Hokusai print, an art-pool work).
  **Most of them are reached after all, by the signal that is not this source's**: English
  Wikipedia files the Bardo, the Museo del Oro, the National Museum of Iraq and the Tokyo National
  Museum under `Archaeological museums in …`, and #581 made that category a door rather than only
  a test — its own record is
  [`wikipedia-archaeological-museum-categories`](wikipedia-archaeological-museum-categories.md),
  and dry run 113 admitted all four on their own fame with no find of their own (ADR-0058
  decision 2). What stays beyond reach is a museum neither signal names — the National Museum of
  Korea is typed `national museum` at 38 sitelinks and filed under `History museums in South
  Korea` and `Art museums and galleries in Seoul` (checked 2026-09-13), so no road reaches it at
  all; the Viking Ship Museum in Oslo and the Drents Museum hold finds and are refused by name for
  the same want of a nature — and a museum under the place line with nothing at the finds' line:
  the Larco Museum, which carries both signals at 18 sitelinks, and the Yorkshire Museum at 15.
  These are the regional tier's (ADR-0048 decision 3) and a curator's — Peru's national register of
  museums is already a record here (`museums/pe-museos-cultura.md`).
- **A site Wikidata holds only as the living town** (Babylon, Baalbek): reached through World
  Heritage, not through this source.
- **A find in a natural history museum**: the Venus of Willendorf (Naturhistorisches Museum
  Wien), the Venus of Lespugue (Musée de l'Homme, typed `museum`), Lucy (the National Museum of
  Ethiopia). The natural-history class is a veto for this kind by product decision (2026-09-13:
  a natural history museum is not an archaeology museum, whatever one find it holds), so the
  Venus of Willendorf reaches no kind until a natural-history kind exists.

## Terms

**CC0 1.0.** The licence waives copyright and the database right alike and asks for no
attribution; it is given anyway. Nothing is scraped — the endpoint answers SPARQL. Pictures are
answered by ADR-0043: every one is a Wikimedia Commons file with the credit Commons states.

## The runs that adopted it

Nine dry runs on the development stack (#581 and #896, 2026-09-13 and 2026-09-14), each writing a sync-log row and its
per-object report and nothing to the catalogue:

| log | duration | admitted | held | through a find | refused | treasures |
|---|---|---|---|---|---|---|
| 112 | 14 m 26 s | 54 | 5 | 14 | 24 | 214 |
| **113** | **11 m 57 s** | **85** | **5** | **15** | **76** | **225** |
| 114 | 10 m 21 s | 85 | 5 | 15 | 76 | 225 |
| 117 | 10 m 15 s | 85 | 5 | 15 | 76 | 225 |
| 118 | 10 m 16 s | 83 | 5 | 15 | 82 | 225 |
| 119 | 10 m 13 s | 83 | 5 | 15 | 82 | 225 |
| **121** | **16 m 35 s** | **1,013** | **5** | **13** | **239** | **225** |
| **122** | **12 m 20 s** | **1,009** | **5** | **13** | **243** | **225** |
| 125 | 17 m 40 s | 1,010 | 5 | 16 | 243 | 226 |
| 126 | 14 m 00 s | 1,010 | 5 | 16 | 243 + 125 objects | 252 |
| 127 (live) | 12 m 56 s | 1,010 | 5 | 16 | 243 + 125 objects | 252 |
| 128 (live) | 14 m 08 s | 1,010 | 5 | 16 | 243 + 125 objects | 248 |
| **129 (live)** | **13 m 50 s** | **1,010** | **5** | **16** | **243 + 125 objects** | **250** |

Log 121 is the site door's first dry run on the development stack (2026-09-14, #581 PR 2): 930
sites admitted, 523 of them with an extent from OpenStreetMap, beside 83 museums and 225
treasures unchanged from log 119 — 1,013 rows in all, nothing written to the catalogue. **Two
fewer museums name a find than in log 119** (13 against 15), and nothing about the rule changed:
the live run 120 admitted Heraklion and the Villa Giulia, so at 21 sitelinks each they were read
as kept by hysteresis on their own fame rather than carried over the line by the Phaistos disc and
the Pyrgi Tablets, and a museum admitted for itself names nothing. The next live run cleared the
`admitted_for` run 120 had written. That reading was the defect of #896 — 21 could never have
entered, so the find is the reason on every run — and the rule now names the find off the enter
line (log 125 below). 239
refused: 193 by the site door — 72 as living places, 58 with no ruin on the map (Lake Bled
counted here, since its sentence names the map), and 63 by class or by name (59 shipwrecks, 3
lost cities, the Aysén Region) — 39 by the museum door, whose rule is unchanged (fewer named than in
log 119, because the site door now admits the parks and digs that door used to refuse by name), and 7 folds named. Named checks read as the rule predicts:
Troy, Pompeii, Bagan, Saqqara, Angkor, Babylon, Thebes, Petra, Great Zimbabwe, Machu Picchu,
Chichen Itza and Tassili n'Ajjer admitted; Athens, Cairo and Asyut refused as living places with
their people counted; Populonia and Baia refused as living places with no class of a site; Rhodes
and Sabratha refused with no ruin on the map; the Aysén Region, the Titanic, Chernobyl, Pripyat
and Lake Bled killed by class or by name. **Syracuse is refused the same way as Rhodes and
Sabratha** — with no ruin on the map, its one object being an administrative relation — while
Tyre, Sidon, Agrigento and Side are refused a step earlier as living places, each with a town on
the map and its people counted. All five are known misses of the shape, not of one rule: a living
city standing for a famous excavation (§ *The known misses* above says which of them has a dig
item and which has none). None of this is the World Heritage lift ADR-0058 decision 4 states for
the natural kill — Tassili n'Ajjer is that lift's live instance and Lake Bled its casualty.
Carthage was refused in this run and is admitted by the rule as the final pass left it, on the
`heritage=1` object it carries with no population statement beside it.

**A rule considered and refused: population at step 4.** The four New Mexico census places were
admitted at step 4 — a direct `archaeological site` class, no ruin and no town on the map — and
the obvious fix was to let the population statement decide there as it does at step 3. Measured
on the pool (2026-09-14): 109 settlement-branch items reach step 4 with a direct site class, and
**15 of them state a population** — Babylon (150,000), Pompeii (0), Karakorum, Cahokia, Tanis,
Edessa, Samannud, Dorestad, Karnak, Hermonthis, Antinoöpolis and the four census places. A rule
refusing a stated population at step 4 would lose Babylon, Pompeii and Karnak, which is the
catalogue's own canon: the number on those items is the ancient city's or the modern village's
beside the dig, and step 4 has no map to read it against. So step 4 is unchanged and
`boundary=census` does the work instead, which refuses exactly the four rows that were the
problem.

Log 122 is the same door under the rule as it merged (2026-09-14, 11:17 UTC, 12 m 20 s — four
minutes less than log 121, because the run stopped asking OpenStreetMap about the candidates the
fame line had already put out): **926 sites admitted, 522 of them with an extent**, the 83 museums
unchanged, 225 treasures, nothing written. 243 refused — **197 by the site door** (76 living
places, 55 with no ruin on the map, 66 by class or by name), 39 by the museum door and 7 folds
named.

Against log 121, the eight rows and the one shape the final pass changed all read as intended:
Carthage (Q6343) and Demetrias (Q1150349) enter through the weak-signal lift; Qiandao Lake
(Q2470528) and the Lop Desert (Q620724) are refused as a reservoir and a desert; the four
Acoma-area census places — Acomita Lake (Q342064), North Acomita Village (Q1237840),
Skyline-Ganipa (Q2293403) and Sunrise (Q1836972) — are refused as living places on
`boundary=census`; the Valle dei Templi (Q636774) is admitted by class while Agrigento stays
refused as a living place; Rhodes is refused as "an island" rather than as a city; and the Nazca
Lines carry the reserve's extent rather than the speck the ruin object traces.

Log 125 is the dry run after the fix of #896 (2026-09-14, 17 m 40 s, on the catalogue live run
124 left): 84 museums, **16 of them for a find** — Heraklion and the Villa Giulia back, and the
Museo de Villena (the Treasure of Villena) new that day on Wikidata's side, the run's one
`created` — beside 926 sites, 522 with an extent, and 243 refused, unchanged from run 124.

Logs 126 and 127 are the venue-side read (#890, 2026-09-15): the same 84 museums and 926 sites,
and for the first time what the admitted museums hold read from their own side. The read asked
91 venues — the 84 museums and 7 folded into them — and found 481 objects at 10 sitelinks or more,
200 of them already in the finds pool; it kept **26 as finds** and refused 255, 125 of them at the
finds' stay line or above and so named on the changeset with their classes. The 26 are what the
class pool could not reach: the Ishtar Gate and the Pergamon Altar at the Pergamon, the Burney
Relief, the Lycurgus Cup, Lindow Man, the Nereid Monument and the Tomb of Nebamun at the British
Museum, the Warka Vase at the National Museum of Iraq, the Pazyryk carpet at the Hermitage,
Tutankhamun's trumpets and his meteoric-iron dagger at the Egyptian Museum, the Oxyrhynchus Papyri
at three museums, the Ardagh Hoard, the Copper Scroll, the Isaiah scroll, the Tarkhan dress, the
Huldremose Woman, the Tjängvide image stone, the Pitsa panels, the Temple of Ellesyia at the Museo
Egizio, the bee pendant at Heraklion. Log 126 is the dry run; log 127 is the live run that wrote
them — 20 museums gained 27 links, the Pergamon two, and the Pergamon Museum wears the badge for
them. Two of the 26 were wrong, and the run said so by name: the Bendegó meteorite, typed `iron
meteorite` — a subclass the flat natural-history veto never named — with a find spot in Bahia, and
"Gupta art", an art movement with an inception of 450 and no class at all, kept by the date road.
A classless item is no find since that day, and the veto is walked as trees — six of its eight
roots: log 128, which walked all eight, withdrew the Gebelein predynastic mummies and Clonycavan
Man, because Wikidata files `mummy` under both `skeleton` and `individual animal`, and those two
are matched flat as they always were. Log 128 also left the meteorite's link standing at the Museu
Nacional, whose only link it was: a museum offering nothing used to have nothing compared, and
now has every link marked, floor permitting. Log 129 is the live run under both rules, and the run
of record for the read: 24 finds kept from the venue's side, the two mummies returned to their
museums, the meteorite's link marked at the Museu Nacional and "Gupta art"'s at the National
Museum, 250 treasures placed, and the Pergamon Museum holding the Ishtar Gate and the Pergamon
Altar beside its three pool finds, badged for them.

Log 112 is the rule without the category door: 617 entities fetched over the museum and finds
pools. Its refusals name the museums the two signals miss (the Viking Ship Museum with three
finds, the Drents Museum with two) and the natural-history veto as it then stood.

Log 118 is the rule with the fold settled after the verdict (2026-09-14): a museum whose finds a
kept fold moved onto an admitted survivor is no longer its own row, so two of log 117's 85 leave —
the Egyptian Museum of Berlin into the Neues Museum, whose building it shares (11 m), and the
Shrine of the Book into the Israel Museum it is part of (161 m) — and every kept fold is now named
in the refusals (seven: the three Vatican departments, the Vorderasiatisches Museum into the
Pergamon, the Palazzo Altemps into its own museum's row, and those two). In every one the
survivor is the better-known name, which is the reading the container fold owes, since that rule
carries no fame test of its own. The finds are unchanged at 225. Log 119 is the last review
round — the candidate rows widened to every placed venue and both ends of every fold — run once
more: identical to 118, museum for museum.

Log 117 is the rule after the review of the pull request — the holder cap binding what a museum
is credited with, the badge taken back where its predicate stops holding, the find spot kept
through another kind's write — run once more to show that none of it moved an admission: the same
85, the same five held and the same fifteen admitted through a find as log 114, name for name.

Log 114 is log 113's rule run again with the summary line naming its rows, since a dry run writes
no membership a held list could be read from. Its five held rows are the antiquities departments
the rule expects to hold — the Hermitage, the Vatican Museums, the Kunsthistorisches Museum, the
Pushkin Museum and the National Museum of Scotland — and its fifteen admitted through a find are
Heraklion (the Phaistos disc), the Villa Giulia (the Pyrgi Tablets), Olympia (the Hermes),
the Jordan Museum (the ʿAin Ghazal statues), Delphi (the Charioteer), the National Archaeological
Museum in Saint-Germain-en-Laye (the Venus of Brassempouy), Reggio Calabria (the Riace bronzes),
Paros (the Parian Chronicle), the Pigorini (the Praeneste fibula), the Musée d'Aquitaine (the
Venus of Laussel), Lugdunum (the Coligny calendar), Halle (the Nebra sky disk), Museum Ulm (the
Lion-man), Piacenza (the Liver of Piacenza) and the Palazzo Altemps (the Ludovisi Throne).

Log 113 is the run of record: the category door open, the museum-class gate on it, the
natural-history veto narrowed to a row with no archaeological signal of its own, and the badge
given for a find rather than for belonging. It fetched 1,677 entities — its category walk read 121
categories and 1,148 articles carrying a Wikidata item (19 without one), about 1,060 of which it
asked for by id, the rest already being in the museum pool or the venue graph — and **lost nothing
112 had admitted**. (The 776 in
[`wikipedia-archaeological-museum-categories`](wikipedia-archaeological-museum-categories.md) is
the survey of the same day: the articles with an item that the 60 country categories hold at depth
1, which the run's walk goes below.) It added 31 museums, the ones
the class tree and the finds pool between them cannot reach: the Bardo, the National Museum of
Iraq, the Museo del Oro, the Pergamon Museum, the National Museum of Iran, Damascus, the National
Museum of Egyptian Civilization, Cambodia, Indonesia, Azerbaijan, the Hungarian National Museum,
Kraków, the Swedish History Museum, Ireland, the Indian Museum in Kolkata, the Museu Nacional in
Rio, the Tokyo National Museum, Bibracte, Għar Dalam, the Terracotta Army's site museum and
others. **The addition is not an anglophone one**: 6 of the 31 are in the United Kingdom, Ireland
or the United States, and the other 25 are spread over 22 countries from Tunisia to Cambodia
(Israel holds three of them and France two; the other twenty countries one each) —
which is the answer to the obvious objection to reading an English-language encyclopedia's
categories for the world. Of its 76 refusals, 40 are category members with no museum class, named
at or above the place line as the worklist the site door will want (Pompeii, Chichén Itzá,
Teotihuacan, Masada, Sutton Hoo, Skara Brae, the Roman Forum); 15 are archaeological parks; 16 are
museums neither signal names (the Uffizi, the Viking Ship Museum, the Drents Museum, the Musée de
l'Homme); 4 are natural history (Vienna, Brussels, Sverdlovsk, the Potteries Museum); and 1 is the
Pio-Clementino's fold into the Vatican Museums. The Piacenza Civic Museum, typed natural history
*and* archaeological, is the museum the narrowed veto turned from a refusal into an admission.

The source is `experience_sources` row 5, *Archaeology*, filling the kind of the same name, seeded
by migration 056 with `requires_curation = true` — a community-edited source's first arrival waits
for a curator (ADR-0025) — and with both its lines on the row (`api_config.enterSitelinks` 22 and
`staySitelinks` 18 for the places, `findEnterSitelinks` 18 and `findStaySitelinks` 15 for the
finds), read by every run and edited from the admin panel's source card. The live runs on the development
stack (120 and 124 for #581 and #896, 127 to 129 for #890) have written the kind there, gated: its
rows wait for a curator, and no reader surface draws an Archaeology place until one publishes them
(ADR-0058 decision 7). Both doors are built (the site door landed on 2026-09-14, #581 PR 2), and
what the admitted museums hold is read from their own side as well (#890, 2026-09-15).

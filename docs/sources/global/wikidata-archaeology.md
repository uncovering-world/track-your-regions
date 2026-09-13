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
  volume: "1130 sites at 22 sitelinks with coordinates; 44 museums typed archaeological at 22 (14 at 40 or more, 30 between 22 and 39); 56 museums holding a find at 22, 78 at 18 (2026-09-13)"
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

Six dry runs on the development stack (#581, 2026-09-13 and 2026-09-14), each writing a sync-log row and its
per-object report and nothing to the catalogue:

| log | duration | admitted | held | through a find | refused | treasures |
|---|---|---|---|---|---|---|
| 112 | 14 m 26 s | 54 | 5 | 14 | 24 | 214 |
| **113** | **11 m 57 s** | **85** | **5** | **15** | **76** | **225** |
| 114 | 10 m 21 s | 85 | 5 | 15 | 76 | 225 |
| 117 | 10 m 15 s | 85 | 5 | 15 | 76 | 225 |
| 118 | 10 m 16 s | 83 | 5 | 15 | 82 | 225 |
| 119 | 10 m 13 s | 83 | 5 | 15 | 82 | 225 |

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
finds), read by every run and edited from the admin panel's source card. No live run has been made,
so the kind holds no place and no reader surface draws an Archaeology place — the kinds endpoint
lists the kind with a count of 0, and a curator's create dialog offers it; the site door lands first (ADR-0058
decision 7), and the first live run is the maintainer's.

---
slug: wikidata-places-of-worship
name: Wikidata, the world's places of worship and the works inside them
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://query.wikidata.org/sparql
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [places-of-worship]
tier: world
unit: { level: any, code: none, name: "the world, cut once by one signal" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: all
  languages: [all]
  signal: "sitelinks of the place; sitelinks of a work it holds"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL (the Query Service for the run, banded; QLever for the measurements)"
  cadence: continuous
  volume: "1116 places at 22 sitelinks (2026-09-08); 2800 works in the pool, ~35 venues through a work (2026-09-09)"
  rate: "the Query Service refuses heavy patterns; the run asks in fame bands and pauses between questions"
scorecard:
  date: 2026-09-08
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
issue: 753
looked_at: 2026-09-08
---

# Wikidata, read for the whole world through two doors

The third kind filled from Wikidata, after the art museums (ADR-0023) and public art (#754),
and the first whose subject is the building itself. One source fills the kind *Places of
worship* through **two doors on the same line** (ADR-0052): a place is admitted for its own
fame, or for the fame of a work it holds. Both doors are the world tier of ADR-0048 decision 2,
so the cut is the ranking's own — a threshold on sitelinks, stated once on the source row and
applied to the whole world.

**The rule itself is
[ADR-0052](../../decisions/0052-a-place-of-worship-is-admitted-for-itself-or-for-what-it-holds.md)**
— the class trees and the kill list, the parts and the folds, the types, what counts as a
treasure, and which of the two doors yields to the other — and it is not restated here, because
a second copy of a rule is the copy that drifts. What this record holds is what the search left
behind: what was measured and when, what the source cannot reach, and the runs that adopted it.

**How the scorecard was read.** § 6.2 of
[`docs/tech/filling-a-kind.md`](../../tech/filling-a-kind.md) words its examples for the
regional tier, whose unit is a country or a city. Two criteria are scored on the world-tier
reading of the same words: **Signal 2** is a measured signal comparable across the world — the
sitelink count ADR-0048 decision 2 asks a world tier for — rather than a within-unit one, and
**Completeness 2** is "a stated subset with its rule written", the 22-sitelink cut stated on
the source row, with the misses named below. The other six criteria are read as written.

## What was measured (2026-09-08, through QLever; the run itself asks the Query Service in bands)

Items in the worship tree with coordinates, and how many of them the World Heritage list also
holds (P757):

| sitelinks | places | with a World Heritage id |
|---|---|---|
| ≥ 22 | 1116 | 192 |
| ≥ 30 | 538 | 144 |
| ≥ 50 | 118 | 54 |

Top of the list: Hagia Sophia 152, Angkor Wat 137, the Parthenon 136, St Peter's 129,
Notre-Dame de Paris 125, the Sagrada Família 109, Al-Masjid Al-Haram 108, Al-Aqsa 103,
Borobudur 99. At the line: Bristol, Buenos Aires, Ferrara, Havana and Chichester cathedrals,
the London Central Mosque, Badrinath, the Grande Chartreuse. Prague enters with St Vitus.

By country at 22 sitelinks — the door is not Europe's alone:

| country | places | country | places |
|---|---|---|---|
| Italy | 143 | Russia | 46 |
| Turkey | 58 | Spain | 45 |
| Germany | 58 | Japan | 41 |
| France | 58 | Greece | 39 |
| United Kingdom | 51 | China | 30 |
| India | 49 | Egypt | 29 |

**Door two is smaller and European, by the data rather than by the class list.** 38 works at 22
sitelinks or more are located in the worship tree, standing at about 35 places once chapels fold
into their churches — the *Last Supper* at Santa Maria delle Grazie, the *Pietà* at St Peter's,
the *Ecstasy of Saint Teresa* at Santa Maria della Vittoria, the *Ghent Altarpiece* at St
Bavo's, the *Black Madonna* at Jasna Góra, the *Moses* at San Pietro in Vincoli. Counted by the
venue's country at 10 sitelinks: Italy 59 works, the Vatican 26, Spain 20, Belgium 9, Germany 8,
France 5, Greece 5, Sweden 4, Thailand 3, Egypt 2, then single rows. The reason is that Asia's
great statues have almost no sitelinks *as items* — the Tōdai-ji Daibutsu 7, the Reclining
Buddha of Wat Pho 1 — because their fame is the temple's, which door one carries (India 49
places, Japan 41, China 30). A longer class list does not change this; the regional tier
(ADR-0048 decision 3, by local-language readership — #807's method) is what does.

**What else is inside a place of worship.** Everything Wikidata places inside a worship venue at
10 sitelinks or more: 476 items, 153 of them under the art roots. Of the rest, three groups of
classes are things a traveller looks at and are in — relic and reliquary (the Shroud of Turin at
Turin, the Iron Crown at Monza, the Shrine of the Three Kings at Cologne, the Holy Chalice at
Valencia),
tomb and crypt (the Imperial Crypt in Vienna, the Vatican Grottoes) and the astronomical clock
(Strasbourg). Manuscripts and church bells are out on the same test: the Codex
Calixtinus is in an archive and the Pummerin is in the tower. **Bell towers and their siblings are
out on that test read the other way**: nobody enters the Duomo to see the Leaning Tower, so it is
not one of the cathedral's things to look at but a visit of its own kind, which the catalogue does
not carry yet (ADR-0052 decision 4).

## What this source cannot reach

- **The Western Wall (84 sitelinks) and the Kaaba (133)** carry no class under the worship tree:
  the Wall is `wall, archaeological site, sacred place` and the Kaaba `sacred place` alone. The
  only class that would admit them, `sacred place` (Q4588528), holds 30 rows at the line of
  which 25 are landscape — the Ganges, the Jordan, Fuji, Kailash, the Holy Land as a *term* — so
  opening it would cost six new kill classes to gain four rows. A traveller in Mecca is covered
  by Al-Masjid Al-Haram, which is admitted; the Western Wall is covered by nothing, since the
  Temple Mount above it is refused as a hill.
- **Sacred objects with no class at all**: the Black Stone (66, typed `stone, heirloom`), the
  kiswah (30, `parament`), the Zamzam Well (67), the Immovable Ladder (17). A curator adds these
  by hand.
- **Six visitable rows Wikidata types `destroyed building or structure` and types no ruin**:
  Champmol, Port-Royal-des-Champs, the Temple of Antoninus and Faustina, the Bibi-Heybat Mosque
  (destroyed in 1936, rebuilt in 1999), the Abbey of St Victor and the Ospedale della Pietà. The
  rule lifts that refusal only for a row carrying `religious building ruin` or `monastery ruins`,
  which is how Fountains Abbey and St Augustine's Abbey are admitted.
- **What the tree reaches and is not a place of worship** is refused by a kill list read off the
  run's own rows, not guessed: cemeteries (Prague's Old Jewish Cemetery, Powązki), plague and
  Holy Trinity columns (Olomouc, Vienna's Pestsäule), papal palaces (the Apostolic Palace, the
  Palais des Papes), Roman law courts that reached the tree through `civil basilica` (the
  Basilica of Maxentius, the Basilica Ulpia), the Auberge de Castille, the Ara Pacis (an
  `arula (altar)` in a museum), hills and ancient cities
  (the Temple Mount, Heliopolis, Olympia).
- **Towers, of which two are World Heritage Sites in their own right**: the Minaret of Jam (75
  sitelinks) and the Qutb Minar (72), beside the Leaning Tower of Pisa (117), the Giralda, St
  Mark's and Giotto's campaniles, the Kalyan Minaret, the Hassan Tower (37) and the Burana Tower. A
  traveller climbs a tower or stands under it and does not pray in it, so the kind refuses every
  one of them and hands them to nobody; Public Art & Monuments refuses the same rows as classes of
  the worship tree. The Hassan Tower is neither a World Heritage row of its own nor merely a
  tower: it **is** Rabat's mosque site, and its `P361` target, the Hassan Mosque, holds one
  sitelink and never reaches the pool, so its loss is a mosque site a traveller would name. They
  wait for a kind of their own (ADR-0052 decision 2).
- **A palace or a castle the tree reaches, which no class rule can separate from a real place of
  worship**: Pena Palace and Lambeth Palace are admitted beside the Potala Palace and the Yonghe
  Temple, and Loarre Castle beside Takht-e Soleyman and Ananuri — Loarre and Ananuri carry the same
  two classes (`castle`, `monastery`) and only one of them is the visit. A curator's hand.

## Terms

**CC0 1.0.** The licence waives copyright and the database right alike, and asks for no
attribution; it is given anyway. Nothing is scraped — the endpoint answers SPARQL, which is
what the run asks. Pictures are a separate
licence question and are answered by ADR-0043: every one is a Wikimedia Commons file and carries
the credit Commons states (the run of record credited 1142 of 1142 files).

## The runs that adopted it

Five dry runs on the development stack (#753, 2026-09-08 and 2026-09-09) — 100 the first
measurement, 101 after the first tuning of the class lists, 102 the run the class-list decisions
were read off, 103 after the last kills and the wat override, 104 the run of record with towers
out and the fold rule — each writing a sync-log row and its per-object report and nothing to the
catalogue:

| log | duration | admitted | refused | treasures |
|---|---|---|---|---|
| 100 | 27 m 55 s | 1089 | 63 | 77 works / 78 links |
| 101 | 7 m 45 s (warm cache) | 1080 | 76 | 65 works / 66 links |
| 102 | 7 m 43 s | 1086 | 65 | 65 works / 66 links at 50 places |
| 103 | 7 m 45 s | 1083 | 69 | 65 works / 66 links |
| **104** | **8 m 28 s** | **1078** | **77** | **68 works / 69 links at 46 places** |

Log 104 is the run of record — the first with the tower decision, the `arula (altar)` kill and the
fold rule in it: 1078 places — 1053 for their own fame alone, 4 through a work, 21 through both —
out of a works pool of 2800 works and the worship tree asked class by class, the two pools together
naming 5321 distinct entities. Its treasure links are 59 art, 7 relics and reliquaries, 2 tombs and
1 astronomical clock, and no towers; its types cathedral
286, church 228, mosque 175, monastery 160, temple 152, chapel 27, shrine 23, synagogue 13 and
14 places none of the eight words fits. Against log 103 it admits five fewer (four minarets an
earlier draft of the rule let in, and the Ara Pacis) and refuses eight more: those five, plus four
minarets that used to fall out below the line unremarked, less the Cappella Paolina's fold, which
the fold rule no longer makes.
All four works the ticket named arrive at their venue and are each venue's `admitted_for`.

The source is `experience_categories` row 4, *Places of worship*, filling the kind of the same
name, seeded with `requires_curation = true` — a community-edited source's first arrival waits
for a curator (ADR-0025) — and with its line on the row (`api_config.enterSitelinks` 22,
`staySitelinks` 18), read by every run and edited from the admin panel's source card. The first
live run is the maintainer's.

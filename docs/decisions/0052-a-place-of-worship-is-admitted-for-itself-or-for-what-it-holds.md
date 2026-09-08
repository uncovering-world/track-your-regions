# ADR-0052: A place of worship is admitted for itself or for what it holds

**Date:** 2026-09-08
**Status:** Accepted

---

## Context

#753 asked where a work a traveller goes to a church to see lives: Michelangelo's *Pietà* in
St Peter's, the *Last Supper* in Santa Maria delle Grazie, the *Ghent Altarpiece* in St Bavo's,
Bernini's *Ecstasy of Saint Teresa* in Santa Maria della Vittoria. The answer today is nowhere.
Public Art & Monuments refuses the works ("a work of a place of worship, not public art" — 30
refused rows of that shape in the development catalogue on 2026-09-08, the Pietà, the Moses,
the Chair of Saint Peter and the Horses of Saint Mark among them) and refuses the churches
themselves ("a place of worship, not public art" — Astorga, Jaén, Pamplona, Segovia, Oviedo);
Art Museums refuses the Church of Our Lady in Bruges ("site, not a venue: church building —
named by Madonna of Bruges (33 sitelinks)") and Antwerp's cathedral with its three Rubens.

Every refusal is right, and ADR-0045 says why: a church a traveller enters to see a work is a
place of the kind **Places of worship**, the work lives on the place (decision 4), and a kind is
offered to readers only once a sync of its own fills it under a rule that says what complete
means for it (decision 2). ADR-0048 adds the shape of that rule: a world tier is a global source
with one signal comparable across the world, cut by the ranking's own threshold stated once and
applied everywhere, and a source is a record in `docs/sources/` before it is code.

**What the source holds** (Wikidata, measured through QLever on 2026-09-08). Under `structure of
worship` (Q1370598, `P31/P279*` — 1265 classes, measured 2026-09-04) with coordinates: **1116
items at 22 sitelinks or more**, 538 at 30, 118 at 50. 192 of the 1116 also carry a World
Heritage id (P757). By country at 22: Italy 143, Turkey 58, Germany 58, France 58, the United
Kingdom 51, India 49, Russia 46, Spain 45, Japan 41, Greece 39, China 30, Egypt 29 — the world's
churches, mosques and temples, not one continent's.

**What the works hold.** The art-museums import's pool carries **38 works at 22 sitelinks or
more whose venue is inside the worship tree, standing at about 35 places once chapels fold into
their churches**. That half is European, and by the data rather than by the class list: counted
by the venue's country at 10 sitelinks it is Italy 59, the Vatican 26, Spain 20, Belgium 9,
Germany 8, then ones. Asia's great statues have almost no sitelinks *as items* — the Tōdai-ji
Daibutsu has 7, the Reclining Buddha of Wat Pho 1 — because their fame is the temple's, which
the other door already carries (India 49 places, Japan 41, China 30).

**What the tree reaches that is not a place to visit**, each read off a real row: the Leaning
Tower of Pisa (`church tower`), the Giralda (`steeple`), the minarets of Jam and Qutb
(`minaret`), Christ the Redeemer (`pilgrimage site`), the Temple Mount
(`hill, neighborhood`), Heliopolis and Olympia (`ancient city`, `polis`), Solomon's Temple
(`destroyed building or structure`) — and, once the
first dry run put the whole set on a page, Prague's Old Jewish Cemetery and Powązki, the Holy
Trinity Column in Olomouc, the Palais des Papes, the Basilica of Maxentius (a Roman law court
that reached the tree through `civil basilica` → `basilica` → `church building`), the
Auberge de Castille (the office of the Prime Minister of Malta, filed under `monastery`) and the
Ara Pacis (an `arula (altar)` behind glass in a museum, which the generic `shrine` class admits).
Ruins are the opposite case and stay: the Parthenon, Karnak and the Temple of Ephesian Artemis
are places a traveller stands in front of.

**Five dry runs on the development stack settled the lists** (`is_dry_run`, nothing written to
the catalogue). Log 100 ran 27 m 55 s and admitted 1089 of 5347 fetched entities, refusing 63, the
first measurement; log 101, on the warm cache, 1080 and 76, after the first tuning of the class
lists on log 100's own rows; log 102, 7 m 43 s, 1086 and 65, the run the class-list decisions were
read off; log 103, 7 m 45 s, 1083 and 69, after the last kills and the wat override.
**Log 104 is the run of record**, the first with the tower decision, the altar kill and the
fold rule in it: **8 m 28 s, 1078 places — 1074 by their own fame, 25 for what they hold (1053 by
fame alone, 4 through a work alone, 21 by both) — out of 5321 distinct entities the two pools
named, with 68 works written as 69 treasure links at 46 places (59 art, 7 relics and reliquaries,
2 tombs, 1 astronomical clock, and no towers) and 77 refusals**. Its types: cathedral 286, church
228, mosque 175, monastery 160, temple 152, chapel 27, shrine 23, synagogue 13, and 14 places none
of the eight words fits. Against log 103 it admits five fewer — the Minaret of Jam, the Qutb
Minar, the Hassan Tower and the Burana Tower, which an earlier draft of this rule admitted as
minarets with no mosque left, and the Ara Pacis — and refuses eight more: those five, plus four
minarets that used to fall out below the fame line unremarked (Kalta Minor, the Eger and Emin
minarets, Monar Jonban), less the Cappella Paolina's fold, which is no longer a loss. All four works the ticket
names arrive at the venue it names, and each is its venue's `admitted_for`.

## Decision

**1. One source, two doors, both the world tier.** The kind *Places of worship* is filled from a
single Wikidata source through two admissions on the same line: the place's own fame, and the
fame of a work it holds. A place is admitted when either door opens. Both doors are the world
tier of ADR-0048 decision 2, so an admitted place carries the Iconic badge (`badgesAdmitted`),
and `admitted_for` names the most famous of the works that admitted it — those at or above the
enter line; a place whose treasures all sit below the line names nothing, as does a place
holding none — which is the one thing about the doors the catalogue keeps. Which door a row
came through is the run's own bookkeeping and is not stored: a place famous in its own right
that holds an admitting work still names it (St Peter's, at 129 sitelinks, names the *Pietà*).

**2. Door one — the place.** An entity is a place of worship when it carries a class of the
worship tree (`P279*` under Q1370598, floored with the pinned `WORSHIP_CLASSES` and with every
root the type rule walks, so that what the rule can name the rule admits), minus the
designations that are not buildings at all (`pilgrimage site`, the list Public Art & Monuments
already keeps — which is why Christ the Redeemer never reaches this rule), and when no class of
a kill list read off the run's own rows refuses it —
`destroyed building or structure`, hill, mountain, neighbourhood, ancient city, polis, tell,
Jewish cemetery, Latin Rite Catholic cemetery, Holy Trinity column, palace of the Popes, civil
basilica, auberge, arula (altar). `destroyed building or structure`, and only that entry, is lifted by a
standing-ruin class (`religious building ruin`, `monastery ruins`): Fountains Abbey and St
Augustine's Abbey are World Heritage Sites with a ticket office, and the Second Temple and the
Basilica Aemilia, which carry no ruin class, stay refused. A row whose only worship class is a
*tower* — bell tower, campanile, church tower, minaret, steeple — is refused as "a tower, not a
place of worship", and offered to nobody: a traveller does not enter Pisa Cathedral to see the
Leaning Tower and does not call the Minaret of Jam a place of worship, so what they climb or
stand under is a visit of its own kind, which the catalogue does not carry yet
(`docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md` § Towers & Landmarks). Whether the tower stands
over a church or alone makes no difference to that answer, so the rule does not ask: the Leaning
Tower, the Giralda, St Mark's and Giotto's campaniles, the Kalyan Minaret, the Minaret of Jam,
the Qutb Minar, the Hassan Tower, the Burana Tower and Big Ben — which Wikidata types a `steeple`
— all read alike. A row carrying a proper worship class beside its tower is the place, as the
Ivan the Great Bell Tower and the Hagia Sophia are. The place must have coordinates on Earth. The fame line is
the source row's (decision 6), hysteretic as ADR-0023: a row enters at `enterSitelinks` and stays
until it falls below `staySitelinks`.

**3. Door two — a work it holds.** The art-museums import's works pool, extended with this
kind's own treasure classes walked as trees, is placed by the shared placement rule with a venue
rule whose classes are the worship tree and whose site veto is off. A place holding an admitted
work is admitted whatever its own sitelinks — the Church of Santo Tomé has 10 and holds *The
Burial of the Count of Orgaz* — and `MAX_HOLDERS` and the edition rule are ADR-0023's. Three
refusals belong to this door. **A museum wins**: a work the museum rule would place anywhere is
the museum's, so the *Creation of Adam* stays the Vatican Museums' and the Sistine Chapel enters
on its own fame with no works of ours. **A work that is itself a place is never a treasure**: 13
classes lie in both the treasure trees and the worship tree, and without this the Cavern of the
Patriarchs would be a place at one door and somebody's treasure at the other. **A lost work
opens nothing**: the Statue of Zeus at Olympia is typed `lost sculpture` and `destroyed
artwork`, and its temple stands on its own fame or not at all. Chapels fold into the church they
are inside by the door rule — Cornaro into Santa Maria della Vittoria, Contarelli into San Luigi
dei Francesi, Cerasi into Santa Maria del Popolo, the Chapel of the Emerald Buddha into Wat
Phra Kaew — and **a fold may only land on a place this kind could admit**. The museum's fold rule
picks its survivor by distance and container and knows nothing about worship, so a chapel could be
folded into a row the kind refuses and taken out of the catalogue with its works: the Cappella
Paolina folded into the Apostolic Palace, which the kill list refuses. A fold whose survivor,
followed to the end of its chain, is neither admitted by door one nor admitted by the rule is
dropped and the chapel stands as its own place. The test is the rule's and not the line's: a
survivor the rule admits is admitted by door two for any iconic work it receives, so a fold onto a
row only the line leaves out still stands.

**4. What is inside is a treasure when a traveller can look at it.** The kind's treasure classes
are the art roots the museums already use, plus relic, reliquary, tomb, crypt and astronomical
clock — the Shroud of Turin at Turin Cathedral, the Iron
Crown at Monza, the Shrine of the Three Kings at Cologne, the Strasbourg astronomical clock.
Manuscripts and church bells are deliberately
out: a codex is in an archive and a bell is in the tower, and neither is what the visitor is
looking at. **A tower is out for the same test read the other way**: nobody enters the church to
see its campanile, so the Leaning Tower is not one of the Duomo's things to look at, and putting
it on the cathedral's card would say it was. The five tower classes of decision 2 are refused as
places and are nobody's treasure either. The test is being on public view, not being valuable.

**5. A type is read from the class trees, in a precedence a guidebook would recognise.**
`cathedral`, `monastery`, `mosque`, `synagogue`, `chapel`, `church`, `shrine`, `temple`, in that
order, the first tree a row's classes reach winning: the Hagia Sophia is a **mosque** because
`mosque` precedes `church`, and St Peter's is a **church** — Wikidata gives it `parish church`
beside its three basilica titles and no cathedral class, which is also the traveller's answer,
since Rome's cathedral is the Lateran. The two generic roots match **only as the row's own
class**, never as trees: measured on 2026-09-08, `temple` (Q44539) is itself a subclass of
`shrine` (Q697295), and church building, cathedral, chapel and basilica are under both —
walking them would type every parish church a temple. What is walked is the particular word:
Shinto shrine, imamzadeh, dargah and the
Confucian ancestral shrine under `shrine`; the Buddhist, Hindu, Jain, Taoist and Confucian
temples, the gurdwara, the pagoda, the stupa, the temple complex and the ancient Greek, Roman
and Egyptian temples under `temple`. One entity class overrides the graph: a Thai `wat` is a
`temple`, because Wikidata files it under `vihāra` under `monastery` and nobody in Bangkok is
queueing for a monastery. A place none of the eight words fits is admitted **untyped**, which is
a real answer, not a gap: 18 of log 102's places are untyped, Po-i-Kalyan and the Alamo Mission
among them. Rome's Pantheon comes out a `church`, which is what stands there now.

**6. The fame line is stated on the source row, and an admin edits it.**
`api_config.enterSitelinks` and `api_config.staySitelinks` on `experience_categories` (22 and
18 for this source), read by the run at its start and written by
`PUT /api/admin/sync/categories/:categoryId/line` from the
source card. A run whose row states no line fails rather than falling back to a constant: a run
that quietly used 22 would admit a different catalogue than the panel says it does. Art Museums
and Public Art & Monuments keep their constants until a ticket generalises the field.

**7. A place of worship that is also a World Heritage row is two rows until #755.** 192 of the
1116 carry a World Heritage id, so Cologne Cathedral will have a pin in each list, exactly as
the Statue of Liberty does today. ADR-0046 already says how two rows become one place; making
them one is that issue's work, not this kind's.

**8. "Holds treasures" is derived, never stored.** A place says how many treasures it offers
from the offered links themselves — counted per row beside the region read, filtered by
`missing_since` and the gate, as every other reader-facing read of a venue's works is. No column,
no flag a run has to remember to keep in step.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Works-first alone, as the art-museums source does it (ADR-0023) | 38 works at the line reach about 35 places, and the door's geography is Italy 59 works and the Vatican 26 at 10 sitelinks against single rows outside Europe. A kind whose worldwide list is 35 churches with none in Prague, Istanbul or Kyoto is the false claim ADR-0045 decision 2 forbids. |
| The place's own fame alone | Cheaper and one door, but it leaves the ticket unanswered: the Church of St. Alphonsus Liguori (15 sitelinks), Santo Tomé (10), Wat Muang (3) and the Santuario de Misericordia (2) are in the catalogue only because of the work inside them, and a work a traveller crosses a city for is exactly what this kind was asked for. |
| A lower line on the world signal, to reach the churches the 22 misses | The world tier's cut is the ranking's own (ADR-0048 decision 2) and 22 is the line the other two Wikidata sources already state; what the line leaves out is the regional tier's job. Lowering it here would also mean two different worlds inside one product for no reason a reader could name. A comparison at several lines is its own ticket. |
| A class per sacred object, so that the Kaaba's Black Stone and the Western Wall enter | They carry no class under the worship tree at all; the only class that would admit them, `sacred place` (Q4588528), holds 30 rows at the line of which 25 are landscape — the Ganges, the Jordan, Fuji, Kailash, the Holy Land as a *term*. Six new kill classes to gain four rows. Both are a curator's hand. |
| One kind holding museums and churches, since both are "a venue with works" | ADR-0045 decision 1 settled it the other way: a traveller chooses between a cathedral and an art museum the way they choose between two kinds, and the same reasoning that gave art and archaeology museums separate lists gives this one its own. The pipeline is shared; the list is not. |

## Consequences

**Positive:**

- The four works of the ticket, and the churches they are in, are in the catalogue for a stated
  reason: the membership names the work that admitted the place, and the work itself is one of
  the place's treasures.
- Door one is balanced across the world by the source's own measurement — Italy 143 and India
  49, Turkey 58 and Japan 41 — so the kind is not the European half its works door would be
  alone.
- The rule is written as classes, not entities, and every list in it was tuned against a real
  run rather than against a guess: each entry names the rows that asked for it. The lists are
  code and changing one is a deploy; what needs none is the other half the shape leaves to a
  person — a curator's hand on the single row a class rule should not be bent for, the Western
  Wall, Gaztelugatxe, Pena Palace and Westminster Abbey's type among them (below).
- Places of worship is the first kind filled since ADR-0048's rules landed, and the register
  gains its first world-tier record (`wikidata-places-of-worship`, scorecard 16 of 16,
  `adopted`). The two-tier model held: the world tier's rule is the ranking's own, and the
  regional tier (ADR-0048 decision 3, by local-language readership — #807's method) is where
  Asia's balance improves, not a longer class list.

**Negative / Trade-offs:**

- **192 twins** with World Heritage rows: Cologne Cathedral is two pins and two cards until #755
  merges them, and a region's count of "places" counts it twice.
- **The Western Wall and the Kaaba are not in the kind**, and no list change reaches them; a
  traveller in Mecca is covered by Al-Masjid Al-Haram, which is admitted, and one at the Western
  Wall is covered by nothing. They wait for a curator, as the Black Stone and the kiswah do —
  both are real objects with no Wikidata class to carry them.
- **Six visitable rows are refused as destroyed buildings** because Wikidata types them so and
  types them no ruin: Champmol, Port-Royal-des-Champs, the Temple of Antoninus and Faustina, the
  Bibi-Heybat Mosque (destroyed in 1936 and rebuilt in 1999), the Abbey of St Victor and the
  Ospedale della Pietà. A class rule cannot reach them; a curator can.
- **Every tower is refused and handed to nobody**, and that is the decision rather than a gap:
  the Leaning Tower of Pisa, the Giralda, St Mark's and Giotto's campaniles, the Torrazzo of
  Cremona, Oldehove in Leeuwarden, the Kalyan Minaret, the Minaret of Jam, the Qutb Minar, the
  Hassan Tower and the Burana Tower are named in two rules and listed in none — this kind refuses
  them as towers and Public Art & Monuments refuses them as classes of the worship tree. Two of
  them are World Heritage Sites in their own right (Jam, the Qutb complex); the Hassan Tower is
  neither, but the tower **is** Rabat's mosque site, and its `P361` target, the Hassan Mosque,
  holds one sitelink and never reaches the pool, so its loss reads as a mosque site a traveller
  would name. The cost is real and it is paid until the proposed kind exists
  (`docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md` § Towers & Landmarks).
- **The tower reason can misdescribe a mausoleum or a complex.** Monar Jonban (18 sitelinks)
  carries `mausoleum` beside `minaret` — a Sufi tomb a traveller visits as a shrine — and the Emin
  Minaret (16) is Turpan's mosque complex; both sit below the enter line today, so refusing them
  as towers changes nothing about the catalogue, only the words the reason gives.
- **A palace or a castle Wikidata files under the worship tree is admitted**, and no class rule
  reaches it. Measured on log 102's own collection: the five rows carrying `palace` (Q16560) are
  the Potala Palace, the Yonghe Temple, Lambeth Palace, Pena Palace and the Palace of Mafra, and
  the three carrying `castle` (Q23413) are Takht-e Soleyman, Ananuri and Loarre Castle. Killing
  `palace` to reach Pena would take the Potala and the Yonghe with it; killing `castle` to reach
  Loarre would take Takht-e Soleyman, a Sasanian fire sanctuary and a World Heritage Site, and
  Ananuri, whose Church of the Assumption is the visit — and Loarre cannot be told from Ananuri by
  a class at all, since both carry `castle` beside `monastery`. Mafra keeps its own `basilica`
  class and is honestly in. So Pena Palace, Lambeth Palace and Loarre Castle are a curator's hand.
- **A type is Wikidata's claim, faithfully read, and three rows show what that costs.**
  Westminster Abbey comes out a `cathedral` because Wikidata gives it `Anglican or Episcopal
  cathedral`, though it is a Royal Peculiar and London's Anglican cathedral is St Paul's; St
  Basil's Cathedral comes out a `church`, since its only class is `Eastern Orthodox church
  building` and no cathedral class; and the Shrine of Bahá'u'lláh comes out a `church`, because
  `sanctuary` sits under `church building` in the class graph. Overriding any of them would be a
  claim about one row rather than about a vocabulary, which `TYPE_OVERRIDES` is deliberately not
  for (decision 5) — these are a curator's hand, as the Western Wall is.
- **A serial World Heritage listing enters as one place**, which the repo's own rule says it is
  not: the Sacred Sites and Pilgrimage Routes in the Kii Mountain Range (32 sitelinks), the
  Jesuit Missions of Chiquitos (32), the Shrines and Temples of Nikkō (30), the Jesuit Block and
  Estancias of Córdoba (29) and the Jesuit missions among the Guaraní (27) are each one row
  here, and visiting one of a serial site's locations is not visiting the site (ADR-0045
  decision 4 as ADR-0046 narrows it). Four of the five are also untyped, which is a usable
  signal for a later check; the fix belongs with the twins (#755, #768).
- **Gaztelugatxe is refused as a `mountain`**, and the hermitage at the top of the 241 steps is
  the visit. The entry stays because it is what refuses Roque Nublo and, with the cemetery
  class, Har HaMenuchot; this row is its cost, and a curator's, as above.
- **Manuscripts and church bells are not treasures** (decision 4), and the class test is coarser
  than the rule it serves: the Hereford Mappa Mundi is on permanent display and is refused with
  the archives, as the Codex Calixtinus and the Pummerin rightly are.
- **A fold onto a row the kind refuses is dropped, and a fold onto a row only the line leaves out
  is not.** The second half is the residue: the Temple of Amun at Karnak still folds into the
  Precinct of Amun-Re and the Santuari vell de Meritxell into Our Lady of Meritxell, because the
  rule admits both survivors and only the fame line leaves them out — and the works those chapels
  carry are below the line too, so nothing the catalogue would have written is lost. The
  Cappella Paolina, whose survivor the rule refuses, now stands as its own row; it is still not in
  the catalogue, because its own fame (17 sitelinks) and its two Michelangelo frescoes (16 and 14)
  are all below the line of 22. What the rule buys is that a chapel the catalogue *would* admit can
  no longer be taken out of it by a fold.
- **A second works pool per run.** The cache belongs to the source that asked (ADR-0047), so
  this source fetches the works pool the art-museums source already fetched. Log 100 took 27 m
  55 s cold against 7 m 43 s warm; the cost is a run's duration, not a rate-limit risk.
- **The line is editable on one source only.** Two sources still carry constants, so "where is
  the line" has two answers until the threshold explorer ticket generalises the field.

## References

- Related ADRs: ADR-0023 (works-first, `MAX_HOLDERS` and the edition rule — unchanged, and the
  works door reuses it), ADR-0024 (a source's rows may be refused while the source still lists
  them — the reason each refusal here is written by name), ADR-0025 (the source arrives gated,
  `requires_curation = true`), ADR-0030 and ADR-0047 (a source's answers are
  cached per source), ADR-0044 (the works floor, measured over this kind's own pool), ADR-0045
  decisions 1–3 (a kind with its own sync and its own rule; one source may feed several kinds —
  here one source fills one kind through two doors), ADR-0046 (identity across sources; the
  twins), ADR-0048 (the world tier's rule is the ranking's own; the regional tier is where the
  balance improves). No decision of any of them is narrowed.
- Related docs: `docs/tech/experiences.md` § Places of worship,
  [`docs/sources/global/wikidata-places-of-worship.md`](../sources/global/wikidata-places-of-worship.md),
  [`docs/tech/filling-a-kind.md`](../tech/filling-a-kind.md)
- PR / issue: #753; #754 (the public-art source whose tree and designations this kind reuses),
  #755 (the twins), #807 (the regional tier's signal)

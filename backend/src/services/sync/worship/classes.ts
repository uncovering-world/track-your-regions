/**
 * Which Wikidata classes make something a place of worship a traveller
 * visits, which refuse it, and which say what type it is.
 *
 * The shape of `publicArt/classes.ts`, and for the same reasons: the lists
 * are *classes*, not entities — a rule about kinds of thing, which a
 * curator's verdict can extend without a deploy — and every QID below carries
 * the label Wikidata gave it, verified with `wbgetentities` on 2026-09-08.
 * The rows they were read off are named in each comment.
 *
 * The public-art import already walks the worship tree, to refuse a cathedral
 * that Wikidata also types a monument. What it walks to refuse, this kind
 * walks to admit, so the root, the pinned floor under it and the designations
 * that are not buildings are imported from there rather than written twice —
 * one rule, one place (#674). What is new here is what only a kind whose
 * subject *is* the building needs: the parts of a place that are not the
 * place, and the type a reader filters by.
 */

import {
  WORSHIP_CLASSES,
  WORSHIP_DESIGNATIONS,
} from '../publicArt/classes.js';

/** `P279*` under structure of worship (Q1370598): 1267 classes (measured 2026-09-09; 1265 on 2026-09-04). */
export { WORSHIP_ROOT } from '../publicArt/classes.js';

/**
 * The roots the run asks the source to enumerate under, beside the one tree.
 *
 * "Structure of worship" reaches every one of these, but a query that asks
 * for a region's places under the root alone comes back with the tree's whole
 * long tail. These are the classes a traveller would name, and the ones the
 * catalogue is filled from first: each is walked with `boundedClosure`, as
 * the public-art import walks its sculptural roots.
 */
export const BROAD_WORSHIP_ROOTS: { qid: string; label: string }[] = [
  { qid: 'Q16970', label: 'church building' },
  { qid: 'Q32815', label: 'mosque' },
  { qid: 'Q44613', label: 'monastery' },
  { qid: 'Q44539', label: 'temple' },
  { qid: 'Q5393308', label: 'Buddhist temple' },
  { qid: 'Q842402', label: 'Hindu temple' },
  { qid: 'Q845945', label: 'Shinto shrine' },
  { qid: 'Q56242215', label: 'Catholic cathedral' },
  { qid: 'Q120560', label: 'minor basilica' },
];

/**
 * Refused whatever else the entity carries, with the reason named.
 *
 * Two shapes, both read off real rows. A building that no longer stands is
 * nothing to travel to: Solomon's Temple (Q223644) is typed `destroyed
 * building or structure` and nothing else. And a *place* Wikidata also types
 * with the building on it is the place, not the building: the Temple Mount
 * (Q193163) is `hill, sacred mountain, compound, mosque, neighborhood` — a
 * traveller who says they have been to the Temple Mount has not thereby
 * visited the Dome of the Rock, which is its own row.
 *
 * Not here: `archaeological site`. A ruined temple is still a place you stand
 * in front of — the Parthenon is typed `ancient Greek temple, Ancient Greek
 * archaeological site, religious building ruin` — and the class is not even a
 * mark of ruin: Angkor Wat, where monks live and pilgrims come, is typed
 * `Buddhist temple, archaeological site, temple complex, Hindu temple`.
 * Refusing it would empty out most of what the kind is for. `tell` is the
 * narrower thing that does refuse: Heliopolis (Q191687) is `tell, ancient
 * city`, a dig where nobody has worshipped for three thousand years. Göbekli
 * Tepe (Q214944) never reaches the rule at all — `tell, Neolithic settlement`
 * carries no worship class, so no pool question names it — and the entry keeps
 * it out should Wikidata one day add `temple` to it.
 *
 * The last three shapes are the ones the first dry run turned up, each named by
 * the rows it admitted (2026-09-08, source 4, log 100):
 *
 * - **a cemetery**. Wikidata files `Jewish cemetery` and `Latin Rite Catholic
 *   cemetery` directly under `structure of worship`, which let in Gehenna (47
 *   sitelinks), Prague's Old Jewish Cemetery (29), the Mount of Olives Jewish
 *   Cemetery (27), Sarajevo's Old Jewish Cemetery (23) and Powązki (23). A
 *   traveller visits all five, and not one of them to pray: the burial ground
 *   is not the synagogue beside it. Public Art & Monuments vetoes `cemetery`
 *   for the same reason. The two classes are listed separately because they
 *   share no parent inside the worship tree.
 * - **a column in a square**. `Holy Trinity column` is under the tree and
 *   admitted the Holy Trinity Column in Olomouc (40) and Vienna's Pestsäule
 *   (22) — monuments a city raised after a plague, which is Public Art &
 *   Monuments' object and not a building anyone enters. (`plague column`,
 *   Q26789694, which both rows also carry, is *not* under the tree and admits
 *   nothing on its own.)
 * - **a palace**. `palace of the Popes` is filed under `religious building`,
 *   which admitted the Apostolic Palace (59), the Palais des Papes (46) and the
 *   Papal Palace of Castel Gandolfo (23). A palace with a chapel in it is a
 *   palace; the chapel is its own row — the Sistine Chapel (90) enters on its
 *   own fame, which is what ADR-0052 says it should do. The generic `palace`
 *   (Q16560) is deliberately not here, and the measurement says why: the five
 *   rows carrying it in log 102 are the Potala Palace, the Yonghe Temple and
 *   Lambeth Palace — all three places of worship, the first two of them among
 *   the best known in the kind — beside Pena Palace and the Palace of Mafra.
 *   Refusing the class to reach the last two would cost the first two, so those
 *   two are a curator's hand. `castle` (Q23413) is out for the same measured
 *   reason: it carries Takht-e Soleyman, a Sasanian fire sanctuary and a World
 *   Heritage Site, and Ananuri, whose Church of the Assumption is the visit —
 *   and neither can be told from Loarre Castle by a class, since Loarre and
 *   Ananuri both carry `castle` beside `monastery`.
 *
 * - **an altar in a museum**. `arula (altar)` (Q97621821) is a Roman portable
 *   altar, and the Ara Pacis (41 sitelinks) is the one row of log 102 carrying
 *   it. Wikidata also gives that row the generic `shrine` (Q697295), which the
 *   type rule matches as a row's own class and which therefore admits it — an
 *   altar behind glass in the Museo dell'Ara Pacis, which is a museum visit and
 *   not a building anybody enters to pray in. The kill refuses that one row and
 *   no other place in the run.
 *
 * And one shape came *off* this list. `human settlement` was pinned before the
 * data was in, and the only row it refused in the whole run was Boudhanath
 * (Q889902, `human settlement, stupa`) — the great stupa of Kathmandu, a World
 * Heritage site and one of the busiest pilgrimages in Nepal, kept out because
 * Wikidata files the neighbourhood and the stupa under one item. Every
 * settlement-shaped refusal the run actually needed was carried by `ancient
 * city`, `polis`, `tell` or `neighborhood`: Heliopolis, Olympia, Dodona,
 * Amyclae, Sarmizegetusa Regia and the Temple Mount.
 *
 * Two more the run's own rows named, both of them a word that stopped meaning
 * a religious building centuries ago:
 *
 * - **a Roman law court**. `civil basilica` (Q2887138) is filed under `basilica`
 *   (Q163687), which is under `church building` — so the Basilica of Maxentius
 *   (33 sitelinks) and the Basilica Ulpia (23) were admitted and typed
 *   *church*. Both are Roman public halls in the Forum; a basilica became a
 *   church only when Constantine borrowed the floor plan. The two rows the run
 *   already refused as destroyed buildings, the Basilica Aemilia and the
 *   Basilica Julia, carry the same class and now name both reasons.
 * - **the office of the Prime Minister of Malta**. `auberge` (Q21584825) is the
 *   headquarters of a langue of the Knights Hospitaller, filed under
 *   `monastery`, and it admitted the Auberge de Castille (25) — the one row in
 *   the run carrying it — as a monastery. The Knights were a religious order;
 *   their inn was never a place anybody went to pray.
 *
 * What no list here can reach, so that the next reader does not try: the
 * **Western Wall** (Q134821, `wall, archaeological site, sacred place`) and the
 * **Kaaba** (Q29466, `sacred place`) carry no class under the worship tree at
 * all, and the only class that would admit them, `sacred place` (Q4588528),
 * holds 30 rows at the line of which 25 are landscape — the Ganges, the Jordan,
 * Fuji, Kailash, the Holy Land as a *term* — so opening it would cost six new
 * kill classes to gain four rows. Both are a curator's hand, as the Black Stone
 * is (ADR-0052).
 */
export const WORSHIP_KILL_CLASSES: Record<string, string> = {
  Q19860854: 'destroyed building or structure',
  Q54050: 'hill',
  Q8502: 'mountain',
  Q123705: 'neighborhood',
  Q15661340: 'ancient city',
  Q148837: 'polis',
  Q755017: 'tell',
  Q846659: 'Jewish cemetery',
  Q109239160: 'Latin Rite Catholic cemetery',
  Q11741382: 'Holy Trinity column',
  Q83400038: 'palace of the Popes',
  Q2887138: 'civil basilica',
  Q21584825: 'auberge',
  Q97621821: 'arula (altar)',
};

/**
 * The one kill class a standing ruin lifts, named so the rule reads it once.
 */
export const DESTROYED_BUILDING = 'Q19860854';

/**
 * A building that fell down and is still somewhere to go.
 *
 * Wikidata uses `destroyed building or structure` for two different facts: a
 * building that no longer exists — Solomon's Temple, the Church of the Holy
 * Apostles, both demolished Alexander Nevsky cathedrals — and a building whose
 * roof is gone while the walls a traveller walks between are not. The first dry
 * run refused **Fountains Abbey** (Q540237) and **St Augustine's Abbey**
 * (Q334303) on it, and both are World Heritage Sites with a ticket office.
 *
 * These two classes are the difference, and Wikidata says it plainly: a row
 * carrying one of them is a *ruin*, which is a thing you stand in front of.
 * The Parthenon has been admitted from the first day on exactly this reasoning
 * — `ancient Greek temple, archaeological site, religious building ruin` — and
 * it only ever passed because nothing had typed it destroyed as well.
 *
 * The lift is narrow on purpose: it applies to `destroyed building or
 * structure` and to nothing else in `WORSHIP_KILL_CLASSES`. A ruin on a hill is
 * still refused as a hill, because the hill is the row and the chapel on it is
 * not. Measured on log 100: of the 25 rows refused as destroyed buildings,
 * three carry a ruin class — Fountains Abbey and St Augustine's on `monastery
 * ruins`, the Older Parthenon on `religious building ruin` — and the other 22,
 * the Second Temple and the Basilica Aemilia among them, carry neither and stay
 * refused with the reason unchanged.
 *
 * Labels verified with `wbgetentities` on 2026-09-08; `monastery ruins` is a
 * subclass of `religious building ruin`, and the run's rows carried no third
 * ruin class of any kind.
 */
export const RUIN_CLASSES: Record<string, string> = {
  Q96352513: 'religious building ruin',
  Q1701174: 'monastery ruins',
};

/**
 * A tower, which is a visit of a kind this catalogue does not carry yet.
 *
 * Nobody enters Pisa Cathedral to see the Leaning Tower, and nobody calls the
 * Minaret of Jam a place of worship. A bell tower, campanile, church tower,
 * minaret or steeple is something a traveller climbs or stands under — the
 * Leaning Tower (Q39054, typed `church tower`), the Giralda (Q834479,
 * `steeple`), Giotto's Campanile and St Mark's, the Kalyan Minaret, the Minaret
 * of Jam (Q192981), the Qutb Minar (Q187635), Big Ben (Q41225, also a
 * `steeple`) — and the kind it belongs to is proposed and unbuilt
 * (`docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md` § Towers & Landmarks).
 *
 * So a row whose only worship class is one of these five is refused, with the
 * one reason that is true of every one of them: `a tower, not a place of
 * worship`. Whether it stands over a cathedral or alone in a Ghor river valley
 * makes no difference to that answer, so the rule does not ask — the tower is
 * not the church's second visit and it is not the church's treasure either
 * (`WORSHIP_TREASURE_CLASSES`).
 *
 * A row that carries a part class *and* a proper worship class is the place:
 * the Hagia Sophia (Q12506) is typed `minaret` among nine other classes, and
 * the Ivan the Great Bell Tower (Q957441) is `church building, bell tower` —
 * a tower you walk into that is itself a church.
 */
export const WORSHIP_PART_CLASSES: Record<string, string> = {
  Q200334: 'bell tower',
  Q1864226: 'campanile',
  Q72926449: 'church tower',
  Q48356: 'minaret',
  Q5191724: 'steeple',
};

/** What a reader filters a place of worship by. */
export type WorshipType =
  | 'cathedral' | 'monastery' | 'mosque' | 'synagogue'
  | 'chapel' | 'church' | 'shrine' | 'temple';

/**
 * The classes each type is read from, in precedence order, and which of them
 * are read as a tree.
 *
 * A place carries several of these at once and only one of them is what a
 * traveller would call it. Monreale is a cathedral and a Benedictine abbey;
 * Durham is a cathedral and a monastery; the Hagia Sophia is a mosque, a
 * church and a museum. The order below is the order a guidebook would put them
 * in — the more particular word first — so the first entry a row's classes
 * reach wins and the rest are not asked. The Hagia Sophia (Q12506: `minor
 * basilica, mosque, museum, church building, minaret, …`) is why `mosque` sits
 * above `church`: it has been a mosque since 2020, and a traveller queueing
 * outside is not queueing for a basilica.
 *
 * **`temple` and `shrine` are matched only as the row's own class**, which the
 * `direct` field says and `roots` does not. Measured on 2026-09-08: `temple`
 * (Q44539) is itself a subclass of `shrine` (Q697295), and `church building`,
 * `cathedral`, `Catholic cathedral`, `chapel`, `basilica`, `minor basilica`,
 * `gurdwara`, `Hindu temple` and `Buddhist temple` are every one of them under
 * *both*. Walking those two roots would type St Peter's a shrine and every
 * parish church a temple — the trees are the whole kind, not a type within it.
 * What is walked instead is the particular word: `Shinto shrine` under
 * `shrine`, and the four temple traditions plus the two ancient ones under
 * `temple`. A row typed only `temple` — the Temple of Heaven (Q125445) is
 * `temple` and a tourist-attraction grade, and nothing else — is still a
 * temple, which is what the direct match is for.
 *
 * The roots are a floor under whatever the run fetched, the way
 * `WORSHIP_CLASSES` is a floor under the worship set: a bounded closure that
 * refuses a hop still types a row that carries the root itself.
 */
export const TYPE_ROOTS: { type: WorshipType; roots: string[]; direct?: string[] }[] = [
  // cathedral
  { type: 'cathedral', roots: ['Q2977'] },
  // monastery
  { type: 'monastery', roots: ['Q44613'] },
  // mosque
  { type: 'mosque', roots: ['Q32815'] },
  // synagogue
  { type: 'synagogue', roots: ['Q34627'] },
  // chapel
  { type: 'chapel', roots: ['Q108325'] },
  // church building
  { type: 'church', roots: ['Q16970'] },
  // Shinto shrine, imamzadeh, dargah and the Confucian royal ancestral shrine —
  // walked; shrine, matched as the row's own class only. The last three are the
  // dry run's: Iran's great pilgrimage shrines are typed `imamzadeh` (Q136868)
  // and nothing a type root reached — Sheikh Safi al-Din (41 sitelinks), the
  // Imam Reza Shrine (39), Shah Cheragh (27), Fatima Masumeh (24) — the Haji Ali
  // Dargah in Mumbai (23) is typed `dargah` alone, and Jongmyo in Seoul (45) and
  // Beijing's Imperial Ancestral Temple (22) are the Confucian ancestral shrine.
  // All seven were admitted untyped by log 100.
  { type: 'shrine', roots: ['Q845945', 'Q136868', 'Q2639699', 'Q10948212'], direct: ['Q697295'] },
  // Buddhist temple, Hindu temple, gurdwara, ancient Greek temple, Roman
  // temple, Egyptian temple — walked; temple, matched directly only.
  //
  // Then the six the dry run added, each for rows it admitted with no type at
  // all: `pagoda` (Q199451 — the Giant Wild Goose Pagoda 38, Hoằng Phúc 38,
  // Kyaiktiyo 27, the Tower of the Yellow Crane 24, the Small Wild Goose Pagoda
  // 22), `stupa` (Q180987 — Pha That Luang 39, Boudhanath 44, and Indonesia's
  // `Candi` under it, Trowulan 23), `temple complex` (Q58621988 — Abu Simbel 93,
  // Khajuraho 30, Mahabalipuram 27), `temple of Confucius` (Q618618 — Qufu 29),
  // `Jain temple` (Q2613100 — the Dilwara Temples, 21, one sitelink under the
  // line the source states today and inside the pool either way) and `Taoist
  // temple` (Q1151612 — the Xuankong Temple, 32, which this run typed only
  // because Wikidata also calls it a Buddhist one).
  //
  // Each of the nine was checked against the live class graph before it was
  // walked: none of them has `church building`, `cathedral`, `Catholic
  // cathedral`, `mosque`, `chapel`, `monastery`, `synagogue`, `minor basilica`
  // or `Shinto shrine` beneath it, which is the trap that keeps the two generic
  // roots above out of `roots`.
  {
    type: 'temple',
    roots: ['Q5393308', 'Q842402', 'Q337986', 'Q267596', 'Q867143', 'Q855747',
      'Q199451', 'Q180987', 'Q58621988', 'Q618618', 'Q2613100', 'Q1151612'],
    direct: ['Q44539'],
  },
];

/**
 * The one class where the guidebooks overrule the class graph.
 *
 * A Thai `wat` (Q427287) is filed under both `Buddhist temple` and `vihāra`,
 * and a vihāra is a monastery — which is true of what happens inside the walls
 * and false of the word every traveller uses. `monastery` sits above `temple`
 * in `TYPE_ROOTS` because Durham and Monreale need it to, so the precedence
 * that is right for Europe typed six Thai rows of log 102 a monastery: Wat Phra
 * Kaew (45 sitelinks), Wat Arun (43), Wat Pho (28), Wat Benchamabophit (26),
 * Wat Rong Khun (25) and Wat Muang (3). Nobody in Bangkok is queueing for a
 * monastery.
 *
 * Read before the precedence loop and kept to the single class that needs it,
 * rather than reordered: moving `temple` above `monastery` would retype every
 * abbey the other way. A row that is a Buddhist monastery and *not* a wat keeps
 * the class graph's answer — Sera Monastery (Q124848, 25, `Tibetan Buddhist
 * monastery`) is a monastery, and reads as one.
 *
 * Label verified with `wbgetentities` on 2026-09-08: "Buddhist temple or
 * monastery in Thailand, Cambodia or Laos" — Wikidata's own description says
 * the ambiguity out loud.
 */
export const TYPE_OVERRIDES: Record<string, WorshipType> = {
  Q427287: 'temple', // wat
};

/**
 * What inside a place of worship is worth tracking on its own: the works door
 * of this kind, as an artwork is the museum's.
 *
 * A relic and its reliquary are what pilgrims came for; a tomb or a crypt is
 * whose church it is; an astronomical clock (Strasbourg, Prague) is what the
 * queue is for.
 *
 * **No tower is here.** Nobody walks into the church to see its campanile: the
 * Leaning Tower, the Giralda and St Mark's are visits of their own, of a kind
 * the catalogue does not carry yet, and calling one of them the cathedral's
 * treasure would put it on the cathedral's card as if it were a thing on
 * display inside. The five classes of `WORSHIP_PART_CLASSES` are refused as
 * places and offered to nobody, which is why that refusal names a missing kind
 * rather than a hand-over.
 *
 * `tomb` and `crypt` are on Public Art & Monuments' kill list, and that is not
 * a contradiction: a mausoleum is not a work in a square, and the same tomb
 * inside a cathedral is one of the things you came in to see.
 */
export const WORSHIP_TREASURE_CLASSES: Record<string, string> = {
  Q187616: 'relic',
  Q722604: 'reliquary',
  Q381885: 'tomb',
  Q192619: 'crypt',
  Q5275: 'astronomical clock',
};

export interface WorshipTrees {
  /** Every class that makes a row a place of worship: the tree, floored and cleaned. */
  worship: ReadonlySet<string>;
  /** The parts of a place that are not the place (`WORSHIP_PART_CLASSES`). */
  parts: ReadonlySet<string>;
  /** One set per type, in no order — `TYPE_ROOTS` holds the precedence. */
  types: Map<WorshipType, ReadonlySet<string>>;
}

/**
 * Compose the sets the verdict reads from what the run fetched and what is
 * pinned here, so the rule about which class counts for what is written once.
 * Pure: the pipeline hands over the closures, this joins the pinned lists to
 * them.
 *
 * The floor under the worship set is `WORSHIP_CLASSES` *and* every root in
 * `TYPE_ROOTS`, so the two answers cannot disagree: a row typed only
 * `cathedral` (Q2977, which the pinned floor does not carry) must not be
 * refused as having no place-of-worship class by a truncated closure while
 * `typeOf` — floored by the same roots — happily calls it a cathedral. What
 * the rule can name, the rule admits.
 *
 * The part classes come *out* of the set afterwards, so that a row whose only
 * worship class is a bell tower has no worship class at all and is refused as a
 * tower. A row that also carries a proper one keeps it, and is the place.
 */
export function buildWorshipTrees(fetched: {
  worship: Iterable<string>;
  typeTrees: Record<WorshipType, Iterable<string>>;
}): WorshipTrees {
  const parts = new Set(Object.keys(WORSHIP_PART_CLASSES));
  const worship = new Set([
    ...fetched.worship,
    ...Object.keys(WORSHIP_CLASSES),
    ...TYPE_ROOTS.flatMap(({ roots, direct }) => [...roots, ...(direct ?? [])]),
  ]);
  for (const designation of Object.keys(WORSHIP_DESIGNATIONS)) worship.delete(designation);
  for (const part of parts) worship.delete(part);

  // A walked root brings its tree; a `direct` class brings itself alone, which
  // is the whole of the distinction — `typeOf` reads the row's own classes, so
  // a set holding just the class matches exactly the row that carries it.
  const types = new Map<WorshipType, ReadonlySet<string>>();
  for (const { type, roots, direct } of TYPE_ROOTS) {
    types.set(type, new Set([...fetched.typeTrees[type], ...roots, ...(direct ?? [])]));
  }
  return { worship, parts, types };
}

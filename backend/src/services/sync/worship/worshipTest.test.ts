/**
 * What Places of worship admits, asked on real rows.
 *
 * Every case below is a named entity with the classes Wikidata gave it on
 * 2026-09-08, read with `wbgetentities`, so a rule that passes here has been
 * tried on the places a traveller would name rather than on shapes invented
 * for the test. Where a row carries more classes than the rule reads, the
 * whole list is handed in: the Leaning Tower is a museum as well as a church
 * tower, and the rule has to say the right thing about all of it.
 */

import { describe, it, expect } from 'vitest';
import { worshipVerdict, typeOf, type WorshipFacts } from './worshipTest.js';
import {
  buildWorshipTrees, RUIN_CLASSES, TYPE_OVERRIDES,
  WORSHIP_KILL_CLASSES, WORSHIP_PART_CLASSES, WORSHIP_TREASURE_CLASSES,
} from './classes.js';

// Places of worship.
const CHURCH = 'Q16970';
const CATHEDRAL = 'Q2977';
const CATHOLIC_CATHEDRAL = 'Q56242215';
const BASILICA = 'Q120560';
const CHAPEL = 'Q108325';
const MOSQUE = 'Q32815';
const TEMPLE = 'Q44539';
const BUDDHIST_TEMPLE = 'Q5393308';
const HINDU_TEMPLE = 'Q842402';
const ANCIENT_GREEK_TEMPLE = 'Q267596';
const MONASTERY = 'Q44613';
const SYNAGOGUE = 'Q34627';
const SHRINE = 'Q697295';
const SHINTO_SHRINE = 'Q845945';
const GURDWARA = 'Q337986';
const RELIGIOUS_BUILDING = 'Q24398318';

// Parts of a place of worship, and a designation that is not a building.
const BELL_TOWER = 'Q200334';
const CHURCH_TOWER = 'Q72926449';
const MINARET = 'Q48356';
const STEEPLE = 'Q5191724';
const PILGRIMAGE_SITE = 'Q15135589';

// A building that fell down and is still somewhere to go.
const RELIGIOUS_RUIN = 'Q96352513';
const MONASTERY_RUINS = 'Q1701174';
const ABBEY = 'Q160742';

// Refused outright.
const DESTROYED = 'Q19860854';
const HILL = 'Q54050';
const NEIGHBORHOOD = 'Q123705';
const JEWISH_CEMETERY = 'Q846659';
const CATHOLIC_CEMETERY = 'Q109239160';
const TRINITY_COLUMN = 'Q11741382';
const PAPAL_PALACE = 'Q83400038';
const CIVIL_BASILICA = 'Q2887138';
const AUBERGE = 'Q21584825';
const HUMAN_SETTLEMENT = 'Q486972';

// A wat is a temple whatever the class graph files it under; a Tibetan
// Buddhist monastery is not.
const WAT = 'Q427287';
const TIBETAN_MONASTERY = 'Q54074585';

// The type roots the first dry run added, each read off a row it left untyped.
const IMAMZADEH = 'Q136868';
const DARGAH = 'Q2639699';
const ANCESTRAL_SHRINE = 'Q10948212';
const PAGODA = 'Q199451';
const STUPA = 'Q180987';
const TEMPLE_COMPLEX = 'Q58621988';
const CONFUCIUS_TEMPLE = 'Q618618';
const JAIN_TEMPLE = 'Q2613100';
const TAOIST_TEMPLE = 'Q1151612';

// Classes the rule has nothing to say about, carried by the rows below.
const MUSEUM = 'Q33506';
const STATUE = 'Q179700';
const BUILT_STRUCTURE = 'Q811979';
const HISTORIC_SITE = 'Q1081138';
const ARCHAEOLOGICAL_SITE = 'Q839954';

/**
 * The trees Wikidata walks, as the run will hand them over: the buildings
 * under "structure of worship", the parts that hang off them, a pilgrimage
 * site — a designation a statue on a mountain can carry — and one tree per
 * *walked* type root.
 *
 * The type trees carry the overlaps the real class graph has, measured on
 * 2026-09-08: `chapel` and `minor basilica` are both under `church building`,
 * so the church tree lists them. What no tree lists is anything under `temple`
 * (Q44539) or `shrine` (Q697295), because those two are matched as a row's own
 * class and never walked — under the live graph each of them reaches the whole
 * kind, `church building` and `cathedral` included.
 *
 * `gurdwara` is deliberately missing — a closure that refuses a hop comes back
 * short — so every case below that turns on a gurdwara is answered by the
 * `TYPE_ROOTS` floor and by nothing else.
 */
const trees = buildWorshipTrees({
  worship: [CHURCH, CATHEDRAL, CATHOLIC_CATHEDRAL, BASILICA, CHAPEL, MOSQUE, TEMPLE,
    BUDDHIST_TEMPLE, HINDU_TEMPLE, ANCIENT_GREEK_TEMPLE, PILGRIMAGE_SITE,
    BELL_TOWER, CHURCH_TOWER, MINARET],
  typeTrees: {
    cathedral: [CATHEDRAL, CATHOLIC_CATHEDRAL],
    // `Tibetan Buddhist monastery` is under both `vihāra` and `monastery`,
    // which is what makes Sera the negative case for the wat override.
    monastery: [MONASTERY, TIBETAN_MONASTERY],
    mosque: [MOSQUE],
    synagogue: [SYNAGOGUE],
    chapel: [CHAPEL],
    church: [CHURCH, BASILICA, CHAPEL],
    shrine: [SHINTO_SHRINE],
    // `wat` is under `Buddhist temple` as well as under `vihāra`; the override
    // is what settles which of the two words wins, not this tree.
    temple: [BUDDHIST_TEMPLE, HINDU_TEMPLE, ANCIENT_GREEK_TEMPLE, WAT],
  },
});

const facts = (classes: string[], over: Partial<WorshipFacts> = {}): WorshipFacts =>
  ({ qid: 'Q1', classes, onEarth: true, lat: 41.9, lon: 12.5, ...over });

function reasonOf(v: ReturnType<typeof worshipVerdict>): string {
  expect(v.pass).toBe(false);
  return (v as { reason: string }).reason;
}

describe('worshipVerdict — what it admits', () => {
  it('admits Cologne Cathedral and types it a cathedral', () => {
    // Q4176: `Catholic cathedral`, and nothing else.
    expect(worshipVerdict(facts([CATHOLIC_CATHEDRAL]), trees)).toEqual({ pass: true, type: 'cathedral' });
  });

  it('admits the Parthenon, a ruined temple you still stand in front of', () => {
    // Q10288: `ancient Greek temple, Ancient Greek archaeological site,
    // religious building ruin`. A ruin is a place; a destroyed building is not.
    expect(worshipVerdict(facts([ANCIENT_GREEK_TEMPLE, 'Q93342462', 'Q96352513']), trees))
      .toEqual({ pass: true, type: 'temple' });
  });

  it('admits Angkor Wat, a living temple Wikidata calls an archaeological site', () => {
    // Q43473: `Buddhist temple, archaeological site, temple complex, Hindu
    // temple`. Monks live there and pilgrims come; the class is no verdict.
    expect(worshipVerdict(facts([BUDDHIST_TEMPLE, 'Q839954', 'Q58621988', HINDU_TEMPLE]), trees))
      .toEqual({ pass: true, type: 'temple' });
  });

  it('admits the Hagia Sophia, whose minaret is a part of it and not the place', () => {
    // Q12506: `minor basilica, mosque, museum, secularized church, secularized
    // mosque, built structure, historic building, church building, minaret,
    // former cathedral`. The minaret is a part class; the mosque class beside
    // it means the row is the place, not the part.
    expect(worshipVerdict(facts([BASILICA, MOSQUE, MUSEUM, 'Q96371632', 'Q96440023', 'Q811979',
      'Q35112127', CHURCH, MINARET, 'Q97588309']), trees)).toEqual({ pass: true, type: 'mosque' });
  });

  it('admits the Ivan the Great Bell Tower, which is a church as well as a tower', () => {
    // Q957441: `church building, bell tower, architectural landmark`. A bell
    // tower you can walk into and that is itself a church is a place.
    expect(worshipVerdict(facts([CHURCH, BELL_TOWER, 'Q2319498']), trees))
      .toEqual({ pass: true, type: 'church' });
  });

  it('admits Harmandir Sahib on its gurdwara class, which only the floor carries', () => {
    // Q180422, the Golden Temple in Amritsar: `built structure, historic site,
    // pilgrimage site, gurdwara`. Three of the four say nothing — and the
    // pilgrimage site is struck out as a designation — so the row stands or
    // falls on `gurdwara`, which the fetched tree above does not list. Without
    // the type roots under the worship set it would be refused as having no
    // place-of-worship class while `typeOf` called it a temple.
    expect(worshipVerdict(facts([BUILT_STRUCTURE, HISTORIC_SITE, PILGRIMAGE_SITE, GURDWARA]), trees))
      .toEqual({ pass: true, type: 'temple' });
  });

  it('admits Fountains Abbey, a ruin Wikidata also calls a destroyed building', () => {
    // Q540237: `monastery, abbey, monastery ruins, destroyed building or
    // structure, building complex`. A World Heritage Site with a ticket office
    // and a car park, refused by the first dry run as demolished. The ruin
    // class lifts that one kill and nothing else.
    expect(worshipVerdict(facts([MONASTERY, ABBEY, MONASTERY_RUINS, DESTROYED, 'Q1497364']), trees))
      .toEqual({ pass: true, type: 'monastery' });
    // Q334303, St Augustine's Abbey in Canterbury, also World Heritage:
    // `church building, monastery ruins, destroyed building or structure`.
    expect(worshipVerdict(facts([CHURCH, MONASTERY_RUINS, DESTROYED]), trees))
      .toEqual({ pass: true, type: 'church' });
  });

  it('still refuses the Basilica Aemilia, destroyed with no ruin class of its own', () => {
    // Q522924, in the order Wikidata states its classes: `destroyed building or
    // structure, civil basilica, archaeological site`. Twenty-two of the
    // twenty-five rows the first dry run refused as destroyed buildings carry
    // no ruin class, and the destroyed reason is unchanged; the Roman law court
    // it also is now names itself beside it. The Basilica Julia is the same row.
    expect(reasonOf(worshipVerdict(facts([DESTROYED, CIVIL_BASILICA, 'Q839954']), trees)))
      .toBe('not a place to visit: destroyed building or structure; civil basilica');
  });

  it('refuses the Basilica of Maxentius: a Roman law court, not a church', () => {
    // Q371921, 33 sitelinks, `civil basilica, archaeological site` — admitted
    // by log 102 and typed `church`, because `civil basilica` is filed under
    // `basilica` and so under `church building`. A basilica became a church
    // when Constantine borrowed the floor plan; the hall in the Forum did not.
    // Q1266234, the Basilica Ulpia (23), is the same row.
    expect(reasonOf(worshipVerdict(facts([CIVIL_BASILICA, 'Q839954']), trees)))
      .toBe('not a place to visit: civil basilica');
  });

  it("refuses the Auberge de Castille: the Prime Minister of Malta's office", () => {
    // Q2499012, 25 sitelinks, `auberge` and nothing else — the only row in log
    // 102 carrying the class, admitted and typed `monastery` because an auberge
    // is filed under `monastery`. The Knights Hospitaller were a religious
    // order; their inn was never somewhere anybody went to pray.
    expect(reasonOf(worshipVerdict(facts([AUBERGE]), trees)))
      .toBe('not a place to visit: auberge');
  });

  it('refuses a ruined chapel on a hill as the hill, ruin class or not', () => {
    // The lift is `destroyed building or structure` alone: every other kill
    // class still refuses whatever else the row carries, which is the rule the
    // Temple Mount is here for.
    expect(reasonOf(worshipVerdict(facts([CHAPEL, RELIGIOUS_RUIN, DESTROYED, HILL]), trees)))
      .toBe('not a place to visit: hill');
  });

  it('admits a place of worship on the equator and the prime meridian', () => {
    // Number.isFinite, not truthiness: a coordinate of 0 is a coordinate.
    expect(worshipVerdict(facts([MOSQUE], { lat: 0, lon: 0 }), trees)).toEqual({ pass: true, type: 'mosque' });
  });

  it('admits a place of worship no type root reaches, with no type', () => {
    // `religious building` — the floor `WORSHIP_CLASSES` pins, which the
    // fetched tree above does not list. Nothing says which of the eight types
    // it is, and a place with no type is still a place.
    expect(worshipVerdict(facts([RELIGIOUS_BUILDING]), trees)).toEqual({ pass: true, type: null });
  });
});

describe('worshipVerdict — what it refuses', () => {
  it("refuses Solomon's Temple: a destroyed building", () => {
    // Q223644: `destroyed building or structure`, and nothing else — there is
    // nothing left in Jerusalem to stand in front of.
    expect(reasonOf(worshipVerdict(facts([DESTROYED]), trees)))
      .toBe('not a place to visit: destroyed building or structure');
  });

  it('refuses the Temple Mount: a hill, whatever else stands on it', () => {
    // Q193163: `hill, sacred mountain, compound, mosque, neighborhood`. The
    // mosque class does not save it: a kill class refuses whatever else the
    // row carries, and the thing named is the hill, not the Dome of the Rock.
    expect(reasonOf(worshipVerdict(facts([HILL, 'Q1595289', 'Q5156823', MOSQUE, NEIGHBORHOOD]), trees)))
      .toBe('not a place to visit: hill; neighborhood');
  });

  it('refuses the Leaning Tower of Pisa: a tower, not a place of worship', () => {
    // Q39054: `tourist attraction, museum, church tower, inclined tower,
    // religious museum, free-standing tower`. Nobody enters the Duomo to see
    // its campanile, and nobody calls the campanile a place of worship: it is
    // a visit of a kind the catalogue does not carry yet.
    expect(reasonOf(worshipVerdict(facts([
      'Q570116', MUSEUM, CHURCH_TOWER, 'Q797765', 'Q92755865', 'Q127038589']), trees)))
      .toBe('a tower, not a place of worship: church tower');
  });

  it('refuses the Kalyan Minaret and the Minaret of Jam in the same words', () => {
    // Q4294007, the Kalyan Minaret: `minaret`, and `part of` Po-i-Kalyan, which
    // the run admits. Q192981, the Minaret of Jam: `minaret, archaeological
    // site`, a World Heritage Site standing alone in a Ghor river valley with no
    // mosque left. What the tower stands next to does not change what it is, so
    // the rule does not ask and both read alike — as do the Qutb Minar
    // (Q187635), the Hassan Tower (Q579331) and the Burana Tower (Q852032),
    // each of them `minaret` and nothing else.
    expect(reasonOf(worshipVerdict(facts([MINARET]), trees)))
      .toBe('a tower, not a place of worship: minaret');
    expect(reasonOf(worshipVerdict(facts([MINARET, ARCHAEOLOGICAL_SITE]), trees)))
      .toBe('a tower, not a place of worship: minaret');
  });

  it("refuses Giotto's Campanile, and Big Ben, which Wikidata types a steeple", () => {
    // Q1140023, Giotto's Campanile: `bell tower, tower`, beside Florence's
    // cathedral. Q41225, Big Ben: `cultural icon, national symbol, striking
    // clock, architectural element, inclined tower, clock tower, belfry,
    // steeple, clock bell, bell`, and `part of` the Palace of Westminster — a
    // parliament, not a church. One tower is a cathedral's and one is a
    // parliament's, and the same sentence is true of both.
    expect(reasonOf(worshipVerdict(facts([BELL_TOWER, 'Q12518']), trees)))
      .toBe('a tower, not a place of worship: bell tower');
    expect(reasonOf(worshipVerdict(facts([
      'Q3139104', 'Q1128637', 'Q1480017', 'Q391414', 'Q797765', 'Q853854',
      'Q815448', STEEPLE, 'Q138800422', 'Q101401']), trees)))
      .toBe('a tower, not a place of worship: steeple');
  });

  it('refuses Christ the Redeemer: a pilgrimage site is a designation, not a building', () => {
    // Q79961: `colossal statue of Jesus, pilgrimage site, colossal statue,
    // statue, monument`. It is Public Art & Monuments' already.
    expect(reasonOf(worshipVerdict(facts([
      'Q29168169', PILGRIMAGE_SITE, 'Q1779653', STATUE, 'Q4989906']), trees)))
      .toBe('no place-of-worship class');
  });

  it('refuses a place of worship on another globe, or without coordinates', () => {
    expect(reasonOf(worshipVerdict(facts([MOSQUE], { onEarth: false }), trees)))
      .toBe('not on Earth: its coordinate (P625) is on another globe');
    expect(reasonOf(worshipVerdict(facts([MOSQUE], { lat: null, lon: null }), trees)))
      .toBe('no coordinates of its own (P625)');
  });

  // The two lists in full, written out. A table driven from the constant
  // proves each entry fires, but it disappears along with an entry someone
  // deletes; this is the assertion that fails. The whole door is a product
  // decision, so widening or narrowing it should mean editing a test.
  it("refuses Prague's Old Jewish Cemetery: a burial ground, not the synagogue beside it", () => {
    // Q846659 is `Jewish cemetery`, which Wikidata files directly under
    // `structure of worship`. Four rows arrived on it in the first dry run —
    // Gehenna (47 sitelinks), Prague (29), the Mount of Olives (27), Sarajevo
    // (23) — and a traveller visits every one of them, none of them to pray.
    expect(reasonOf(worshipVerdict(facts([JEWISH_CEMETERY]), trees)))
      .toBe('not a place to visit: Jewish cemetery');
  });

  it('refuses Powązki Cemetery, which Wikidata files under the worship tree too', () => {
    // Q109239160, `Latin Rite Catholic cemetery`: the same shape under a
    // different parent, which is why the two are listed separately.
    expect(reasonOf(worshipVerdict(facts(['Q811165', CATHOLIC_CEMETERY]), trees)))
      .toBe('not a place to visit: Latin Rite Catholic cemetery');
  });

  it('refuses the Holy Trinity Column in Olomouc: a monument in a square', () => {
    // Q11741382 `Holy Trinity column`, Q26789694 `plague column`. The first is
    // under the worship tree and admitted it (40 sitelinks) and Vienna's
    // Pestsäule (22); the second is not under the tree and admits nothing.
    expect(reasonOf(worshipVerdict(facts([TRINITY_COLUMN, 'Q26789694']), trees)))
      .toBe('not a place to visit: Holy Trinity column');
  });

  it('refuses the Palais des Papes: a palace with a chapel in it is a palace', () => {
    // Q83400038 `palace of the Popes` is filed under `religious building` and
    // admitted the Apostolic Palace (59), Avignon (46) and Castel Gandolfo (23).
    // The Sistine Chapel enters on its own fame; the palace around it does not.
    expect(reasonOf(worshipVerdict(facts(['Q16560', 'Q207694', PAPAL_PALACE]), trees)))
      .toBe('not a place to visit: palace of the Popes');
  });

  it('admits Boudhanath, a stupa Wikidata also calls a human settlement', () => {
    // Q889902, 44 sitelinks: `human settlement, stupa`. Wikidata keeps the
    // neighbourhood of Boudha and the great stupa under one item, and
    // `human settlement` — pinned before the data was in — refused the whole
    // row. It was the only thing that class refused in the first dry run.
    expect(worshipVerdict(facts([HUMAN_SETTLEMENT, STUPA]), trees))
      .toEqual({ pass: true, type: 'temple' });
  });

  it('refuses exactly these, and names each one', () => {
    expect(Object.values(WORSHIP_KILL_CLASSES)).toEqual([
      'destroyed building or structure', 'hill', 'mountain', 'neighborhood',
      'ancient city', 'polis', 'tell', 'Jewish cemetery',
      'Latin Rite Catholic cemetery', 'Holy Trinity column', 'palace of the Popes',
      'civil basilica', 'auberge', 'arula (altar)',
    ]);
    expect(Object.values(WORSHIP_PART_CLASSES)).toEqual([
      'bell tower', 'campanile', 'church tower', 'minaret', 'steeple',
    ]);
  });

  it('refuses the Ara Pacis, an altar in a museum the generic shrine class admits', () => {
    // Q623612 (`wbgetentities`, 2026-09-09): `archaeological site, museum, arula
    // (altar), shrine`. `shrine` (Q697295) is matched as a row's own class and
    // is what admits it, so the altar class is what refuses it — the visit is
    // the Museo dell'Ara Pacis, which is a museum. Measured on log 102's own
    // collection: the Ara Pacis is the only row in the run carrying it.
    expect(reasonOf(worshipVerdict(facts([ARCHAEOLOGICAL_SITE, MUSEUM, 'Q97621821', SHRINE]), trees)))
      .toBe('not a place to visit: arula (altar)');
  });

  it.each(Object.entries(WORSHIP_KILL_CLASSES))('refuses a row typed only %s (%s)', (qid, label) => {
    expect(reasonOf(worshipVerdict(facts([qid]), trees))).toBe(`not a place to visit: ${label}`);
  });

  it.each(Object.entries(WORSHIP_PART_CLASSES))('refuses a bare %s (%s) as a tower', (qid, label) => {
    expect(reasonOf(worshipVerdict(facts([qid]), trees)))
      .toBe(`a tower, not a place of worship: ${label}`);
  });
});

describe('typeOf', () => {
  it('takes the type in precedence order, not the row order', () => {
    // A monastery that is also a cathedral is a cathedral — Monreale, Durham.
    expect(typeOf([MONASTERY, CATHEDRAL], trees)).toBe('cathedral');
    // Hagia Sophia is a mosque, not a museum's church.
    expect(typeOf([MUSEUM, MOSQUE], trees)).toBe('mosque');
    // A chapel inside a church is the chapel — the Scrovegni, the Sistine.
    expect(typeOf([CHAPEL, CHURCH], trees)).toBe('chapel');
    // Itsukushima is a Shinto shrine before it is a temple.
    expect(typeOf([SHINTO_SHRINE, BUDDHIST_TEMPLE], trees)).toBe('shrine');
    expect(typeOf([CHURCH], trees)).toBe('church');
  });

  it('calls the Hagia Sophia a mosque, on the whole row Wikidata gives it', () => {
    // Q12506: `minor basilica, mosque, museum, secularized church, secularized
    // mosque, built structure, historic building, church building, minaret,
    // former cathedral`. It has been a mosque since 2020; a traveller queueing
    // outside is not queueing for a basilica, so `mosque` outranks `church`.
    expect(typeOf([BASILICA, MOSQUE, MUSEUM, 'Q96371632', 'Q96440023', 'Q811979',
      'Q35112127', CHURCH, MINARET, 'Q97588309'], trees)).toBe('mosque');
  });

  it('calls a Catholic cathedral a cathedral, not a shrine or a temple', () => {
    // Both generic roots sit above it in the live class graph — `Catholic
    // cathedral` is under `temple` and under `shrine` — so a walked tree there
    // would answer before `cathedral` ever ran.
    expect(typeOf([CATHOLIC_CATHEDRAL], trees)).toBe('cathedral');
    // And every parish church would be a temple.
    expect(typeOf([CHURCH], trees)).toBe('church');
    expect(typeOf([BASILICA], trees)).toBe('church');
  });

  it('calls the Pantheon a church, the word that is true of it today', () => {
    // Q99309: `Roman temple, Roman archaeological site, minor basilica, …`.
    // It has been the basilica of Santa Maria ad Martyres since 609 and mass
    // is still said there, so the standing use outranks the ancient one — the
    // precedence that puts `church` above `temple` is what says so.
    expect(typeOf(['Q867143', 'Q21752084', BASILICA, 'Q96376684'], trees)).toBe('church');
  });

  it('calls a row whose only worship class is the generic temple a temple', () => {
    // Q125445, the Temple of Heaven: `temple` and a tourist-attraction grade.
    // The root is matched as the row's own class, which is the whole reason a
    // direct match exists beside the walked trees.
    expect(typeOf([TEMPLE, 'Q6838244'], trees)).toBe('temple');
    // The same for the generic shrine root.
    expect(typeOf([SHRINE], trees)).toBe('shrine');
  });

  it('names the seven Asian and Iranian shapes the first dry run left untyped', () => {
    // Each is a row log 100 admitted with `type = null`, and the class that is
    // now walked under the word a traveller uses for it.
    // Imam Reza (39 sitelinks), Sheikh Safi al-Din (41), Shah Cheragh (27),
    // Fatima Masumeh (24) — `imamzadeh, mausoleum, architectural ensemble,
    // cultural property`; the shrine is what the pilgrims come to.
    expect(typeOf([IMAMZADEH, 'Q162875', 'Q1497375', 'Q2065736'], trees)).toBe('shrine');
    // Haji Ali Dargah, Mumbai (23): `dargah`, and nothing else.
    expect(typeOf([DARGAH], trees)).toBe('shrine');
    // Jongmyo, Seoul (45): `Confucian royal ancestral shrine`, and nothing else.
    expect(typeOf([ANCESTRAL_SHRINE], trees)).toBe('shrine');
    // The Giant Wild Goose Pagoda, Xi'an (38): `pagoda, tourist attraction,
    // AAAAA tourist attraction`.
    expect(typeOf([PAGODA, 'Q797765', 'Q6838244'], trees)).toBe('temple');
    // Pha That Luang, Vientiane (39): `stupa`, and nothing else.
    expect(typeOf([STUPA], trees)).toBe('temple');
    // Abu Simbel (93): `archaeological site, architectural ensemble, temple
    // complex` — the third is the only one of the three that says what it is.
    expect(typeOf(['Q839954', 'Q1497375', TEMPLE_COMPLEX], trees)).toBe('temple');
    // The Temple of Confucius at Qufu (29): `temple of Confucius, building
    // complex`.
    expect(typeOf([CONFUCIUS_TEMPLE, 'Q1497364'], trees)).toBe('temple');
  });

  it('types the two temple traditions the run saw only under the generic root', () => {
    // The Dilwara Temples (21 sitelinks) are `Jain temple` and nothing else —
    // one under the line the source states today, and in the pool either way,
    // so the type has to be right the day the line moves.
    expect(typeOf([JAIN_TEMPLE], trees)).toBe('temple');
    // The Xuankong Temple (32) is `Taoist temple, hanging temple, Buddhist
    // temple`: this run typed it only because of the third class.
    expect(typeOf([TAOIST_TEMPLE], trees)).toBe('temple');
  });

  it('calls Wat Pho a temple, which is the word every guidebook uses', () => {
    // Q708186, 28 sitelinks: `wat`, and nothing else. A wat is filed under both
    // `Buddhist temple` and `vihāra`, and a vihāra is a monastery — so the
    // precedence Durham and Monreale need typed six Thai rows of log 102 a
    // monastery: Wat Phra Kaew (45), Wat Arun (43), Wat Pho (28), Wat
    // Benchamabophit (26), Wat Rong Khun (25), Wat Muang (3).
    expect(typeOf([WAT], trees)).toBe('temple');
    // And it wins wherever it appears, not only alone.
    expect(typeOf([MONASTERY, WAT, BUDDHIST_TEMPLE], trees)).toBe('temple');
  });

  it('still calls Sera Monastery a monastery, which is not a wat', () => {
    // Q124848, 25 sitelinks: `cultural heritage of China, Tibetan Buddhist
    // monastery` (Q54074585, under both `vihāra` and `monastery`). The override
    // is one class, not a reordering: a Buddhist monastery that is not a wat
    // keeps the class graph's answer.
    expect(typeOf(['Q10300916', TIBETAN_MONASTERY], trees)).toBe('monastery');
  });

  it('reaches a type root the fetched tree did not list', () => {
    // The roots are a floor under the fetched trees, so a bounded closure that
    // refuses a hop still types Harmandir Sahib's `gurdwara` class a temple.
    expect(typeOf([GURDWARA], trees)).toBe('temple');
  });

  it('has no type for a class no root reaches', () => {
    expect(typeOf([RELIGIOUS_BUILDING], trees)).toBeNull();
  });
});

describe('the class lists', () => {
  it('lifts the destroyed-building kill on exactly two ruin classes', () => {
    // The two Wikidata itself uses for a building whose walls you walk between.
    // Widening this is a product decision about what the kind admits, so it
    // should mean editing a test.
    expect(RUIN_CLASSES).toEqual({
      Q96352513: 'religious building ruin',
      Q1701174: 'monastery ruins',
    });
  });

  it('overrules the class graph for exactly one class', () => {
    // The guidebooks beat the ontology only here. Anything added is a claim
    // that a whole vocabulary got a word wrong, which should mean a test.
    expect(TYPE_OVERRIDES).toEqual({ Q427287: 'temple' });
  });

  it('keeps every tower out of the treasures as well as out of the places', () => {
    // A tower refused as a place must not come back as the church's treasure:
    // nobody enters the Duomo to see the Leaning Tower, so it belongs to neither
    // list. A part class appearing here would put a tower on a cathedral's card
    // as if it were something on display inside.
    for (const [qid, label] of Object.entries(WORSHIP_PART_CLASSES)) {
      expect(WORSHIP_TREASURE_CLASSES[qid], `${label} (${qid})`).toBeUndefined();
    }
    expect(Object.values(WORSHIP_TREASURE_CLASSES)).toEqual([
      'relic', 'reliquary', 'tomb', 'crypt', 'astronomical clock',
    ]);
  });
});

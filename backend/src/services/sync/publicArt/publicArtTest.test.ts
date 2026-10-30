/**
 * What Public art and Monuments & memorials admit, asked on the rows the first
 * runs got wrong.
 *
 * Every case below is a real entity with the classes Wikidata gave it on
 * 2026-09-04, so a rule that passes here has been tried on the catalogue's own
 * mistakes rather than on shapes invented for the test.
 */

import { describe, it, expect } from 'vitest';
import { publicArtVerdict, type PublicArtFacts } from './publicArtTest.js';
import type { ContainerFact } from '../places/containment.js';
import { buildTrees } from './classes.js';
import { MONUMENTS_RULE as monuments, PUBLIC_ART_RULE as art } from './kindRules.js';

const SCULPTURE = 'Q860861';
const STATUE = 'Q179700';
const COLOSSAL_STATUE = 'Q1779653';
const MONUMENTAL_SCULPTURE = 'Q3476533';
const FOUNTAIN = 'Q483453';
const WAR_MEMORIAL = 'Q575759';
const MONUMENT = 'Q4989906';
const MEMORIAL = 'Q5003624';
const OBELISK = 'Q170980';
const TRIUMPHAL_ARCH = 'Q143912';
const VICTORY_COLUMN = 'Q1930585';
const EQUESTRIAN_STATUE = 'Q659396';
const MURAL = 'Q219423';
const US_NATIONAL_MEMORIAL = 'Q1967454';
const SQUARE = 'Q174782';
const LAKE = 'Q23397';
const HOLY_TRINITY_COLUMN = 'Q11741382';
const MUSEUM = 'Q33506';
const ART_MUSEUM = 'Q207694';
const MILITARY_MUSEUM = 'Q2772772';
const LOCAL_MUSEUM = 'Q1595639';
const NATURAL_HISTORY_MUSEUM = 'Q1970365';
const HISTORY_MUSEUM = 'Q16735822';
const WORSHIP = 'Q1370598';
const CATHOLIC_CATHEDRAL = 'Q56242215';
const SHINTO_SHRINE = 'Q845945';
const BASILICA = 'Q120560';

const PILGRIMAGE_SITE = 'Q15135589';
const PUBLIC_ART_GENRE = 'Q557141';

const LOST_ARTWORK = 'Q4140840';
const DESTROYED_ARTWORK = 'Q21745157';
const LOST_SCULPTURE = 'Q26883973';
const INSTALLATION = 'Q20437094';

const trees = buildTrees({
  sculptural: [SCULPTURE, STATUE, COLOSSAL_STATUE, MONUMENTAL_SCULPTURE, 'Q29168169'],
  fountain: [FOUNTAIN, 'Q1371047'],
  commemorative: [WAR_MEMORIAL, 'Q321053', 'Q1541043'],
  museum: [MUSEUM, ART_MUSEUM, MILITARY_MUSEUM, 'Q17431399', LOCAL_MUSEUM, NATURAL_HISTORY_MUSEUM, HISTORY_MUSEUM],
  // The tree Wikidata walks under "structure of worship": the buildings, and
  // a pilgrimage site, which is a designation a statue can carry.
  worship: [WORSHIP, CATHOLIC_CATHEDRAL, SHINTO_SHRINE, BASILICA, 'Q1534477', 'Q2031836', PILGRIMAGE_SITE],
  // The tree under lost artwork as Wikidata answered it on 2026-09-12.
  lost: [LOST_ARTWORK, DESTROYED_ARTWORK, LOST_SCULPTURE, 'Q104438958'],
});

const facts = (over: Partial<PublicArtFacts>): PublicArtFacts => ({
  qid: 'Q1', classes: [SCULPTURE], containers: [], collections: [], commemorates: [], depicts: [], genres: [], subjects: [],
  onEarth: true, lat: 41.9, lon: 12.5, ...over,
});

/** A container the entity is located in (`P276`), or walked up to when `via` names the ones below. */
const inside = (qid: string, label: string, classes: string[], building?: string, ...via: string[]): ContainerFact =>
  (via.length === 0
    ? { qid, label, classes, building, relation: 'located in' }
    : { qid, label, classes, building, relation: 'above', via });

/** A container the entity is part of (`P361`). */
const partOf = (qid: string, label: string, classes: string[]): ContainerFact =>
  ({ qid, label, classes, relation: 'part of' });

/** An owner (`P195`). */
const owned = (qid: string, label: string, classes: string[]): ContainerFact =>
  ({ qid, label, classes, relation: 'in the collection of' });

function reasonOf(v: ReturnType<typeof publicArtVerdict>): string {
  expect(v.pass).toBe(false);
  return (v as { reason: string }).reason;
}

describe('publicArtVerdict — what it refuses', () => {
  it('refuses a cathedral Wikidata also types a monument', () => {
    // Segovia Cathedral: `Catholic cathedral, monument` — eleven Spanish
    // cathedrals arrived this way, "monument" being the heritage designation.
    const v = publicArtVerdict(facts({ classes: [CATHOLIC_CATHEDRAL, MONUMENT] }), trees, art);
    expect(reasonOf(v)).toContain('place of worship');
  });

  it('refuses a shrine typed a war memorial', () => {
    // Yasukuni Shrine: Shinto shrine, chokusaisha, war memorial, gokoku shrine.
    const v = publicArtVerdict(facts({ classes: [SHINTO_SHRINE, 'Q175288', WAR_MEMORIAL, 'Q1534477'] }), trees, art);
    expect(reasonOf(v)).toContain('place of worship');
  });

  it('lets a war memorial lift a cemetery\'s veto for Monuments & memorials, and nothing for Public art', () => {
    // Arlington: war cemetery, US national cemetery, cemetery, war memorial,
    // Direct Reporting Unit — a cemetery a traveller visits as a memorial.
    const arlington = facts({ classes: ['Q1241568', 'Q1516659', 'Q39614', WAR_MEMORIAL, 'Q127701543'] });
    expect(publicArtVerdict(arlington, trees, monuments)).toMatchObject({ pass: true, type: 'memorial', artwork: true });
    expect(reasonOf(publicArtVerdict(arlington, trees, art))).toBe('no public-art class');
  });

  it('refuses a concentration camp typed a memorial and a museum', () => {
    // Stutthof: Nazi concentration camp, military museum, concentration camp,
    // memorial, crime scene.
    const v = publicArtVerdict(
      facts({ classes: ['Q328468', MILITARY_MUSEUM, 'Q152081', MEMORIAL, 'Q1360677'] }), trees, art,
    );
    expect(reasonOf(v)).toContain('camp');
  });

  it('refuses a stadium', () => {
    // Panathenaic Stadium: Ancient Greek stadium, multi-purpose stadium,
    // monument, Olympic stadium, pitch, all-seater stadium.
    const v = publicArtVerdict(
      facts({ classes: ['Q64722124', 'Q1049757', MONUMENT, 'Q589481', 'Q2310214', 'Q4728370'] }), trees, art,
    );
    expect(reasonOf(v)).toContain('stadium');
  });

  it('refuses a museum typed a monument', () => {
    // Reina Sofía: art museum, national museum, monument, former hospital,
    // arts center — also a museum row already.
    const v = publicArtVerdict(
      facts({ classes: [ART_MUSEUM, 'Q17431399', MONUMENT, 'Q64578911', 'Q2190251'] }), trees, monuments,
    );
    expect(reasonOf(v)).toContain('museum');
  });

  it('refuses a palace that is also a monument', () => {
    // Aljafería: palace, castle, parliament building, monument, fortified palace.
    const v = publicArtVerdict(
      facts({ classes: ['Q16560', 'Q23413', 'Q7138926', MONUMENT, 'Q98795663'] }), trees, monuments,
    );
    expect(reasonOf(v)).toContain('palace');
  });

  it('refuses a mausoleum, in words the review page passes through as they are', () => {
    // Mausoleum of Mao Zedong: mausoleum, memorial. Not the museum rule's
    // `kill-list:` prefix: the review page's help panel explains that one as
    // curatorial departments and museum networks, which is nobody's reason
    // for turning down a mausoleum. This form reaches the card untranslated.
    const v = publicArtVerdict(facts({ classes: ['Q162875', MEMORIAL] }), trees, art);
    expect(reasonOf(v)).toBe('not public art: mausoleum');
  });

  it('refuses an archaeological site, however famous', () => {
    // Stonehenge: cromlech, monument, archaeological site, history museum, henge.
    // Named for what it is, not for the museum class Wikidata also hangs on it.
    const v = publicArtVerdict(
      facts({ classes: ['Q935773', MONUMENT, 'Q839954', 'Q16735822', 'Q1035294'] }), trees, art,
    );
    expect(reasonOf(v)).toContain('archaeological site');
  });

  it('refuses a sidewalk of stars', () => {
    // Hollywood Walk of Fame: monument, hall of fame, walk of fame.
    const v = publicArtVerdict(facts({ classes: [MONUMENT, 'Q1046088', 'Q47502370'] }), trees, art);
    expect(reasonOf(v)).toContain('walk of fame');
  });

  it('refuses a play', () => {
    // Mystery Play of Elche: liturgical drama, party, literary work.
    const v = publicArtVerdict(facts({ classes: ['Q1253136', 'Q200538', 'Q7725634'] }), trees, art);
    expect(reasonOf(v)).toContain('liturgical drama');
  });

  it('refuses a French commune typed a memorial', () => {
    // Le Gua: commune of France, memorial.
    const v = publicArtVerdict(facts({ classes: ['Q484170', MEMORIAL] }), trees, art);
    expect(reasonOf(v)).toContain('commune');
  });

  it('refuses a neighbourhood even though it names a statue', () => {
    // Columbus Circle: traffic circle, neighborhood of Manhattan, monument,
    // rostral column, statue — the row is the circle, not the monument on it.
    const v = publicArtVerdict(
      facts({ classes: ['Q1529', 'Q61297932', MONUMENT, 'Q1112897', STATUE] }), trees, art,
    );
    expect(reasonOf(v)).toContain('neighborhood');
  });

  it('refuses an amusement park even though it names a sculpture', () => {
    // Madurodam: amusement park, miniature park, war memorial, sculpture.
    const v = publicArtVerdict(
      facts({ classes: ['Q194195', 'Q974968', WAR_MEMORIAL, SCULPTURE] }), trees, art,
    );
    expect(reasonOf(v)).toContain('amusement park');
  });

  it('refuses a work the source records as destroyed, by the lost tree alone', () => {
    // The Floating Piers: an installation artwork typed destroyed artwork and
    // nothing under lost sculpture — which a pinned kill class let through.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, INSTALLATION, DESTROYED_ARTWORK] }), trees, art);
    expect(v.pass).toBe(false);
    expect(reasonOf(v)).toContain('nothing to stand in front of');
  });

  it('keeps refusing a lost sculpture, now through the same tree', () => {
    // The Lemnian Athena: sculpture, lost sculpture.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, LOST_SCULPTURE] }), trees, art);
    expect(reasonOf(v)).toContain('nothing to stand in front of');
  });

  it('keeps the one work whose remains are on show, as the museum kinds do', () => {
    // The Colossus of Constantine: a destroyed artwork whose fragments are what
    // a traveller stands in front of (REMAINS_ON_SHOW). Where it stands is the
    // container rule's question; being lost is not a reason on its own.
    const v = publicArtVerdict(facts({ qid: 'Q1289781', classes: [SCULPTURE, DESTROYED_ARTWORK] }), trees, art);
    expect(v.pass ? '' : (v as { reason: string }).reason).not.toContain('nothing to stand in front of');
  });

  it('refuses a lost sculpture from the pinned floor when the fetched tree came back short', () => {
    const short = buildTrees({ sculptural: [SCULPTURE], fountain: [], commemorative: [], museum: [], worship: [], lost: [] });
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, LOST_SCULPTURE] }), short, art);
    expect(reasonOf(v)).toContain('nothing to stand in front of');
  });

  it('refuses what the source records as destroyed', () => {
    // Georgia Guidestones: monument, destroyed building or structure.
    const v = publicArtVerdict(facts({ classes: [MONUMENT, 'Q19860854'] }), trees, art);
    expect(reasonOf(v)).toContain('destroyed');
  });

  it('refuses a work inside a church, naming the church', () => {
    // Michelangelo's Pietà: sculpture, cultural property; located in St. Peter's
    // Basilica. A work a traveller goes to a church to see is #753's, not this.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE, 'Q2065736'],
      containers: [inside('Q12512', "St. Peter's Basilica", [BASILICA, 'Q16970'])],
    }), trees, art);
    expect(reasonOf(v)).toContain("inside St. Peter's Basilica");
    // Where it is held, for the places of worship to take it (ADR-0102).
    expect(v).toMatchObject({ pass: false, heldIn: ['Q12512'] });
  });

  it('still names the church when another link up the chain could not be read (#1819)', () => {
    const v = publicArtVerdict(facts({
      containers: [
        inside('Q12512', "St. Peter's Basilica", [BASILICA, 'Q16970']),
        { qid: 'Q999999999', label: 'Q999999999', classes: [], relation: 'located in', unknown: true },
      ],
    }), trees, art);
    expect(reasonOf(v)).toContain("inside St. Peter's Basilica");
  });

  it('does not take a work for one outdoors when where it stands could not be read (#1819)', () => {
    // A link a subset build left out: it may be the museum the work is in.
    const v = publicArtVerdict(facts({
      containers: [{ qid: 'Q999999999', label: 'Q999999999', classes: [], relation: 'located in', unknown: true }],
    }), trees, art);
    expect(v).toEqual({ pass: false, reason: 'where it stands could not be read (Q999999999): not taken for public art' });
  });

  it('does not take a work for one outdoors when nothing places it and its owner could not be read (#1819)', () => {
    const v = publicArtVerdict(facts({
      collections: [{ qid: 'Q999999999', label: 'Q999999999', classes: [], relation: 'in the collection of', unknown: true }],
    }), trees, art);
    expect(reasonOf(v)).toBe('whose it is could not be read (Q999999999): not taken for public art');
  });

  it('refuses a work a museum holds, naming the museum', () => {
    // The Dendera zodiac: sculpture; located in Room 325 of the Louvre — the
    // pipeline walks the room up to the museum and hands the museum in.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [
        inside('Q19119449', 'Room 325', ['Q180516']),
        inside('Q19675', 'Louvre', [ART_MUSEUM], undefined, 'Q19119449'),
      ],
    }), trees, art);
    expect(reasonOf(v)).toContain('inside Louvre');
    // From the place the reason names outward: the museum, not the room below it.
    expect(v).toMatchObject({ pass: false, heldIn: ['Q19675'] });
  });

  it('refuses a work that is only part of a museum, as the museum\'s', () => {
    // A sculpture whose one statement about where it is is `part of` a
    // museum: that is whose it is, and with nothing saying where it stands,
    // whose it is decides — the collection rule, with the museum it is part
    // of read as an owner (#803).
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [partOf('Q637248', 'Naples National Archaeological Museum', ['Q3329412', MUSEUM])],
    }), trees, art);
    expect(reasonOf(v)).toBe('part of Naples National Archaeological Museum: a work of a museum, not public art');
  });

  it('refuses a work part of an archaeological preserve, though a museum administers it', () => {
    // The Madara Rider: a rock relief; part of the Madara archaeological
    // preserve, and part of the Shumen History museum, the institution that
    // runs the preserve. The first live run refused it as a work inside the
    // museum; the museum is read as its owner now, and the preserve is what
    // it stands in — which is archaeology's, and the World Heritage list's.
    const v = publicArtVerdict(facts({
      classes: ['Q22022298'],
      containers: [
        partOf('Q12292250', 'Shumen History museum', [HISTORY_MUSEUM]),
        partOf('Q12285540', 'Madara (Archeological Preserve)', ['Q839954']),
      ],
    }), trees, monuments);
    expect(reasonOf(v)).toBe('part of Madara (Archeological Preserve): archaeological site, not a monument or memorial');
  });

  it('keeps a church typed a museum as a place, though the work is only part of it', () => {
    // A statue part of a deconsecrated church that is run as a museum — a
    // container in both trees — and located on the square in front. The
    // church is a building, and part of it is part of its fabric: it stays a
    // place, the square does not stand in for it, and the veto runs.
    const v = publicArtVerdict(facts({
      classes: [STATUE],
      containers: [
        inside('Q1', 'A square', ['Q174782']),
        partOf('Q2', 'A former church, now a museum', [ART_MUSEUM, 'Q16970']),
      ],
    }), trees, art);
    expect(reasonOf(v)).toBe('inside A former church, now a museum: a work of a museum, not public art');
  });

  it('refuses a memorial typed a museum and a castle, for the castle', () => {
    // Montjuïc Castle: memorial, military museum, prison, castle. A
    // commemorative class lifts the museum's veto, and a cemetery's and a bare
    // building's (`MEMORIAL_LIFTS`): a castle typed a memorial is still the
    // castle.
    const v = publicArtVerdict(facts({ classes: [MEMORIAL, MILITARY_MUSEUM, 'Q40357', 'Q23413'] }), trees, monuments);
    expect(reasonOf(v)).toBe('not a memorial, and typed: castle');
  });

  it('refuses a place a monument class says nothing about, as belonging to no kind yet', () => {
    // Sanabria Lake: lake, monument, historic site. The Field of Mars: square,
    // memorial. The Anne Frank House: historic house museum, war memorial.
    // The Temple of Literature: monument, heritage site.
    const cases: [string[], string][] = [
      [[LAKE, MONUMENT, 'Q1081138'], 'a lake, which no kind holds yet: not a monument or memorial'],
      [[SQUARE, MEMORIAL], 'a square, which no kind holds yet: not a monument or memorial'],
      [['Q2087181', WAR_MEMORIAL], 'a historic house museum, which no kind holds yet: not a monument or memorial'],
      [[MONUMENT, 'Q358'], 'a heritage site, which no kind holds yet: not a monument or memorial'],
    ];
    for (const [classes, reason] of cases) {
      expect(reasonOf(publicArtVerdict(facts({ classes }), trees, monuments))).toBe(reason);
    }
  });

  it('lets a sculpture answer a place class, and not a fountain', () => {
    // Manneken Pis: sculpture, heritage site. The Villa d'Este: Italian
    // garden, villa, fountain — its fountains are the villa's garden.
    expect(publicArtVerdict(facts({ classes: [SCULPTURE, 'Q358'] }), trees, art))
      .toMatchObject({ pass: true, type: 'sculpture' });
    expect(reasonOf(publicArtVerdict(facts({ classes: ['Q12781', 'Q3950', FOUNTAIN] }), trees, art)))
      .toBe("a Giardino all'italiana, which no kind holds yet: not public art");
  });

  it('refuses a museum the heritage register calls a monument', () => {
    // Bilbao Fine Arts Museum: art museum, monument — "Monumento" being what
    // Spain's register calls a listed building. A designation is not a
    // memorial, and lifts nothing.
    const v = publicArtVerdict(facts({ classes: [ART_MUSEUM, MONUMENT] }), trees, monuments);
    expect(reasonOf(v)).toBe('not a memorial, and typed: a museum');
  });

  it('refuses a work a museum owns when nothing says where it stands, naming the museum', () => {
    // The Shigir Idol: sculpture; no location (P276), no part-of (P361); in
    // the collection of the Sverdlovsk Regional Natural History Museum (local
    // museum, natural history museum, historic site) and of the Museum of
    // History and Archaeology of the Middle Urals (museum). The first live run
    // admitted it as a monument on the museum (#804): with nothing saying
    // where it stands, the collection is the only signal, and it is a museum's.
    // The reason names the first collection the source listed that is one.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      collections: [
        owned('Q4410161', 'Sverdlovsk Regional Natural History Museum', [LOCAL_MUSEUM, NATURAL_HISTORY_MUSEUM, 'Q1081138']),
        owned('Q105486673', 'Museum of History and Archaeology of the Middle Urals', [MUSEUM]),
      ],
    }), trees, art);
    expect(reasonOf(v)).toBe(
      'in the collection of Sverdlovsk Regional Natural History Museum: a work of a museum, not public art',
    );
  });

  it('refuses a work a church owns when every location it had has ended', () => {
    // The Horses of Saint Mark: group of sculptures; nine P276 statements —
    // the Hippodrome, the basilica, the Tuileries — every one carrying an end
    // time, so the walk reads none; in the collection of St Mark's Basilica
    // (cathedral, minor basilica). The originals are in the basilica's
    // museum, the replicas on its loggia: the basilica's either way.
    const v = publicArtVerdict(facts({
      classes: ['Q2293362'],
      collections: [owned('Q172988', "St Mark's Basilica", ['Q2977', BASILICA])],
    }), trees, art);
    expect(reasonOf(v)).toBe("in the collection of St Mark's Basilica: a work of a place of worship, not public art");
    expect(v).toMatchObject({ pass: false, heldIn: ['Q172988'] });
  });

  it('refuses a church the worship tree knows and the pinned floor does not', () => {
    // Church of St. Mary of Blachernae: holy well, Eastern Orthodox church
    // building. The second dry run admitted it — the holy well is in the
    // fountain closure and lifted the veto the tree then was. A building of
    // worship refuses outright, whatever else the entity carries.
    const v = publicArtVerdict(facts({ classes: ['Q1371047', 'Q2031836'] }), trees, art);
    expect(reasonOf(v)).toContain('place of worship');
  });

  it('refuses a work in a room of a palace, naming the room and its own building', () => {
    // The Dendera zodiac: sculpture; located in Room 325, in the Sully Wing,
    // part of the Louvre *Palace* — which Wikidata types a palace, not a museum.
    // A room is indoors whatever the building is called, and the building
    // named is the top of the room's own chain, which the pipeline hands in —
    // not whatever container the walk happened to visit last.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [
        inside('Q19119449', 'Room 325', ['Q180516'], 'Louvre Palace'),
        inside('Q1', 'Tomb of somebody', ['Q381885']),
        inside('Q17309954', 'Sully Wing', ['Q1125776'], 'Louvre Palace'),
        inside('Q1075988', 'Louvre Palace', ['Q16560']),
      ],
    }), trees, art);
    expect(reasonOf(v)).toBe('inside Room 325 (Louvre Palace): a work indoors, not public art');
  });

  it('names a room alone when nothing above it was fetched', () => {
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q19119449', 'Room 325', ['Q180516'])],
    }), trees, art);
    expect(reasonOf(v)).toBe('inside Room 325: a work indoors, not public art');
  });

  it('refuses a work that is part of an archaeological site', () => {
    // The Ishtar Gate: arch; part of Babylon. What stands in the Pergamon
    // Museum is the site's, and the site is archaeology's.
    const v = publicArtVerdict(facts({
      classes: ['Q12277'],
      containers: [inside('Q5684', 'Babylon', ['Q839954', 'Q15661340'])],
    }), trees, monuments);
    expect(reasonOf(v)).toBe('part of Babylon: archaeological site, not a monument or memorial');
    // A site owns its parts, and no works kind holds a site: nothing is handed over.
    expect(v).not.toHaveProperty('heldIn');
  });

  it('does not refuse a work for being part of a district, a forest or a landscape', () => {
    // The third dry run refused the Charging Bull as part of the Financial
    // District, the Hermannsdenkmal as part of the Teutoburg Forest and the
    // Lion Monument as part of Lucerne. A settlement, an area or a landscape
    // is where outdoor art stands; only a site owns its parts.
    for (const [label, classes] of [
      ['Financial District', ['Q123705']],
      ['Teutoburg Forest', ['Q4421']],
      ['Lucerne', ['Q486972']],
      ['Paseo del Prado', ['Q1129474']],
    ] as const) {
      const v = publicArtVerdict(facts({ classes: [SCULPTURE], containers: [inside('Q1', label, [...classes])] }), trees, art);
      expect(v.pass, label).toBe(true);
    }
  });

  it('refuses a find, which is a museum object wherever Wikidata locates it', () => {
    // The Venus of Willendorf: Venus figurine, sculpture, archaeological find;
    // located in Austria. Nothing about a figurine is somewhere to stand.
    const v = publicArtVerdict(facts({ classes: ['Q248726', SCULPTURE, 'Q10855061'] }), trees, art);
    expect(reasonOf(v)).toContain('Venus figurine');
  });

  it('refuses a sculpture that stands on the Moon', () => {
    // Fallen Astronaut: sculpture, monument; P625 on Q405.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, MONUMENT], onEarth: false }), trees, art);
    expect(reasonOf(v)).toContain('not on Earth');
  });

  it('refuses an entity with no public-art class at all', () => {
    const v = publicArtVerdict(facts({ classes: ['Q515'] }), trees, art); // city
    expect(reasonOf(v)).toContain('no public-art class');
  });

  it('refuses an entity with no coordinates of its own', () => {
    const v = publicArtVerdict(facts({ lat: null, lon: null }), trees, art);
    expect(reasonOf(v)).toContain('coordinates');
  });
});

describe('publicArtVerdict — a work stranded outdoors on a venue no kind offers (#1444)', () => {
  // The war museum's hill in Kyiv, Kingston Lacy's garden and the Cappella
  // Sansevero: museums by class, none of them a place any kind offers.
  const WAR_MUSEUM = inside('Q2457600', 'National Museum of the History of Ukraine in World War II', [MILITARY_MUSEUM]);
  const KINGSTON_LACY = inside('Q1232310', 'Kingston Lacy', [MUSEUM]);
  const SANSEVERO = inside('Q897839', 'Cappella Sansevero', [MUSEUM]);
  const nothingOffered = new Set<string>();

  it('keeps the Mother Ukraine Monument, a colossal statue on the grounds of a museum no kind offers', () => {
    const v = publicArtVerdict(facts({ qid: 'Q142917', classes: [COLOSSAL_STATUE], containers: [WAR_MUSEUM] }), trees, art, nothingOffered);
    expect(v.pass).toBe(true);
  });

  it('keeps the Philae obelisk in the garden of Kingston Lacy', () => {
    const v = publicArtVerdict(facts({ qid: 'Q1245805', classes: [OBELISK], containers: [KINGSTON_LACY] }), trees, monuments, nothingOffered);
    expect(v.pass).toBe(true);
  });

  it('keeps refusing the Veiled Christ: a sculpture in a hall is the venue\'s, offered or not', () => {
    const v = publicArtVerdict(facts({ qid: 'Q3697674', classes: [SCULPTURE], containers: [SANSEVERO] }), trees, art, nothingOffered);
    expect(reasonOf(v)).toBe('inside Cappella Sansevero: a work of a museum, not public art');
  });

  it('keeps refusing a colossal statue at a venue a kind offers, which that kind takes (ADR-0102)', () => {
    const v = publicArtVerdict(facts({ qid: 'Q142917', classes: [COLOSSAL_STATUE], containers: [WAR_MUSEUM] }), trees, art, new Set(['Q2457600']));
    expect(reasonOf(v)).toBe('inside National Museum of the History of Ukraine in World War II: a work of a museum, not public art');
  });

  it('still refuses a colossal statue its own statements put in a room of that museum', () => {
    const room = inside('Q2', 'Hall of Glory', ['Q180516'], 'National Museum of the History of Ukraine in World War II');
    const museum = inside('Q2457600', 'National Museum of the History of Ukraine in World War II', [MILITARY_MUSEUM], undefined, 'Q2');
    const v = publicArtVerdict(facts({ qid: 'Q1', classes: [COLOSSAL_STATUE], containers: [room, museum] }), trees, art, nothingOffered);
    expect(reasonOf(v)).toBe('inside Hall of Glory (National Museum of the History of Ukraine in World War II): a work indoors, not public art');
  });

  it('refuses as before when the run states no offered places', () => {
    const v = publicArtVerdict(facts({ qid: 'Q142917', classes: [COLOSSAL_STATUE], containers: [WAR_MUSEUM] }), trees, art);
    expect(v.pass).toBe(false);
  });
});

describe('publicArtVerdict — a public clock with a show (#2136)', () => {
  const ASTRONOMICAL_CLOCK = 'Q5275';
  const BELL_TOWER = 'Q200334';
  const TOWN_HALL = 'Q543654';
  const OLD_TOWN_HALL = inside('Q2332231', 'Old Town Hall', [TOWN_HALL, MUSEUM]);
  const STRASBOURG_CATHEDRAL = inside('Q745460', 'Cathedral of Our Lady of Strasbourg', [CATHOLIC_CATHEDRAL]);
  const ATHENS_MUSEUM = inside('Q637187', 'National Archaeological Museum of Athens', [MUSEUM]);
  const nothingOffered = new Set<string>();

  it('admits the Prague Astronomical Clock, filed as a bell tower, on a town hall Wikidata also types a museum', () => {
    const v = publicArtVerdict(facts({
      qid: 'Q729370',
      classes: [ASTRONOMICAL_CLOCK, BELL_TOWER],
      containers: [inside('Q421678', 'Old Town Square', [SQUARE]), OLD_TOWN_HALL],
    }), trees, art, nothingOffered);
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('leaves the Strasbourg astronomical clock to the cathedral it stands in, which Places of worship offers', () => {
    const v = publicArtVerdict(facts({ qid: 'Q2716513', classes: [ASTRONOMICAL_CLOCK], containers: [STRASBOURG_CATHEDRAL] }), trees, art, new Set(['Q745460']));
    expect(reasonOf(v)).toBe('inside Cathedral of Our Lady of Strasbourg: a work of a place of worship, not public art');
  });

  it('leaves the Antikythera mechanism to the museum that offers it', () => {
    const v = publicArtVerdict(facts({ qid: 'Q182324', classes: [ASTRONOMICAL_CLOCK], containers: [ATHENS_MUSEUM] }), trees, art, new Set(['Q637187']));
    expect(reasonOf(v)).toBe('inside National Archaeological Museum of Athens: a work of a museum, not public art');
  });

  it('is no monument by its clock alone', () => {
    const v = publicArtVerdict(facts({ qid: 'Q729370', classes: [ASTRONOMICAL_CLOCK, BELL_TOWER] }), trees, monuments, nothingOffered);
    expect(reasonOf(v)).toBe('no monument or memorial class');
  });
});

describe('publicArtVerdict — a group of casts is judged at each cast (#2036)', () => {
  // The Thinker as Wikidata places the group: in Musée Rodin, among others.
  const RODIN = inside('Q650519', 'Musée Rodin', [MUSEUM]);
  const KYOTO = inside('Q147286', 'Kyoto National Museum', [MUSEUM]);
  const BUENOS_AIRES = inside('Q1486', 'Buenos Aires', ['Q515']);
  const thinker = (casts: ContainerFact[][]) => facts({
    qid: 'Q18003128', classes: ['Q28890616', SCULPTURE], containers: [RODIN],
    casts: casts.map((containers) => ({ containers })),
  });

  it("admits the group when one cast stands outdoors, whatever the group's own place says, showing only that cast", () => {
    expect(publicArtVerdict(thinker([[RODIN], [BUENOS_AIRES]]), trees, art)).toEqual({
      pass: true, type: expect.any(String), artwork: true, openCasts: [1],
      // The cast in the museum is the museum's, and so is the group its statements place there.
      handOver: { reason: 'inside Musée Rodin: a work of a museum, not public art', heldIn: ['Q650519'] },
    });
  });

  it("judges each cast by its own classes: one cast's colossal statue keeps no other on a museum's grounds", () => {
    // Museums no kind offers, so a colossal statue on their grounds stays public art (#1444).
    const WAR_MUSEUM = inside('Q2457600', 'National Museum of the History of Ukraine in World War II', [MILITARY_MUSEUM]);
    const SANSEVERO = inside('Q897839', 'Cappella Sansevero', [MUSEUM]);
    const group = facts({
      qid: 'Q1', classes: ['Q28890616', SCULPTURE, COLOSSAL_STATUE], containers: [],
      casts: [{ containers: [SANSEVERO], classes: [SCULPTURE] }, { containers: [WAR_MUSEUM], classes: [COLOSSAL_STATUE] }],
    });
    expect(publicArtVerdict(group, trees, art, new Set())).toEqual({
      pass: true, type: expect.any(String), artwork: true, openCasts: [1],
      handOver: { reason: 'inside Cappella Sansevero: a work of a museum, not public art', heldIn: ['Q897839'] },
    });
  });

  it('admits the group when a cast stands nowhere its item names: it stands where its point is', () => {
    expect(publicArtVerdict(thinker([[KYOTO], []]), trees, art)).toMatchObject({
      pass: true, openCasts: [1], handOver: { heldIn: ['Q147286', 'Q650519'] },
    });
  });

  it('hands nothing over when every cast stands outdoors', () => {
    expect(publicArtVerdict(thinker([[BUENOS_AIRES]]), trees, art)).not.toHaveProperty('handOver');
  });

  it("refuses the group when its one cast is held, as the cast would be, and hands it to the group's own museum too", () => {
    const v = publicArtVerdict(thinker([[KYOTO]]), trees, art);
    expect(v).toEqual({
      pass: false, reason: 'inside Kyoto National Museum: a work of a museum, not public art', heldIn: ['Q147286', 'Q650519'],
    });
  });

  it('refuses the group when every cast is held, naming each holder', () => {
    const v = publicArtVerdict(thinker([[RODIN], [KYOTO]]), trees, art);
    expect(v).toEqual({
      pass: false,
      reason: 'every cast is held — inside Musée Rodin: a work of a museum, not public art; '
        + 'inside Kyoto National Museum: a work of a museum, not public art',
      heldIn: ['Q650519', 'Q147286'],
    });
  });

  it('judges a group with no cast item at its own containers, as any work', () => {
    expect(reasonOf(publicArtVerdict(thinker([]), trees, art))).toBe('inside Musée Rodin: a work of a museum, not public art');
  });

  it('names no open casts for a work that is no group of casts', () => {
    expect(publicArtVerdict(facts({ classes: [SCULPTURE] }), trees, art)).not.toHaveProperty('openCasts');
  });
});

describe('publicArtVerdict — what it admits', () => {
  it('admits a bare monument to Monuments & memorials as a monument, and not to Public art', () => {
    // Freedom Monument, Riga: monument.
    expect(publicArtVerdict(facts({ classes: [MONUMENT] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    expect(reasonOf(publicArtVerdict(facts({ classes: [MONUMENT] }), trees, art))).toBe('no public-art class');
  });

  it('admits a fountain with sculpture to Public art as a fountain', () => {
    // Trevi Fountain: sculpture, fountain; located on Piazza di Trevi.
    const trevi = facts({
      classes: [SCULPTURE, FOUNTAIN],
      containers: [inside('Q2075166', 'Piazza di Trevi', ['Q174782'])],
    });
    expect(publicArtVerdict(trevi, trees, art)).toMatchObject({ pass: true, type: 'fountain' });
    expect(reasonOf(publicArtVerdict(trevi, trees, monuments))).toBe('no monument or memorial class');
  });

  it('admits a mural to Public art as street art', () => {
    // The Fraternal Kiss on the East Side Gallery: mural.
    expect(publicArtVerdict(facts({ classes: [MURAL] }), trees, art))
      .toMatchObject({ pass: true, type: 'street-art' });
  });

  it('files a monument under its form before its purpose', () => {
    // The Arc de Triomphe: triumphal arch. The Victory Column in Berlin:
    // victory column. The Washington Monument: obelisk, National Memorial —
    // and it commemorates George Washington. India Gate: triumphal arch and a
    // war memorial.
    const typeOf = (over: Partial<PublicArtFacts>) => publicArtVerdict(facts(over), trees, monuments);
    expect(typeOf({ classes: [TRIUMPHAL_ARCH] })).toMatchObject({ pass: true, type: 'arch' });
    expect(typeOf({ classes: [VICTORY_COLUMN] })).toMatchObject({ pass: true, type: 'column' });
    expect(typeOf({ classes: [OBELISK, US_NATIONAL_MEMORIAL], commemorates: ['Q23'] }))
      .toMatchObject({ pass: true, type: 'obelisk' });
    expect(typeOf({ classes: [TRIUMPHAL_ARCH, WAR_MEMORIAL] })).toMatchObject({ pass: true, type: 'arch' });
  });

  it('admits to Monuments & memorials what Wikidata says commemorates someone, and not a bare designation', () => {
    // The Jefferson Memorial is typed nothing but a National Memorial of the
    // United States, and commemorates Thomas Jefferson; Federal Hall is typed
    // the same and commemorates nobody — a building with a museum.
    expect(publicArtVerdict(facts({ classes: [US_NATIONAL_MEMORIAL], commemorates: ['Q11812'] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    expect(reasonOf(publicArtVerdict(facts({ classes: [US_NATIONAL_MEMORIAL] }), trees, monuments)))
      .toBe('no monument or memorial class');
  });

  it('admits an equestrian statue to both kinds', () => {
    // Genghis Khan Equestrian Statue: colossal statue, equestrian statue — a
    // monument to its rider by tradition, and a sculpture.
    const statue = facts({ classes: [COLOSSAL_STATUE, EQUESTRIAN_STATUE] });
    expect(publicArtVerdict(statue, trees, monuments)).toMatchObject({ pass: true, type: 'monument' });
    expect(publicArtVerdict(statue, trees, art)).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('lets a memorial lift a bare building\'s veto for Monuments & memorials', () => {
    // The Neue Wache: guardhouse, memorial. The Hiroshima Peace Memorial:
    // A-bombed building, memorial.
    for (const classes of [['Q2914427', MEMORIAL], ['Q95652804', MEMORIAL]]) {
      expect(publicArtVerdict(facts({ classes }), trees, monuments))
        .toMatchObject({ pass: true, type: 'memorial', artwork: true });
    }
  });

  it('lets a sculpture class lift the veto a tower carries, and says an artwork class answered', () => {
    // Hermannsdenkmal: sculpture, monument, tower, colossal statue. Whether an
    // artwork class answered is stored with the row, so the catalogue check
    // can ask it of the rule's own answer rather than approximate the closure.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, MONUMENT, 'Q12518', COLOSSAL_STATUE] }), trees, art);
    expect(v).toMatchObject({ pass: true, type: 'sculpture', artwork: true });
    expect(publicArtVerdict(facts({ classes: [MONUMENT] }), trees, monuments)).toMatchObject({ pass: true, artwork: false });
  });

  it('names the nearer container, whichever kind it is', () => {
    // A chapel that stands inside a museum complex: the work is the chapel's
    // first. Nearest-first across both kinds, not every museum before any
    // place of worship.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q1', 'A chapel', [BASILICA]), inside('Q2', 'A museum complex', [MUSEUM])],
    }), trees, art);
    expect(reasonOf(v)).toBe('inside A chapel: a work of a place of worship, not public art');
    const w = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q2', 'A museum', [MUSEUM]), inside('Q1', 'A cathedral', [CATHOLIC_CATHEDRAL])],
    }), trees, art);
    expect(reasonOf(w)).toBe('inside A museum: a work of a museum, not public art');
  });

  it('lets an obelisk lift the veto a museum carries', () => {
    // National Monument of Indonesia: national monument, memorial, museum, obelisk.
    const v = publicArtVerdict(facts({ classes: ['Q893745', MEMORIAL, MUSEUM, OBELISK] }), trees, monuments);
    expect(v).toMatchObject({ pass: true, type: 'obelisk' });
  });

  it('reads a commemorative form from the genre as well as the class', () => {
    // The Bronze Horseman: monumental sculpture, filed as an equestrian
    // statue. Gattamelata in Padua: a sculpture filed as an equestrian
    // statue; without the genre it says nothing of a monument.
    const horseman = facts({ classes: [MONUMENTAL_SCULPTURE], genres: [EQUESTRIAN_STATUE, PUBLIC_ART_GENRE] });
    expect(publicArtVerdict(horseman, trees, monuments)).toMatchObject({ pass: true, type: 'monument' });
    expect(publicArtVerdict(facts({ classes: [SCULPTURE], genres: [EQUESTRIAN_STATUE] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    expect(reasonOf(publicArtVerdict(facts({ classes: [SCULPTURE] }), trees, monuments)))
      .toBe('no monument or memorial class');
  });

  it('admits a monumental sculpture to Monuments & memorials, filed under that genre or typed it', () => {
    // The Statue of Liberty: statue, colossal statue and observation tower,
    // filed as allegorical and monumental sculpture. The statue answers the
    // tower's veto.
    const liberty = facts({
      classes: ['Q43113623', 'Q1440300', STATUE, COLOSSAL_STATUE],
      genres: ['Q4731380', MONUMENTAL_SCULPTURE, PUBLIC_ART_GENRE, COLOSSAL_STATUE],
    });
    expect(publicArtVerdict(liberty, trees, monuments)).toMatchObject({ pass: true, type: 'monument', artwork: true });
    expect(publicArtVerdict(liberty, trees, art)).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a statue raised to a person or a nation to Monuments & memorials, and not a devotional image', () => {
    // The Statue of Unity depicts Sardar Vallabhbhai Patel; Mother Ukraine
    // depicts Ukraine. The Tian Tan Buddha depicts the Buddha, whom Buddhism
    // worships; the Rondanini Pietà depicts Mary, a biblical figure. Neither
    // is a monument, and all four are public art.
    const person = { classes: ['Q5'], worshipped: false };
    const unity = facts({ classes: [STATUE, COLOSSAL_STATUE], subjects: [person] });
    expect(publicArtVerdict(unity, trees, monuments)).toMatchObject({ pass: true, type: 'monument' });
    expect(publicArtVerdict(unity, trees, art)).toMatchObject({ pass: true, type: 'sculpture' });
    expect(publicArtVerdict(facts({ classes: [COLOSSAL_STATUE], subjects: [{ classes: ['Q6256', 'Q3624078'], worshipped: false }] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    for (const subject of [{ classes: ['Q5'], worshipped: true }, { classes: ['Q20643955', 'Q5'], worshipped: false }]) {
      expect(reasonOf(publicArtVerdict(facts({ classes: [STATUE], subjects: [subject] }), trees, monuments)))
        .toBe('no monument or memorial class');
    }
    // A person depicted by something no sculptural class names says nothing:
    // a mural of Brezhnev and Honecker is not a monument to them.
    expect(reasonOf(publicArtVerdict(facts({ classes: [MURAL], subjects: [person] }), trees, monuments)))
      .toBe('no monument or memorial class');
  });

  it('admits the memorial classes no class question used to name (#1832)', () => {
    // The Monument to the Great Fire of London: memorial column. The Skull
    // Tower in Niš: skull tower. The Srebrenica Genocide Memorial: memorial
    // cemetery, whose cemetery a memorial lifts. The Kigali Genocide Memorial:
    // museum and Memorial of the Genocide against the Tutsi in Rwanda, a
    // memorial with a museum in it.
    expect(publicArtVerdict(facts({ classes: ['Q51845395'] }), trees, monuments)).toMatchObject({ pass: true, type: 'column' });
    expect(publicArtVerdict(facts({ classes: ['Q16052426'] }), trees, monuments)).toMatchObject({ pass: true, type: 'memorial' });
    expect(publicArtVerdict(facts({ classes: ['Q2532223', 'Q39614'] }), trees, monuments)).toMatchObject({ pass: true, type: 'memorial' });
    expect(publicArtVerdict(facts({ classes: [MUSEUM, 'Q130753722'] }), trees, monuments)).toMatchObject({ pass: true, type: 'memorial' });
    expect(reasonOf(publicArtVerdict(facts({ classes: ['Q12327290'] }), trees, art))).toBe('no public-art class');
  });

  it('lets a P547 statement lift the museum veto for Monuments & memorials', () => {
    // The USS Arizona Memorial: military museum, National Memorial of the
    // United States, and commemorates the ship. Commemorating nobody, the same
    // classes are a museum.
    expect(publicArtVerdict(facts({ classes: [MILITARY_MUSEUM, US_NATIONAL_MEMORIAL, MONUMENT], commemorates: ['Q506022'] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    expect(reasonOf(publicArtVerdict(facts({ classes: [MILITARY_MUSEUM, US_NATIONAL_MEMORIAL, MONUMENT] }), trees, monuments)))
      .toBe('not a memorial, and typed: a museum');
  });

  it('lets a work filed under public art answer the museum and cemetery vetoes for Monuments & memorials', () => {
    // The Soviet War Memorial in the Tiergarten: cemetery, military museum,
    // monument. The Monument to the Conquerors of Space: historic site,
    // monument, museum. Both are filed under public art; the Bilbao Fine Arts
    // Museum (art museum, monument) is not.
    const tiergarten = { classes: ['Q39614', MILITARY_MUSEUM, MONUMENT] };
    expect(publicArtVerdict(facts({ ...tiergarten, genres: [PUBLIC_ART_GENRE] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument', artwork: true });
    expect(reasonOf(publicArtVerdict(facts(tiergarten), trees, monuments)))
      .toBe('not a memorial, and typed: a museum; cemetery');
    expect(publicArtVerdict(facts({ classes: ['Q1081138', MONUMENT, MUSEUM], genres: [PUBLIC_ART_GENRE] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
    expect(reasonOf(publicArtVerdict(facts({ classes: [ART_MUSEUM, MONUMENT] }), trees, monuments)))
      .toBe('not a memorial, and typed: a museum');
  });

  it('lets a commemorative form lift the burial kill for Monuments & memorials alone', () => {
    // The Monumento a la Revolución: mausoleum, triumphal arch. The Mausoleum
    // of Mao Zedong (mausoleum, memorial) has no form, and stays refused.
    const revolucion = facts({ classes: ['Q162875', TRIUMPHAL_ARCH] });
    expect(publicArtVerdict(revolucion, trees, monuments)).toMatchObject({ pass: true, type: 'arch' });
    expect(reasonOf(publicArtVerdict(revolucion, trees, art))).toBe('not public art: mausoleum');
    expect(reasonOf(publicArtVerdict(facts({ classes: ['Q162875', MEMORIAL] }), trees, monuments)))
      .toBe('not a monument or memorial: mausoleum');
  });

  it('lets a monumental sculpture lift the veto a war cemetery carries', () => {
    // Soviet War Memorial, Treptower Park: memorial, war cemetery, monumental
    // sculpture, Soviet war cemeteries in Germany.
    const memorial = facts({ classes: [MEMORIAL, 'Q1241568', MONUMENTAL_SCULPTURE, 'Q2305029'] });
    expect(publicArtVerdict(memorial, trees, art)).toMatchObject({ pass: true, type: 'sculpture' });
    expect(publicArtVerdict(memorial, trees, monuments)).toMatchObject({ pass: true, type: 'memorial' });
  });

  it('admits a war memorial that is nothing else', () => {
    // Vietnam Veterans Memorial: National Memorial of the US, war memorial,
    // Passport to Your National Parks cancellation location.
    const v = publicArtVerdict(facts({ classes: [US_NATIONAL_MEMORIAL, WAR_MEMORIAL, 'Q35989030'] }), trees, monuments);
    expect(v).toMatchObject({ pass: true, type: 'memorial' });
  });

  it('admits a colossal statue whatever else it is called, a pilgrimage site included', () => {
    // Christ the Redeemer: colossal statue of Jesus, pilgrimage site, colossal
    // statue, statue, monument. The first dry run refused it as a place of
    // worship: Wikidata's tree under "structure of worship" reaches
    // "pilgrimage site", which is what pilgrims make of a statue, not a
    // building — so that designation is taken out of the tree by name.
    const v = publicArtVerdict(
      facts({ classes: ['Q29168169', PILGRIMAGE_SITE, COLOSSAL_STATUE, STATUE, MONUMENT] }), trees, art,
    );
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a monument that is only a pilgrimage site besides', () => {
    expect(publicArtVerdict(facts({ classes: [PILGRIMAGE_SITE, MONUMENT] }), trees, monuments).pass).toBe(true);
  });

  it('admits a monument Wikidata also types as the square it stands on when it depicts what stands there', () => {
    // Mansu Hill Grand Monument: monument, square; depicts Kim Jong-il and
    // Kim Il-sung, the two statues it is visited for.
    expect(publicArtVerdict(facts({ classes: [MONUMENT, SQUARE], depicts: ['Q10665', 'Q41117'] }), trees, monuments))
      .toMatchObject({ pass: true, type: 'monument' });
  });

  it('admits a sculpture a museum owns but a park holds', () => {
    // Sibelius Monument: located in Sibelius Park; in the collection of HAM
    // Helsinki Art Museum, which owns the city's outdoor sculpture. A
    // collection is ownership, not a place: where the work stands is what
    // decides, and whose it is is read only when nothing says where it stands.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE, MONUMENT, MEMORIAL],
      containers: [inside('Q3481120', 'Sibelius Park', ['Q22698'])],
      collections: [owned('Q5710459', 'HAM Helsinki Art Museum', [ART_MUSEUM])],
    }), trees, art);
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a work whose only collection is not a museum or a church', () => {
    // Monument to the laboratory mouse, Novosibirsk: sculpture; no location,
    // no part-of; in the collection of Akademgorodok, which is a campus. The
    // fallback asks only whether the owner is a museum or a place of worship.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      collections: [owned('Q83627', 'Akademgorodok', ['Q209465'])],
    }), trees, art);
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a memorial with a museum in it as a monument', () => {
    // Tsitsernakaberd: museum, memorial, Armenian Genocide memorial — the
    // eternal flame, the stele, the twelve slabs, with the Genocide Museum
    // under them. The National September 11 Memorial & Museum: museum,
    // memorial; part of the World Trade Center, a building complex. The
    // Victoria Memorial in Kolkata: museum, memorial. The first live run
    // refused all three as `not an artwork, and typed: a museum` (#803): a
    // commemorative class beside a museum class is a memorial complex, and a
    // traveller stands in front of it whether or not there is a museum below.
    const complexes: [string, Partial<PublicArtFacts>][] = [
      ['Tsitsernakaberd', { classes: [MUSEUM, MEMORIAL, 'Q135645306'] }],
      ['9/11 Memorial', {
        classes: [MUSEUM, MEMORIAL],
        containers: [partOf('Q20861677', 'World Trade Center', ['Q1497364'])],
      }],
      ['Victoria Memorial', { classes: [MUSEUM, MEMORIAL] }],
    ];
    for (const [label, over] of complexes) {
      const v = publicArtVerdict(facts(over), trees, monuments);
      expect(v, label).toMatchObject({ pass: true, type: 'memorial', artwork: false });
    }
  });

  it('reads a museum a monument is part of as its owner, not its place', () => {
    // The Pakistan Monument: monument; located in Shakarparian, a park; part
    // of the Pakistan Monument Museum, which Wikidata types a museum and
    // which stands in the monument's base — the museum is part of the
    // monument too. The first live run refused it as a work inside the
    // museum (#803). A museum is an institution; a monument part of one
    // belongs to it and stands where its location says, and what the walk
    // reached above the museum — its own location, the park again, or the
    // monument itself — is not a place the monument stands in either.
    const v = publicArtVerdict(facts({
      classes: [MONUMENT],
      containers: [
        inside('Q7462557', 'Shakarparian', ['Q22698']),
        partOf('Q86452047', 'Pakistan Monument Museum', [MUSEUM]),
        inside('Q3695640', 'Pakistan Monument', [MONUMENT], undefined, 'Q86452047'),
      ],
    }), trees, monuments);
    expect(v).toMatchObject({ pass: true, type: 'monument' });
  });

  it('does not read what stands above a museum the entity is part of as a place', () => {
    // A monument part of a museum that is itself inside a museum complex: the
    // complex is reached through the institution, and is the institution's
    // building, not the monument's.
    const v = publicArtVerdict(facts({
      classes: [MONUMENT],
      containers: [
        inside('Q1', 'A square', ['Q174782']),
        partOf('Q2', 'A site museum', [MUSEUM]),
        inside('Q3', 'A museum complex', [MUSEUM], undefined, 'Q2'),
      ],
    }), trees, monuments);
    expect(v).toMatchObject({ pass: true, type: 'monument' });
    // Reached from the square instead, the complex is where the monument stands.
    const w = publicArtVerdict(facts({
      classes: [MONUMENT],
      containers: [
        inside('Q1', 'A square', ['Q174782']),
        inside('Q3', 'A museum complex', [MUSEUM], undefined, 'Q1'),
      ],
    }), trees, monuments);
    expect(reasonOf(w)).toBe('inside A museum complex: a work of a museum, not a monument or memorial');
  });

  it('reads a museum the work is part of as where it stands when it is located inside it', () => {
    // A work part of a museum and located in the museum's courtyard, which is
    // part of the museum: the courtyard is a place, and it leads to the
    // museum, so the museum is where the work stands — the institution
    // reading holds only when no place leads to it.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [
        inside('Q4', 'A courtyard', ['Q1178342']),
        { qid: 'Q2', label: 'A museum', classes: [MUSEUM], relation: 'part of', via: ['Q4'] },
      ],
    }), trees, art);
    expect(reasonOf(v)).toBe('inside A museum: a work of a museum, not public art');
  });

  it('keeps a place some route other than the institution reaches, whichever came first', () => {
    // A work part of a site museum and part of a courtyard, both part of the
    // same museum complex: the complex is reached through the museum and
    // through the courtyard. Only what nothing but an institution reaches
    // goes with it, so the complex is a place — in either order the source
    // listed the two routes, and however the walk recorded them.
    for (const via of [['Q2', 'Q4'], ['Q4', 'Q2']]) {
      const v = publicArtVerdict(facts({
        classes: [MONUMENT],
        containers: [
          partOf('Q2', 'A site museum', [MUSEUM]),
          partOf('Q4', 'A courtyard', ['Q1178342']),
          inside('Q3', 'A museum complex', [MUSEUM], undefined, ...via),
        ],
      }), trees, monuments);
      expect(reasonOf(v), via.join(',')).toBe('inside A museum complex: a work of a museum, not a monument or memorial');
    }
    // A route listed after the container it leads to — a later hop arriving
    // at something an earlier one reached — is read all the same.
    const late = publicArtVerdict(facts({
      classes: [MONUMENT],
      containers: [
        partOf('Q2', 'A site museum', [MUSEUM]),
        inside('Q3', 'A museum complex', [MUSEUM], undefined, 'Q2', 'Q5'),
        inside('Q1', 'A square', ['Q174782']),
        inside('Q5', 'A block', ['Q123705'], undefined, 'Q1'),
      ],
    }), trees, monuments);
    expect(reasonOf(late)).toBe('inside A museum complex: a work of a museum, not a monument or memorial');
  });

  it('treats a coordinate of zero as a position, not an absence', () => {
    expect(publicArtVerdict(facts({ lat: 0, lon: 0 }), trees, art).pass).toBe(true);
  });
});

describe('buildTrees', () => {
  it('keeps a floor of places of worship under the fetched tree', () => {
    // The tree is read from Wikidata each run; the pinned floor is what the
    // catalogue check can see, and what holds if the tree comes back short.
    const bare = buildTrees({ sculptural: [], fountain: [], commemorative: [], museum: [], worship: [], lost: [] });
    expect(bare.worship.has(CATHOLIC_CATHEDRAL)).toBe(true);
    expect(bare.worship.has('Q32815')).toBe(true); // mosque
  });

  it('takes the designations that are not buildings out of the fetched worship tree', () => {
    expect(trees.worship.has(PILGRIMAGE_SITE)).toBe(false);
    expect(trees.worship.has(SHINTO_SHRINE)).toBe(true);
    // Wikidata's tree reaches the Holy Trinity column, which stands in a square.
    const withColumn = buildTrees({
      sculptural: [], fountain: [], commemorative: [], museum: [], worship: [WORSHIP, HOLY_TRINITY_COLUMN], lost: [],
    });
    expect(withColumn.worship.has(HOLY_TRINITY_COLUMN)).toBe(false);
    expect(publicArtVerdict(facts({ classes: ['Q26789694', HOLY_TRINITY_COLUMN] }), withColumn, monuments))
      .toMatchObject({ pass: true, type: 'column' });
  });

  it('counts the pinned sculptural classes as sculptural, for Public art', () => {
    expect(trees.sculptural.has(MURAL)).toBe(true);
    expect(trees.sculptural.has('Q2293362')).toBe(true); // group of sculptures
    expect(trees.admitting.has(MURAL)).toBe(true);
  });

  it('counts the pinned structures as artworks but not the heritage-sense classes', () => {
    expect(trees.artwork.has(OBELISK)).toBe(true);
    expect(trees.artwork.has(MONUMENT)).toBe(false);
    expect(trees.artwork.has(MEMORIAL)).toBe(false);
    expect(trees.artwork.has(WAR_MEMORIAL)).toBe(false);
  });

  it('counts the memorial classes and the commemorative closures as commemorative, not a designation', () => {
    // What lifts the museum's veto: a memorial, a war memorial — never
    // `monument`, which is what Spain's register calls a museum.
    expect(trees.commemorative.has(MEMORIAL)).toBe(true);
    expect(trees.commemorative.has(WAR_MEMORIAL)).toBe(true);
    expect(trees.commemorative.has('Q20011797')).toBe(true); // Holocaust memorial
    expect(trees.commemorative.has(MONUMENT)).toBe(false);
    expect(trees.commemorative.has('Q893745')).toBe(false); // national monument
    expect(trees.commemorative.has(OBELISK)).toBe(false);
  });

  it('asks the pool for every admitting class, the commemorative closures included', () => {
    for (const q of [SCULPTURE, FOUNTAIN, WAR_MEMORIAL, MONUMENT, MEMORIAL, OBELISK]) {
      expect(trees.admitting.has(q)).toBe(true);
    }
    expect(trees.admitting.has(MUSEUM)).toBe(false);
  });
});

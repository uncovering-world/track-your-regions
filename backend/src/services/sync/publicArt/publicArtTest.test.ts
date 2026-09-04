/**
 * What Public Art & Monuments admits, asked on the rows the first run got wrong.
 *
 * Every case below is a real entity with the classes Wikidata gave it on
 * 2026-09-04, so a rule that passes here has been tried on the catalogue's own
 * mistakes rather than on shapes invented for the test.
 */

import { describe, it, expect } from 'vitest';
import { publicArtVerdict, type PublicArtFacts, type ContainerFact } from './publicArtTest.js';
import { buildTrees } from './classes.js';

const SCULPTURE = 'Q860861';
const STATUE = 'Q179700';
const COLOSSAL_STATUE = 'Q1779653';
const MONUMENTAL_SCULPTURE = 'Q3476533';
const FOUNTAIN = 'Q483453';
const WAR_MEMORIAL = 'Q575759';
const MONUMENT = 'Q4989906';
const MEMORIAL = 'Q5003624';
const OBELISK = 'Q170980';
const MUSEUM = 'Q33506';
const ART_MUSEUM = 'Q207694';
const MILITARY_MUSEUM = 'Q2772772';
const WORSHIP = 'Q1370598';
const CATHOLIC_CATHEDRAL = 'Q56242215';
const SHINTO_SHRINE = 'Q845945';
const BASILICA = 'Q120560';

const PILGRIMAGE_SITE = 'Q15135589';

const trees = buildTrees({
  sculptural: [SCULPTURE, STATUE, COLOSSAL_STATUE, MONUMENTAL_SCULPTURE, 'Q29168169'],
  fountain: [FOUNTAIN, 'Q1371047'],
  commemorative: [WAR_MEMORIAL, 'Q321053', 'Q1541043'],
  museum: [MUSEUM, ART_MUSEUM, MILITARY_MUSEUM, 'Q17431399'],
  // The tree Wikidata walks under "structure of worship": the buildings, and
  // a pilgrimage site, which is a designation a statue can carry.
  worship: [WORSHIP, CATHOLIC_CATHEDRAL, SHINTO_SHRINE, BASILICA, 'Q1534477', 'Q2031836', PILGRIMAGE_SITE],
});

const facts = (over: Partial<PublicArtFacts>): PublicArtFacts => ({
  qid: 'Q1', classes: [SCULPTURE], containers: [], onEarth: true, lat: 41.9, lon: 12.5, ...over,
});

const inside = (qid: string, label: string, classes: string[], building?: string): ContainerFact =>
  ({ qid, label, classes, building });

function reasonOf(v: ReturnType<typeof publicArtVerdict>): string {
  expect(v.pass).toBe(false);
  return (v as { reason: string }).reason;
}

describe('publicArtVerdict — what it refuses', () => {
  it('refuses a cathedral Wikidata also types a monument', () => {
    // Segovia Cathedral: `Catholic cathedral, monument` — eleven Spanish
    // cathedrals arrived this way, "monument" being the heritage designation.
    const v = publicArtVerdict(facts({ classes: [CATHOLIC_CATHEDRAL, MONUMENT] }), trees);
    expect(reasonOf(v)).toContain('place of worship');
  });

  it('refuses a shrine typed a war memorial', () => {
    // Yasukuni Shrine: Shinto shrine, chokusaisha, war memorial, gokoku shrine.
    const v = publicArtVerdict(facts({ classes: [SHINTO_SHRINE, 'Q175288', WAR_MEMORIAL, 'Q1534477'] }), trees);
    expect(reasonOf(v)).toContain('place of worship');
  });

  it('refuses a cemetery whose only commemorative class is war memorial', () => {
    // Arlington: war cemetery, US national cemetery, cemetery, war memorial,
    // Direct Reporting Unit. A war memorial is commemorative, not an artwork,
    // so it does not lift the veto a cemetery carries.
    const v = publicArtVerdict(
      facts({ classes: ['Q1241568', 'Q1516659', 'Q39614', WAR_MEMORIAL, 'Q127701543'] }), trees,
    );
    expect(reasonOf(v)).toContain('cemetery');
  });

  it('refuses a concentration camp typed a memorial and a museum', () => {
    // Stutthof: Nazi concentration camp, military museum, concentration camp,
    // memorial, crime scene.
    const v = publicArtVerdict(
      facts({ classes: ['Q328468', MILITARY_MUSEUM, 'Q152081', MEMORIAL, 'Q1360677'] }), trees,
    );
    expect(reasonOf(v)).toContain('camp');
  });

  it('refuses a stadium', () => {
    // Panathenaic Stadium: Ancient Greek stadium, multi-purpose stadium,
    // monument, Olympic stadium, pitch, all-seater stadium.
    const v = publicArtVerdict(
      facts({ classes: ['Q64722124', 'Q1049757', MONUMENT, 'Q589481', 'Q2310214', 'Q4728370'] }), trees,
    );
    expect(reasonOf(v)).toContain('stadium');
  });

  it('refuses a museum typed a monument', () => {
    // Reina Sofía: art museum, national museum, monument, former hospital,
    // arts center — also a museum row already.
    const v = publicArtVerdict(
      facts({ classes: [ART_MUSEUM, 'Q17431399', MONUMENT, 'Q64578911', 'Q2190251'] }), trees,
    );
    expect(reasonOf(v)).toContain('museum');
  });

  it('refuses a palace that is also a monument', () => {
    // Aljafería: palace, castle, parliament building, monument, fortified palace.
    const v = publicArtVerdict(
      facts({ classes: ['Q16560', 'Q23413', 'Q7138926', MONUMENT, 'Q98795663'] }), trees,
    );
    expect(reasonOf(v)).toContain('palace');
  });

  it('refuses a mausoleum, in words the review page passes through as they are', () => {
    // Mausoleum of Mao Zedong: mausoleum, memorial. Not the museum rule's
    // `kill-list:` prefix: the review page's help panel explains that one as
    // curatorial departments and museum networks, which is nobody's reason
    // for turning down a mausoleum. This form reaches the card untranslated.
    const v = publicArtVerdict(facts({ classes: ['Q162875', MEMORIAL] }), trees);
    expect(reasonOf(v)).toBe('not public art: mausoleum');
  });

  it('refuses an archaeological site, however famous', () => {
    // Stonehenge: cromlech, monument, archaeological site, history museum, henge.
    // Named for what it is, not for the museum class Wikidata also hangs on it.
    const v = publicArtVerdict(
      facts({ classes: ['Q935773', MONUMENT, 'Q839954', 'Q16735822', 'Q1035294'] }), trees,
    );
    expect(reasonOf(v)).toContain('archaeological site');
  });

  it('refuses a sidewalk of stars', () => {
    // Hollywood Walk of Fame: monument, hall of fame, walk of fame.
    const v = publicArtVerdict(facts({ classes: [MONUMENT, 'Q1046088', 'Q47502370'] }), trees);
    expect(reasonOf(v)).toContain('walk of fame');
  });

  it('refuses a play', () => {
    // Mystery Play of Elche: liturgical drama, party, literary work.
    const v = publicArtVerdict(facts({ classes: ['Q1253136', 'Q200538', 'Q7725634'] }), trees);
    expect(reasonOf(v)).toContain('liturgical drama');
  });

  it('refuses a French commune typed a memorial', () => {
    // Le Gua: commune of France, memorial.
    const v = publicArtVerdict(facts({ classes: ['Q484170', MEMORIAL] }), trees);
    expect(reasonOf(v)).toContain('commune');
  });

  it('refuses a neighbourhood even though it names a statue', () => {
    // Columbus Circle: traffic circle, neighborhood of Manhattan, monument,
    // rostral column, statue — the row is the circle, not the monument on it.
    const v = publicArtVerdict(
      facts({ classes: ['Q1529', 'Q61297932', MONUMENT, 'Q1112897', STATUE] }), trees,
    );
    expect(reasonOf(v)).toContain('neighborhood');
  });

  it('refuses an amusement park even though it names a sculpture', () => {
    // Madurodam: amusement park, miniature park, war memorial, sculpture.
    const v = publicArtVerdict(
      facts({ classes: ['Q194195', 'Q974968', WAR_MEMORIAL, SCULPTURE] }), trees,
    );
    expect(reasonOf(v)).toContain('amusement park');
  });

  it('refuses what the source records as destroyed', () => {
    // Georgia Guidestones: monument, destroyed building or structure.
    const v = publicArtVerdict(facts({ classes: [MONUMENT, 'Q19860854'] }), trees);
    expect(reasonOf(v)).toContain('destroyed');
  });

  it('refuses a work inside a church, naming the church', () => {
    // Michelangelo's Pietà: sculpture, cultural property; located in St. Peter's
    // Basilica. A work a traveller goes to a church to see is #753's, not this.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE, 'Q2065736'],
      containers: [inside('Q12512', "St. Peter's Basilica", [BASILICA, 'Q16970'])],
    }), trees);
    expect(reasonOf(v)).toContain("inside St. Peter's Basilica");
  });

  it('refuses a work a museum holds, naming the museum', () => {
    // The Dendera zodiac: sculpture; located in Room 325 of the Louvre — the
    // pipeline walks the room up to the museum and hands the museum in.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q19119449', 'Room 325', ['Q180516']), inside('Q19675', 'Louvre', [ART_MUSEUM])],
    }), trees);
    expect(reasonOf(v)).toContain('inside Louvre');
  });

  it('refuses a church the worship tree knows and the pinned floor does not', () => {
    // Church of St. Mary of Blachernae: holy well, Eastern Orthodox church
    // building. The second dry run admitted it — the holy well is in the
    // fountain closure and lifted the veto the tree then was. A building of
    // worship refuses outright, whatever else the entity carries.
    const v = publicArtVerdict(facts({ classes: ['Q1371047', 'Q2031836'] }), trees);
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
    }), trees);
    expect(reasonOf(v)).toBe('inside Room 325 (Louvre Palace): a work indoors, not public art');
  });

  it('names a room alone when nothing above it was fetched', () => {
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q19119449', 'Room 325', ['Q180516'])],
    }), trees);
    expect(reasonOf(v)).toBe('inside Room 325: a work indoors, not public art');
  });

  it('refuses a work that is part of an archaeological site', () => {
    // The Ishtar Gate: arch; part of Babylon. What stands in the Pergamon
    // Museum is the site's, and the site is archaeology's.
    const v = publicArtVerdict(facts({
      classes: ['Q12277'],
      containers: [inside('Q5684', 'Babylon', ['Q839954', 'Q15661340'])],
    }), trees);
    expect(reasonOf(v)).toBe('part of Babylon: archaeological site, not public art');
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
      const v = publicArtVerdict(facts({ classes: [SCULPTURE], containers: [inside('Q1', label, [...classes])] }), trees);
      expect(v.pass, label).toBe(true);
    }
  });

  it('refuses a find, which is a museum object wherever Wikidata locates it', () => {
    // The Venus of Willendorf: Venus figurine, sculpture, archaeological find;
    // located in Austria. Nothing about a figurine is somewhere to stand.
    const v = publicArtVerdict(facts({ classes: ['Q248726', SCULPTURE, 'Q10855061'] }), trees);
    expect(reasonOf(v)).toContain('Venus figurine');
  });

  it('refuses a sculpture that stands on the Moon', () => {
    // Fallen Astronaut: sculpture, monument; P625 on Q405.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, MONUMENT], onEarth: false }), trees);
    expect(reasonOf(v)).toContain('not on Earth');
  });

  it('refuses an entity with no public-art class at all', () => {
    const v = publicArtVerdict(facts({ classes: ['Q515'] }), trees); // city
    expect(reasonOf(v)).toContain('no public-art class');
  });

  it('refuses an entity with no coordinates of its own', () => {
    const v = publicArtVerdict(facts({ lat: null, lon: null }), trees);
    expect(reasonOf(v)).toContain('coordinates');
  });
});

describe('publicArtVerdict — what it admits', () => {
  it('admits a bare monument as a monument', () => {
    // Freedom Monument, Riga: monument.
    expect(publicArtVerdict(facts({ classes: [MONUMENT] }), trees))
      .toMatchObject({ pass: true, type: 'monument' });
  });

  it('admits a fountain with sculpture as a sculpture', () => {
    // Trevi Fountain: sculpture, fountain; located on Piazza di Trevi.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE, FOUNTAIN],
      containers: [inside('Q2075166', 'Piazza di Trevi', ['Q174782'])],
    }), trees);
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('lets a sculpture class lift the veto a tower carries, and says an artwork class answered', () => {
    // Hermannsdenkmal: sculpture, monument, tower, colossal statue. Whether an
    // artwork class answered is stored with the row, so the catalogue check
    // can ask it of the rule's own answer rather than approximate the closure.
    const v = publicArtVerdict(facts({ classes: [SCULPTURE, MONUMENT, 'Q12518', COLOSSAL_STATUE] }), trees);
    expect(v).toMatchObject({ pass: true, type: 'sculpture', artwork: true });
    expect(publicArtVerdict(facts({ classes: [MONUMENT] }), trees)).toMatchObject({ pass: true, artwork: false });
  });

  it('names the nearer container, whichever kind it is', () => {
    // A chapel that stands inside a museum complex: the work is the chapel's
    // first. Nearest-first across both kinds, not every museum before any
    // place of worship.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q1', 'A chapel', [BASILICA]), inside('Q2', 'A museum complex', [MUSEUM])],
    }), trees);
    expect(reasonOf(v)).toBe('inside A chapel: a work of a place of worship, not public art');
    const w = publicArtVerdict(facts({
      classes: [SCULPTURE],
      containers: [inside('Q2', 'A museum', [MUSEUM]), inside('Q1', 'A cathedral', [CATHOLIC_CATHEDRAL])],
    }), trees);
    expect(reasonOf(w)).toBe('inside A museum: a work of a museum, not public art');
  });

  it('lets an obelisk lift the veto a museum carries', () => {
    // National Monument of Indonesia: national monument, memorial, museum, obelisk.
    const v = publicArtVerdict(facts({ classes: ['Q893745', MEMORIAL, MUSEUM, OBELISK] }), trees);
    expect(v).toMatchObject({ pass: true, type: 'monument' });
  });

  it('lets a monumental sculpture lift the veto a war cemetery carries', () => {
    // Soviet War Memorial, Treptower Park: memorial, war cemetery, monumental
    // sculpture, Soviet war cemeteries in Germany.
    const v = publicArtVerdict(
      facts({ classes: [MEMORIAL, 'Q1241568', MONUMENTAL_SCULPTURE, 'Q2305029'] }), trees,
    );
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a war memorial that is nothing else', () => {
    // Vietnam Veterans Memorial: National Memorial of the US, war memorial,
    // Passport to Your National Parks cancellation location.
    const v = publicArtVerdict(facts({ classes: ['Q1967454', WAR_MEMORIAL, 'Q35989030'] }), trees);
    expect(v).toMatchObject({ pass: true, type: 'monument' });
  });

  it('admits a colossal statue whatever else it is called, a pilgrimage site included', () => {
    // Christ the Redeemer: colossal statue of Jesus, pilgrimage site, colossal
    // statue, statue, monument. The first dry run refused it as a place of
    // worship: Wikidata's tree under "structure of worship" reaches
    // "pilgrimage site", which is what pilgrims make of a statue, not a
    // building — so that designation is taken out of the tree by name.
    const v = publicArtVerdict(
      facts({ classes: ['Q29168169', PILGRIMAGE_SITE, COLOSSAL_STATUE, STATUE, MONUMENT] }), trees,
    );
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('admits a monument that is only a pilgrimage site besides', () => {
    expect(publicArtVerdict(facts({ classes: [PILGRIMAGE_SITE, MONUMENT] }), trees).pass).toBe(true);
  });

  it('admits a monument Wikidata also types as the square it stands on', () => {
    // Mansu Hill Grand Monument: monument, square. Open places and landforms
    // are not vetoes: a monument typed with its site is a monument on a site.
    expect(publicArtVerdict(facts({ classes: [MONUMENT, 'Q174782'] }), trees))
      .toMatchObject({ pass: true, type: 'monument' });
  });

  it('admits a sculpture a museum owns but a park holds', () => {
    // Sibelius Monument: located in Sibelius Park; in the collection of HAM
    // Helsinki Art Museum, which owns the city's outdoor sculpture. A
    // collection is ownership, not a place, and the pipeline no longer hands
    // it in — what reaches the rule is where the work stands.
    const v = publicArtVerdict(facts({
      classes: [SCULPTURE, MONUMENT, MEMORIAL],
      containers: [inside('Q3481120', 'Sibelius Park', ['Q22698'])],
    }), trees);
    expect(v).toMatchObject({ pass: true, type: 'sculpture' });
  });

  it('treats a coordinate of zero as a position, not an absence', () => {
    expect(publicArtVerdict(facts({ lat: 0, lon: 0 }), trees).pass).toBe(true);
  });
});

describe('buildTrees', () => {
  it('keeps a floor of places of worship under the fetched tree', () => {
    // The tree is read from Wikidata each run; the pinned floor is what the
    // catalogue check can see, and what holds if the tree comes back short.
    const bare = buildTrees({ sculptural: [], fountain: [], commemorative: [], museum: [], worship: [] });
    expect(bare.worship.has(CATHOLIC_CATHEDRAL)).toBe(true);
    expect(bare.worship.has('Q32815')).toBe(true); // mosque
  });

  it('takes the designations that are not buildings out of the fetched worship tree', () => {
    expect(trees.worship.has(PILGRIMAGE_SITE)).toBe(false);
    expect(trees.worship.has(SHINTO_SHRINE)).toBe(true);
  });

  it('counts the pinned structures as artworks but not the heritage-sense classes', () => {
    expect(trees.artwork.has(OBELISK)).toBe(true);
    expect(trees.artwork.has(MONUMENT)).toBe(false);
    expect(trees.artwork.has(MEMORIAL)).toBe(false);
    expect(trees.artwork.has(WAR_MEMORIAL)).toBe(false);
  });

  it('asks the pool for every admitting class, the commemorative closures included', () => {
    for (const q of [SCULPTURE, FOUNTAIN, WAR_MEMORIAL, MONUMENT, MEMORIAL, OBELISK]) {
      expect(trees.admitting.has(q)).toBe(true);
    }
    expect(trees.admitting.has(MUSEUM)).toBe(false);
  });
});

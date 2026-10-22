import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { fetchClassPool, fetchContainerFacts, fetchEntitiesByIds, fetchEntityFacts } from '../publicArt/queries.js';
import { subsetOnlyDoor } from './reader.js';

/**
 * Public Art's questions answered from the local subset (#1459), against
 * PostgreSQL, through the fetchers the pipeline calls with the run's subset
 * door, which fails any question that reaches SPARQL. Fixture rows on real
 * items: the Louvre (Q19675) is a museum with a point and a picture, the
 * Mona Lisa (Q12418) names it as its location and Leonardo (Q762) as its
 * maker, Room 325 (Q19119449) is in the Sully Wing (Q17309954), and the
 * Louvre Palace (Q1075988) once stood where a fixture says it no longer does.
 */

const door = subsetOnlyDoor();
const LOUVRE = 'Q19675';
const MONA_LISA = 'Q12418';
const LISA_DEL_GIOCONDO = 'Q153032';
const LEONARDO = 'Q762';
const MUSEUM = 'Q33506';
const PAINTING = 'Q3305213';
const ROOM_325 = 'Q19119449';
const SULLY_WING = 'Q17309954';
const PALACE = 'Q1075988';
const FRANCE = 'Q142';
// Louise Bourgeois's Maman (Q180887), cast in Bilbao (Q8692), Ottawa (Q1930), London (Q84)
// and Tokyo's Minato (Q190088), each cast a P625 with its host as P518, and four P17s —
// Spain (Q29), Canada (Q16), the United Kingdom (Q145), Japan (Q17) — tied to none (#1533).
const MAMAN = 'Q180887';
// The Stutthof camp (Q326193): its statement of Nazi Germany (Q7318) ends in 1945, Poland
// (Q36) stands; Nazi Germany itself carries a dissolution (P576, a claims row). Mediolanum (Q729978) is
// stated in Ancient Rome (Q1747689) alone, which is dissolved too (#757).
const STUTTHOF = 'Q326193';
const MEDIOLANUM = 'Q729978';
// The Moslavina monument (Q75822) is stated in Yugoslavia (Q36704) first and Croatia (Q224),
// neither statement ended: only Yugoslavia's own dissolution tells them apart.
const MOSLAVINA = 'Q75822';
// The Basilica of Sant'Ambrogio in Milan (Q1071570): Wikidata lists Russia (Q159) before Italy
// (Q38), both standing. Its point and Mediolanum's lie in a fixture comune of Milan, in a fixture
// Italy under a fixture Europe, ids of their own (#1564).
const SANT_AMBROGIO = 'Q1071570';
const GADM_IDS = [990001, 990002, 990003, 990004, 990005, 990006, 990007, 990008];
const MILAN_BOX = 'MULTIPOLYGON(((9.05 45.40, 9.30 45.40, 9.30 45.55, 9.05 45.55, 9.05 45.40)))';
// Australia is filed at GADM's root, its states under it; Xi'an sits in China under Asia.
const MELBOURNE_BOX = 'MULTIPOLYGON(((144.80 -37.95, 145.10 -37.95, 145.10 -37.70, 144.80 -37.70, 144.80 -37.95)))';
const XIAN_BOX = 'MULTIPOLYGON(((108.80 34.15, 109.10 34.15, 109.10 34.40, 108.80 34.40, 108.80 34.15)))';
// Fixture items, ids of their own: a place in Melbourne and one in Xi'an, each stated only in a
// state that is gone (#1564); the People's Republic of China (Q148) is a sovereign state here.
const MELBOURNE_SITE = 'Q99001';
const XIAN_SITE = 'Q99002';
const GONE_COLONY = 'Q99011';
const GONE_DYNASTY = 'Q99012';
const ENDED_1945 = { time: '+1945-05-08T00:00:00Z', precision: 11 };
const CASTS: Array<[host: string, country: string, latitude: number, longitude: number]> = [
  ['Q8692', 'Q29', 43.269189, -2.932958], ['Q1930', 'Q16', 45.429333, -75.697277],
  ['Q84', 'Q145', 51.507694, -0.099333], ['Q190088', 'Q17', 35.6610104, 139.7296602],
];

const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });
const point = (latitude: number, longitude: number) => ({
  latitude, longitude, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2',
});

const ENTITIES: Array<[string, number, Record<string, unknown>]> = [
  [LOUVRE, 180, {
    claims: {
      P31: [statement('L1', MUSEUM)],
      P625: [statement('L2', point(48.861, 2.3358))],
      P18: [statement('L3', 'Louvre Museum Wikimedia Commons.jpg'), statement('L4', 'Abc Louvre.jpg', { rank: 'deprecated' })],
      P17: [statement('L5', FRANCE)],
      P856: [statement('L6', 'https://www.louvre.fr/')],
      P571: [statement('L7', { time: '+1793-08-10T00:00:00Z' })],
    },
    sitelinks: { enwiki: 'Louvre', frwiki: 'Musée du Louvre' },
  }],
  [MONA_LISA, 150, {
    claims: {
      P31: [statement('M1', PAINTING)],
      P276: [statement('M2', LOUVRE), statement('M3', PALACE, { qualifiers: { P582: [{ time: '+1800-00-00T00:00:00Z' }] } })],
      P170: [statement('M4', LEONARDO), statement('M5', { somevalue: true })],
      // Whom it depicts, read from the entity like every other statement here.
      P180: [statement('M6', LISA_DEL_GIOCONDO)],
    },
    sitelinks: { enwiki: 'Mona Lisa' },
  }],
  [ROOM_325, 0, { claims: { P276: [statement('R1', SULLY_WING)] }, sitelinks: {} }],
  [MAMAN, 30, {
    claims: {
      P625: CASTS.map(([host, , lat, lon], i) => statement(`X${i}`, point(lat, lon), { qualifiers: { P518: [host] } })),
      P17: CASTS.map(([, country], i) => statement(`C${i}`, country)),
    },
    sitelinks: {},
  }],
  [STUTTHOF, 50, {
    claims: {
      P625: [statement('S1', point(54.3292, 19.1525))],
      P17: [statement('S2', 'Q7318', { qualifiers: { P582: [ENDED_1945] } }), statement('S3', 'Q36')],
    },
    sitelinks: {},
  }],
  [MOSLAVINA, 20, {
    claims: { P625: [statement('V1', point(45.6, 16.6))], P17: [statement('V2', 'Q36704'), statement('V3', 'Q224')] },
    sitelinks: {},
  }],
  [SANT_AMBROGIO, 40, {
    claims: { P625: [statement('A1', point(45.4623, 9.1756))], P17: [statement('A2', 'Q159'), statement('A3', 'Q38')] },
    sitelinks: {},
  }],
  [MELBOURNE_SITE, 40, {
    claims: { P625: [statement('W1', point(-37.81, 144.96))], P17: [statement('W2', GONE_COLONY)] },
    sitelinks: {},
  }],
  [XIAN_SITE, 40, {
    claims: { P625: [statement('W3', point(34.26, 108.94))], P17: [statement('W4', GONE_DYNASTY)] },
    sitelinks: {},
  }],
  [MEDIOLANUM, 40, {
    claims: { P625: [statement('M1', point(45.4642, 9.19))], P17: [statement('M2', 'Q1747689')] },
    sitelinks: {},
  }],
  ...CASTS.map(([host, country]): [string, number, Record<string, unknown>] =>
    [host, 0, { claims: { P17: [statement(`${host}-P17`, country)] }, sitelinks: {} }]),
];

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[...GADM_IDS].reverse()]);
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, parent_id, has_children, geom) VALUES
       ($1, 'Europe', NULL, true, ST_GeomFromText($4, 4326)),
       ($2, 'Italy', $1, true, ST_GeomFromText($4, 4326)),
       ($3, 'Milano (fixture)', $2, false, ST_GeomFromText($4, 4326))`,
    [...GADM_IDS.slice(0, 3), MILAN_BOX],
  );
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, parent_id, has_children, geom) VALUES
       ($1, 'Australia', NULL, true, ST_GeomFromText($6, 4326)),
       ($2, 'Victoria (fixture)', $1, false, ST_GeomFromText($6, 4326)),
       ($3, 'Asia', NULL, true, ST_GeomFromText($7, 4326)),
       ($4, 'China', $3, true, ST_GeomFromText($7, 4326)),
       ($5, 'Xi''an (fixture)', $4, false, ST_GeomFromText($7, 4326))`,
    [...GADM_IDS.slice(3), MELBOURNE_BOX, XIAN_BOX],
  );
  for (const [id, sitelinks, body] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
      [id, sitelinks, JSON.stringify({ id, labels: {}, descriptions: {}, ...body })]);
  }
  // A state's dissolution is read from the claims table (`dissolvedAmong`).
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES
       ('Q7318', 'P576', 'G1', 0, NULL, $1), ('Q1747689', 'P576', 'G2', 0, NULL, $2), ('Q36704', 'P576', 'G3', 0, NULL, $3),
       ($4, 'P576', 'G4', 0, NULL, $1), ($5, 'P576', 'G5', 0, NULL, $2), ('Q148', 'P31', 'S1', 0, 'Q3624078', NULL)`,
    [JSON.stringify(ENDED_1945), JSON.stringify({ time: '-0026-01-16T00:00:00Z', precision: 11 }),
      JSON.stringify({ time: '+1992-04-27T00:00:00Z', precision: 11 }), GONE_COLONY, GONE_DYNASTY],
  );
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES
       ($1, 'P31', 'L1', 0, $2, NULL), ($1, 'P625', 'L2', 0, NULL, $3), ($4, 'P31', 'M1', 0, $5, NULL)`,
    [LOUVRE, MUSEUM, JSON.stringify(point(48.861, 2.3358)), MONA_LISA, PAINTING],
  );
  // The pool counts Wikipedia editions after it collects (inWikipediaEditions), and holds the Louvre to the floor of 15.
  const editions = ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'ru', 'ja', 'zh', 'ar', 'pl', 'sv', 'uk', 'ca', 'cs'];
  for (const language of editions) {
    await pool.query('INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, $2, $3)', [LOUVRE, `${language}wiki`, 'Louvre']);
  }
  await pool.query(
    `INSERT INTO wikidata_labels (id, language, label, description) VALUES
       ($1, 'fr', 'Musée du Louvre', NULL), ($1, 'en', 'Louvre', 'art museum in Paris'),
       ($2, 'en', 'France', NULL), ($3, 'it', 'Leonardo da Vinci', NULL), ($4, 'en', 'Room 325', NULL)`,
    [LOUVRE, FRANCE, LEONARDO, ROOM_325],
  );
  for (const [country, label] of [
    ['Q7318', 'Nazi Germany'], ['Q36', 'Poland'], ['Q1747689', 'Ancient Rome'], ['Q36704', 'Yugoslavia'], ['Q224', 'Croatia'],
    ['Q159', 'Russia'], ['Q38', 'Italy'], ['Q148', "People's Republic of China"],
  ]) {
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [country, label]);
  }
  for (const [, country] of CASTS) {
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [country, `country ${country}`]);
  }
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[...GADM_IDS].reverse()]);
  await pool.end();
});

describe('Public Art read from the subset (#1459)', () => {
  it('pools the entities of a class with a point, with the facts the live pool row carries', async () => {
    const [louvre, ...rest] = await fetchClassPool(door, [MUSEUM]);
    expect(rest).toEqual([]);
    expect(louvre).toMatchObject({
      qid: LOUVRE, label: 'Louvre', description: 'art museum in Paris', lat: 48.861, lon: 2.3358, onEarth: true,
      imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Louvre%20Museum%20Wikimedia%20Commons.jpg',
      countryLabel: 'France', articleUrl: 'https://en.wikipedia.org/wiki/Louvre', website: 'https://www.louvre.fr/', year: 1793,
    });
    expect(await fetchClassPool(door, [PAINTING])).toEqual([]);
  });

  it('names a work in several places in the country of the cast it is drawn at (#1533)', async () => {
    const [maman] = await fetchEntitiesByIds(door, [MAMAN]);
    const drawn = CASTS.find(([, , lat, lon]) => lat === maman.lat && lon === maman.lon);
    expect(drawn).toBeDefined();
    expect(maman.countryLabel).toBe(`country ${drawn![1]}`);
  });

  it('names the country a place is in today, and the point\'s where none stands (#757, #1564)', async () => {
    const places = await fetchEntitiesByIds(door, [STUTTHOF, MOSLAVINA, MEDIOLANUM]);
    const country = (qid: string) => places.find(place => place.qid === qid)?.countryLabel;
    expect(country(STUTTHOF)).toBe('Poland');
    expect(country(MOSLAVINA)).toBe('Croatia');
    // Stated only in Ancient Rome, it is named for the GADM country its point lies in (#1564).
    expect(country(MEDIOLANUM)).toBe('Italy');
  });

  it("names a place with no standing country for its point's country, a root-level one included, as the state it names (#1564)", async () => {
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ('Q148', 'de', 'China')`);
    const places = await fetchEntitiesByIds(door, [MELBOURNE_SITE, XIAN_SITE]);
    const country = (qid: string) => places.find(place => place.qid === qid)?.countryLabel;
    // Australia is the root itself, not its state; China is written as the sovereign state.
    expect(country(MELBOURNE_SITE)).toBe('Australia');
    expect(country(XIAN_SITE)).toBe("People's Republic of China");
  });

  it('names a place stated in two standing countries for the one that holds its point (#1564)', async () => {
    const [basilica] = await fetchEntitiesByIds(door, [SANT_AMBROGIO]);
    expect(basilica.countryLabel).toBe('Italy');
  });

  it('answers an entity asked for by id with no point, placeless', async () => {
    const [mona] = await fetchEntitiesByIds(door, [MONA_LISA]);
    expect(mona).toMatchObject({ qid: MONA_LISA, label: MONA_LISA, lat: null, lon: null });
  });

  it('reads where a work stands today, who made it and whom it depicts', async () => {
    expect((await fetchEntityFacts(door, [MONA_LISA])).get(MONA_LISA)).toEqual({
      classes: [PAINTING], locations: [LOUVRE], parents: [], collections: [], creators: ['Leonardo da Vinci'],
      commemorates: [], depicts: [LISA_DEL_GIOCONDO],
    });
  });

  it('reads what a container is called and is in', async () => {
    expect((await fetchContainerFacts(door, [ROOM_325])).get(ROOM_325)).toEqual({ label: 'Room 325', classes: [], parents: [SULLY_WING] });
  });
});

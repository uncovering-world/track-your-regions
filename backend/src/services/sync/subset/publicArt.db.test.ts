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
  ...CASTS.map(([host, country]): [string, number, Record<string, unknown>] =>
    [host, 0, { claims: { P17: [statement(`${host}-P17`, country)] }, sitelinks: {} }]),
];

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  for (const [id, sitelinks, body] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
      [id, sitelinks, JSON.stringify({ id, labels: {}, descriptions: {}, ...body })]);
  }
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
  for (const [, country] of CASTS) {
    await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [country, `country ${country}`]);
  }
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
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

  it('answers an entity asked for by id with no point, placeless', async () => {
    const [mona] = await fetchEntitiesByIds(door, [MONA_LISA]);
    expect(mona).toMatchObject({ qid: MONA_LISA, label: MONA_LISA, lat: null, lon: null });
  });

  it('reads where a work stands today and who made it', async () => {
    expect((await fetchEntityFacts(door, [MONA_LISA])).get(MONA_LISA)).toEqual({
      classes: [PAINTING], locations: [LOUVRE], parents: [], collections: [], creators: ['Leonardo da Vinci'],
    });
  });

  it('reads what a container is called and is in', async () => {
    expect((await fetchContainerFacts(door, [ROOM_325])).get(ROOM_325)).toEqual({ label: 'Room 325', classes: [], parents: [SULLY_WING] });
  });
});

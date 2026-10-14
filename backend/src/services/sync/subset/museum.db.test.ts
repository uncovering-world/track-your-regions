import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import {
  fetchBroadPool, fetchClassPool, fetchEntityDetails, fetchEntityEdges, fetchMuseumParts, fetchVenueStatements,
} from '../museum/queries.js';
import { fetchVenueHoldings, fetchWorksByIds } from '../museum/venueSideQueries.js';
import { DISSOLVED_UNKNOWN } from '../museum/venueTest.js';
import { dissolvedOf } from './museum.js';
import { subsetOnlyDoor } from './reader.js';

/**
 * Art Museums' questions answered from the local subset (#1460), against
 * PostgreSQL, through the fetchers the pipeline calls with the run's subset
 * door, which fails any question that reaches SPARQL. Fixture rows on real
 * items: the Mona Lisa (Q12418), a painting by Leonardo (Q762), is in the
 * Louvre's (Q19675) collection and stands in it, once stood in the Louvre
 * Palace (Q1075988) by an ended statement and stands there by one whose end
 * time is no value, and carries a deprecated location and an unknown one;
 * the Louvre is a museum with a point, part of the palace.
 */

const door = subsetOnlyDoor();
const run = { sparql: door, phase: () => {}, step: async () => {} };
const LOUVRE = 'Q19675';
const MONA_LISA = 'Q12418';
const LEONARDO = 'Q762';
const MUSEUM = 'Q33506';
const PAINTING = 'Q3305213';
const PALACE = 'Q1075988';
const FRANCE = 'Q142';

const statement = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({ id, value, ...extra });
const point = (latitude: number, longitude: number) => ({
  latitude, longitude, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2',
});
const ENDED = { P582: [{ time: '+1800-00-00T00:00:00Z' }] };
/** An end time of no value, which WDQS writes as no `pq:P582` triple: the statement still holds. */
const OPEN_ENDED = { P582: [{ novalue: true }] };

const ENTITIES: Array<[string, number, Record<string, unknown>]> = [
  [LOUVRE, 180, {
    claims: {
      P31: [statement('L1', MUSEUM)],
      P625: [statement('L2', point(48.861, 2.3358))],
      P18: [statement('L3', 'Louvre Museum Wikimedia Commons.jpg')],
      P17: [statement('L4', FRANCE)],
      P856: [statement('L5', 'https://www.louvre.fr/')],
      P361: [statement('L6', PALACE)],
    },
    sitelinks: { enwiki: 'Louvre', frwiki: 'Musée du Louvre' },
  }],
  [MONA_LISA, 150, {
    claims: {
      P31: [statement('M1', PAINTING)],
      P195: [statement('M2', LOUVRE, { rank: 'preferred' })],
      P276: [
        statement('M3', LOUVRE), statement('M4', PALACE, { qualifiers: ENDED }),
        statement('M5', FRANCE, { rank: 'deprecated' }), statement('M6', { somevalue: true }),
        statement('M11', PALACE, { qualifiers: OPEN_ENDED }),
      ],
      P170: [statement('M7', LEONARDO), statement('M8', { somevalue: true })],
      P18: [statement('M9', 'Mona Lisa.jpg')],
      P571: [statement('M10', { time: '+1503-00-00T00:00:00Z', precision: 9 })],
    },
    sitelinks: { enwiki: 'Mona Lisa' },
  }],
  [PALACE, 60, { claims: {}, sitelinks: {} }],
];

/** Every Wikipedia edition counted, so each item clears the pool's floor of ten. */
const EDITIONS = ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'ru', 'ja', 'zh', 'ar', 'pl'];

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  for (const [id, sitelinks, body] of ENTITIES) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
      [id, sitelinks, JSON.stringify({ id, labels: {}, descriptions: {}, ...body })]);
  }
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value, qualifiers) VALUES
       ($1, 'P31', 'L1', 0, $2, NULL, NULL), ($1, 'P361', 'L6', 0, $3, NULL, NULL),
       ($4, 'P31', 'M1', 0, $5, NULL, NULL), ($4, 'P195', 'M2', 1, $1, NULL, NULL),
       ($4, 'P276', 'M3', 0, $1, NULL, NULL), ($4, 'P276', 'M4', 0, $3, NULL, $6),
       ($4, 'P276', 'M5', -1, $7, NULL, NULL), ($4, 'P276', 'M11', 0, $3, NULL, $8)`,
    [LOUVRE, MUSEUM, PALACE, MONA_LISA, PAINTING, JSON.stringify(ENDED), FRANCE, JSON.stringify(OPEN_ENDED)],
  );
  for (const id of [LOUVRE, MONA_LISA]) {
    for (const language of EDITIONS) {
      await pool.query('INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, $2, $3)', [id, `${language}wiki`, id]);
    }
  }
  await pool.query('INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, $2, $3)', [MONA_LISA, 'commonswiki', 'Mona Lisa']);
  await pool.query(
    `INSERT INTO wikidata_labels (id, language, label, description) VALUES
       ($1, 'en', 'Louvre', 'art museum in Paris'), ($2, 'en', 'France', NULL), ($3, 'it', 'Leonardo da Vinci', NULL),
       ($4, 'en', 'Mona Lisa', NULL), ($5, 'en', 'painting', NULL)`,
    [LOUVRE, FRANCE, LEONARDO, MONA_LISA, PAINTING],
  );
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks');
  await pool.end();
});

const monaLisaRow = {
  qid: MONA_LISA, label: 'Mona Lisa', sitelinks: EDITIONS.length, creators: ['Leonardo da Vinci'], year: 1503,
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa.jpg', type: 'painting', typeQid: PAINTING,
};

describe('Art Museums read from the subset (#1460)', () => {
  it('pools the works of a broad root and of narrow classes, held to Wikipedia editions', async () => {
    expect(await fetchBroadPool(run, { qid: PAINTING, type: 'painting' })).toEqual([monaLisaRow]);
    expect(await fetchClassPool(door, [PAINTING])).toEqual([monaLisaRow]);
    // A class no kept item is an instance of pools nothing; the Louvre, an instance of museum, pools as a live run would.
    expect(await fetchClassPool(door, [FRANCE])).toEqual([]);
  });

  it('reads where a work says it is: no ended or deprecated statement, an unknown one with no venue', async () => {
    expect(await fetchVenueStatements(door, [MONA_LISA])).toEqual([
      { work: MONA_LISA, venue: LOUVRE, property: 'P195', rank: 'preferred' },
      { work: MONA_LISA, venue: LOUVRE, property: 'P276', rank: 'normal' },
      { work: MONA_LISA, venue: null, property: 'P276', rank: 'normal' },
      { work: MONA_LISA, venue: PALACE, property: 'P276', rank: 'normal' },
    ]);
  });

  it('reads a candidate venue\'s details, its edges, and the museums an entity counts among its parts', async () => {
    expect((await fetchEntityDetails(door, [LOUVRE])).get(LOUVRE)).toEqual({
      qid: LOUVRE, label: 'Louvre', description: 'art museum in Paris', lat: 48.861, lon: 2.3358, countryLabel: 'France',
      imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Louvre%20Museum%20Wikimedia%20Commons.jpg',
      website: 'https://www.louvre.fr/', articleUrl: 'https://en.wikipedia.org/wiki/Louvre', sitelinks: EDITIONS.length,
      dissolved: null,
    });
    expect((await fetchEntityEdges(door, [LOUVRE])).get(LOUVRE)).toEqual({ classes: [MUSEUM], parents: [PALACE], locations: [] });
    expect((await fetchMuseumParts(door, [PALACE])).get(PALACE)).toEqual([{ qid: LOUVRE, lat: 48.861, lon: 2.3358 }]);
  });

  it('reads what a venue holds by a statement that still holds, and an object asked for by id', async () => {
    const holdings = await fetchVenueHoldings(door, [LOUVRE, PALACE], 10);
    expect(holdings.map(({ work, venue, property }) => `${work} ${venue} ${property}`).sort()).toEqual([
      `${MONA_LISA} ${LOUVRE} P195`, `${MONA_LISA} ${LOUVRE} P276`, `${MONA_LISA} ${PALACE} P276`,
    ].sort());
    const details = (await fetchWorksByIds(door, [MONA_LISA])).get(MONA_LISA);
    expect(details?.work).toEqual(monaLisaRow);
    expect([...details!.classes]).toEqual([[PAINTING, 'painting']]);
  });

  it('writes a dissolution the way the query service does: a date, or one of unknown date', () => {
    expect(dissolvedOf([{ id: 'D1', value: { time: '+1793-00-00T00:00:00Z' } }])).toBe('1793-01-01T00:00:00Z');
    expect(dissolvedOf([{ id: 'D2', value: { time: '+2003-05-00T00:00:00Z' } }])).toBe('2003-05-01T00:00:00Z');
    expect(dissolvedOf([{ id: 'D3', value: { somevalue: true } }])).toBe(DISSOLVED_UNKNOWN);
    expect(dissolvedOf([{ id: 'D4', value: { novalue: true } }])).toBeNull();
    expect(dissolvedOf(undefined)).toBeNull();
  });
});

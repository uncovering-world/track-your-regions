/**
 * The surroundings pool and a candidate's surroundings read from the local subset
 * against PostgreSQL (ADR-0171, #2178): the kinds' items with a point whatever
 * their editions, their Wikipedia editions counted as the runs count them, the
 * Wikivoyage editions that use them, a year of their readers, and the best of
 * the neighbours of its own density for every item with the cut's languages
 * and readers (ADR-0181). Fixture rows on real items around Bologna:
 * the Two Towers (Q201003), the Asinelli Tower (Q3990290), the Garisenda
 * (Q3758980), the Prendiparte Tower (Q3995048) and, 115 km away, the Leaning
 * Tower of Pisa (Q39054). The pool is a handful of places, so the tests read a
 * place's density at its fourth-nearest place rather than its twentieth.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { readSurroundingsPool, type PoolReaders } from './surroundingsPool.js';
import { SURROUNDINGS_CUT } from './surroundingsCut.js';

const TOWER = 'Q12518';
const MAST = 'Q5622819';
const TWO_TOWERS = 'Q201003';
const ASINELLI = 'Q3990290';
const GARISENDA = 'Q3758980';
const PRENDIPARTE = 'Q3995048';
const PISA = 'Q39054';
const ONE_WIKI = 'Q99999901';

// A year of readers, as the readership year would hand them: the Prendiparte is read in no counted edition.
const YEAR = new Map([[TWO_TOWERS, 90_000], [ASINELLI, 30_000], [GARISENDA, 12_000], [PISA, 2_000_000], [ONE_WIKI, 800]]);
let asked: string[] = [];
const readersOf = (qids: readonly string[]) => new Map(qids.filter((q) => YEAR.has(q)).map((q) => [q, YEAR.get(q)!]));
// The year's readers' floor where the rank yields the count it was derived at.
const year: PoolReaders = async (qids) => {
  asked = [...qids];
  return { readers: readersOf(qids), minReaders: 3_000 };
};

// A usage build in place, as the fixture's usage rows stand for one.
const built = async () => true;

// A place's density read at its fourth-nearest: Bologna's towers stand metres apart, Pisa a hundred kilometres from them.
const CUT = { ...SURROUNDINGS_CUT, best: 3, densityNeighbours: 4 };

const point = (lat: number, lon: number) => JSON.stringify({ latitude: lat, longitude: lon, globe: 'http://www.wikidata.org/entity/Q2' });

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks, wikivoyage_usage');
  const rows: Array<[string, number, string, number, number, string[], string[]]> = [
    // qid, sitelink_count, class, lat, lon, wikipedia editions, wikivoyage editions
    [TWO_TOWERS, 40, TOWER, 44.4946, 11.3466, ['en', 'it', 'de', 'fr', 'es', 'ru', 'ja', 'zh', 'pt', 'nl'], ['en', 'it', 'de']],
    [ASINELLI, 9, TOWER, 44.4944, 11.3468, ['en', 'it', 'de', 'fr', 'es', 'ru', 'ja', 'zh', 'pt'], ['en']],
    [GARISENDA, 8, TOWER, 44.4945, 11.3464, ['en', 'it', 'de', 'fr', 'es', 'ru', 'ja', 'zh'], []],
    [PRENDIPARTE, 3, TOWER, 44.4958, 11.3470, ['it', 'en', 'fr'], []],
    [PISA, 120, TOWER, 43.7230, 10.3966, ['en', 'it', 'de', 'fr', 'es', 'ru', 'ja', 'zh', 'pt', 'nl', 'pl'], ['en', 'it', 'de', 'fr']],
    [ONE_WIKI, 1, TOWER, 44.4950, 11.3450, ['it'], []],
  ];
  for (const [qid, count, cls, lat, lon, wikis, voyages] of rows) {
    await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, $2, $3)',
      [qid, count, JSON.stringify({ id: qid, labels: {}, descriptions: {}, claims: {} })]);
    await pool.query(
      `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value, qualifiers) VALUES
         ($1, 'P31', $1 || '$1', 0, $2, NULL, NULL), ($1, 'P625', $1 || '$2', 0, NULL, $3::jsonb, NULL)`,
      [qid, cls, point(lat, lon)]);
    for (const w of wikis) await pool.query('INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, $2, $3)', [qid, `${w}wiki`, qid]);
    // Commons counts as a sitelink and not as a Wikipedia edition.
    await pool.query('INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, $2, $3)', [qid, 'commonswiki', qid]);
    for (const v of voyages) await pool.query('INSERT INTO wikivoyage_usage (item, site) VALUES ($1, $2)', [qid, `${v}wikivoyage`]);
  }
  // A mast with a point: another class, so not of the pool.
  await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 5, $2)', ['Q99999902', JSON.stringify({ id: 'Q99999902', labels: {}, descriptions: {}, claims: {} })]);
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value, qualifiers) VALUES
       ('Q99999902', 'P31', 'Q99999902$1', 0, $1, NULL, NULL), ('Q99999902', 'P625', 'Q99999902$2', 0, NULL, $2::jsonb, NULL)`,
    [MAST, point(44.49, 11.35)]);
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_entities, wikidata_claims, wikidata_labels, wikidata_sitelinks, wikivoyage_usage');
  await pool.end();
});

describe('the surroundings pool read from the subset (#2178)', () => {
  it('holds the kinds\' items with a point whatever their editions, counted as the runs count them, and the surroundings of those with the cut\'s languages and readers', async () => {
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]) }, CUT, [{ key: 'all', classes: null }], undefined, year, built);
    const all = surroundings.around.get('all')!;
    // Every tower with a point is of the pool, the one-edition tower too; the mast is another class.
    expect([...surroundings.rows.keys()].sort()).toEqual([TWO_TOWERS, PISA, GARISENDA, ASINELLI, PRENDIPARTE, ONE_WIKI].sort());
    expect(surroundings.rows.get(ASINELLI)).toEqual({ qid: ASINELLI, editions: 9, guideEditions: 1, readers: 30_000, classes: [TOWER], lat: 44.4944, lon: 11.3468 });
    // Readers are asked of every item with a Wikipedia article; one read by nobody counted reads 0.
    expect(asked.sort()).toEqual([TWO_TOWERS, PISA, GARISENDA, ASINELLI, PRENDIPARTE, ONE_WIKI].sort());
    expect(surroundings.rows.get(PRENDIPARTE)?.readers).toBe(0);
    expect(surroundings.unread).toBeUndefined();
    expect(surroundings.unreadGuides).toBeUndefined();
    expect(surroundings.rows.get(GARISENDA)?.guideEditions).toBe(0);
    // The surroundings are read for the items at two languages or more: the one-edition tower counts in the group and is asked about nothing.
    expect(all.has(ONE_WIKI)).toBe(false);
    // Nor for one under the readers a held place stays at, which the verdict refuses before it reads any: the unread Prendiparte.
    expect(all.has(PRENDIPARTE)).toBe(false);
    // Pisa lies within 150 km of the Asinelli, but a hundred kilometres from its nearest places where Bologna's towers
    // stand metres apart: the Asinelli's neighbours are Bologna's five towers. The best three by editions, and the guide
    // use among the places a guide uses. The readers are the best three read at all: the unread Prendiparte sets none.
    expect(all.get(ASINELLI)).toEqual({ groupSize: 5, topEditions: [10, 9, 8], topGuideEditions: [3, 1], topReaders: [90_000, 30_000, 12_000] });
    // Pisa stands alone among the places of its density.
    expect(all.get(PISA)).toEqual({ groupSize: 1, topEditions: [11], topGuideEditions: [4], topReaders: [2_000_000] });
    // In a plain circle of the same radius, Pisa is among the Asinelli's neighbours and sets its best.
    const circle = await readSurroundingsPool({ classes: new Set([TOWER]) }, { ...CUT, densityRatio: Infinity }, [{ key: 'all', classes: null }], undefined, year);
    expect(circle.around.get('all')!.get(ASINELLI)).toEqual({ groupSize: 6, topEditions: [11, 10, 9], topGuideEditions: [4, 3, 1], topReaders: [2_000_000, 90_000, 30_000] });
    expect(surroundings.seconds).toBeGreaterThanOrEqual(0);
  });

  it('reads a group over its own classes alone: a neighbourhood of masts holds no tower', async () => {
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER, MAST]) }, CUT,
      [{ key: 'towers', classes: new Set([TOWER]) }, { key: 'masts', classes: new Set([MAST]) }], undefined, year);
    // The Asinelli's neighbours among towers alone: the five Bologna towers; the mast is not counted.
    expect(surroundings.around.get('towers')!.get(ASINELLI)?.groupSize).toBe(5);
    // The mast has five sitelinks but no Wikipedia edition, so it is under the cut's languages and gets no surroundings.
    expect(surroundings.around.get('masts')!.size).toBe(0);
  });

  it('holds an item named beside the classes with every class it carries, and counts it in no one\'s surroundings (#2171)', async () => {
    const MAST_ITEM = 'Q99999902';
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]), items: new Set([MAST_ITEM]) }, CUT,
      [{ key: 'towers', classes: new Set([TOWER]), items: new Set([MAST_ITEM]) }], undefined, year);
    // A mast is no class of the pool, and the item is held all the same, typed as it is.
    expect(surroundings.rows.get(MAST_ITEM)).toEqual({ qid: MAST_ITEM, editions: 0, guideEditions: 0, readers: 0, classes: [MAST], lat: 44.49, lon: 11.35 });
    // It has no Wikipedia edition, so it is under the cut's languages and gets no surroundings of its own.
    expect(surroundings.around.get('towers')!.has(MAST_ITEM)).toBe(false);
    // And it is no neighbour of anyone: it stands among Bologna's towers, and the Asinelli's surroundings are what they are without it.
    const without = await readSurroundingsPool({ classes: new Set([TOWER]) }, CUT, [{ key: 'towers', classes: new Set([TOWER]) }], undefined, year);
    expect(surroundings.around.get('towers')!.get(ASINELLI)).toEqual(without.around.get('towers')!.get(ASINELLI));
  });

  it('reports its progress and stops between batches when the run is cancelled', async () => {
    const phases: string[] = [];
    let steps = 0;
    const run = {
      phase: (m: string) => { phases.push(m); },
      step: async () => { steps += 1; if (steps > 1) throw new Error('Sync cancelled'); },
    };
    await expect(readSurroundingsPool({ classes: new Set([TOWER]) }, SURROUNDINGS_CUT, [{ key: 'all', classes: null }], run, year)).rejects.toThrow('Sync cancelled');
    expect(phases[0]).toMatch(/Building the surroundings tier's pool/);
    // And it leaves no table behind when stopped.
    const left = await pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'surroundings_pool'");
    expect(left.rows).toEqual([]);
  });

  it('measures against the readers\' floor the year yields at the cut\'s rank, and hands it to the cut (ADR-0184)', async () => {
    let rankAsked = 0;
    // A year read so much that its floor is 40,000: a held place stays at 32,000.
    const busyYear: PoolReaders = async (qids, rank) => {
      rankAsked = rank;
      return { readers: readersOf(qids), minReaders: 40_000 };
    };
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]) }, CUT, [{ key: 'all', classes: null }], undefined, busyYear, built);
    expect(rankAsked).toBe(SURROUNDINGS_CUT.minReadersRank);
    expect(surroundings.minReaders).toBe(40_000);
    // The Asinelli's 30,000 cleared the floor of 3,000 and are under this year's 32,000; the Two Towers' 90,000 are not.
    const all = surroundings.around.get('all')!;
    expect(all.has(ASINELLI)).toBe(false);
    expect(all.has(TWO_TOWERS)).toBe(true);
  });

  it('reads no surroundings where no year of readers is read, says why, and leaves no table behind', async () => {
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]) }, SURROUNDINGS_CUT, [{ key: 'all', classes: null }], undefined, async () => null);
    expect(surroundings.rows.size).toBe(0);
    expect(surroundings.around.size).toBe(0);
    expect(surroundings.unread).toMatch(/^No year of readers is read/);
    const left = await pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'surroundings_pool'");
    expect(left.rows).toEqual([]);
  });

  it('reads no surroundings where the year keeps fewer items than the floor\'s rank, and says so (ADR-0184)', async () => {
    const short: PoolReaders = async (qids) => ({ readers: readersOf(qids), minReaders: null });
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]) }, CUT, [{ key: 'all', classes: null }], undefined, short, built);
    expect(surroundings.around.size).toBe(0);
    expect(surroundings.unread).toMatch(/^The year keeps fewer items than the readers' floor's rank \(889,568\)/);
  });

  it('reads the pool where no Wikivoyage usage is built, and says its guides are not read (ADR-0175 decision 6)', async () => {
    const surroundings = await readSurroundingsPool({ classes: new Set([TOWER]) }, CUT, [{ key: 'all', classes: null }], undefined, year, async () => false);
    expect(surroundings.unread).toBeUndefined();
    expect(surroundings.unreadGuides).toMatch(/^No Wikivoyage usage is built, so no guide's use is read/);
    expect(surroundings.around.get('all')!.has(ASINELLI)).toBe(true);
  });

  it('leaves no table behind once the read is over', async () => {
    await readSurroundingsPool({ classes: new Set([TOWER]) }, SURROUNDINGS_CUT, [{ key: 'all', classes: null }], undefined, year);
    const left = await pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'surroundings_pool'");
    expect(left.rows).toEqual([]);
  });
});

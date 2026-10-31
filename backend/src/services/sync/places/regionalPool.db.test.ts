/**
 * The regional pool and a candidate's surroundings read from the local subset
 * against PostgreSQL (ADR-0171, #2178): the kinds' items with a point whatever
 * their editions, their Wikipedia editions counted as the runs count them, the
 * Wikivoyage editions that use them, and the best within the radius for every
 * item with the cut's languages. Fixture rows on real items around Bologna:
 * the Two Towers (Q201003), the Asinelli Tower (Q3990290), the Garisenda
 * (Q3758980), the Prendiparte Tower (Q3995048) and, 300 km away, the Leaning
 * Tower of Pisa (Q39054).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { readRegionalPool } from './regionalPool.js';
import { REGIONAL_CUT } from './regionalCut.js';

const TOWER = 'Q12518';
const MAST = 'Q5622819';
const TWO_TOWERS = 'Q201003';
const ASINELLI = 'Q3990290';
const GARISENDA = 'Q3758980';
const PRENDIPARTE = 'Q3995048';
const PISA = 'Q39054';
const ONE_WIKI = 'Q99999901';

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

describe('the regional pool read from the subset (#2178)', () => {
  it('holds the kinds\' items with a point whatever their editions, counted as the runs count them, and the surroundings of those with the cut\'s languages', async () => {
    const regional = await readRegionalPool(new Set([TOWER]), { ...REGIONAL_CUT, best: 3 }, [{ key: 'all', classes: null }]);
    const all = regional.around.get('all')!;
    // Every tower with a point is of the pool, the one-edition tower too; the mast is another class.
    expect([...regional.rows.keys()].sort()).toEqual([TWO_TOWERS, PISA, GARISENDA, ASINELLI, PRENDIPARTE, ONE_WIKI].sort());
    expect(regional.rows.get(ASINELLI)).toEqual({ qid: ASINELLI, editions: 9, guideEditions: 1, classes: [TOWER], lat: 44.4944, lon: 11.3468 });
    expect(regional.rows.get(GARISENDA)?.guideEditions).toBe(0);
    // The surroundings are read for the items at two languages or more: the one-edition tower counts in the group and is asked about nothing.
    expect(all.has(ONE_WIKI)).toBe(false);
    // Bologna's five towers lie within 50 km of the Asinelli; Pisa does not. The best three by editions, and the guide use among the places a guide uses.
    expect(all.get(ASINELLI)).toEqual({ groupSize: 5, topEditions: [10, 9, 8], topGuideEditions: [3, 1] });
    // Pisa stands alone within its radius.
    expect(all.get(PISA)).toEqual({ groupSize: 1, topEditions: [11], topGuideEditions: [4] });
    expect(regional.seconds).toBeGreaterThanOrEqual(0);
  });

  it('reads a group over its own classes alone: a neighbourhood of masts holds no tower', async () => {
    const regional = await readRegionalPool(new Set([TOWER, MAST]), { ...REGIONAL_CUT, best: 3 },
      [{ key: 'towers', classes: new Set([TOWER]) }, { key: 'masts', classes: new Set([MAST]) }]);
    // The Asinelli's neighbours among towers alone: the five Bologna towers; the mast is not counted.
    expect(regional.around.get('towers')!.get(ASINELLI)?.groupSize).toBe(5);
    // The mast has five sitelinks but no Wikipedia edition, so it is under the cut's languages and gets no surroundings.
    expect(regional.around.get('masts')!.size).toBe(0);
  });

  it('reports its progress and stops between batches when the run is cancelled', async () => {
    const phases: string[] = [];
    let steps = 0;
    const run = {
      phase: (m: string) => { phases.push(m); },
      step: async () => { steps += 1; if (steps > 1) throw new Error('Sync cancelled'); },
    };
    await expect(readRegionalPool(new Set([TOWER]), REGIONAL_CUT, [{ key: 'all', classes: null }], run)).rejects.toThrow('Sync cancelled');
    expect(phases[0]).toMatch(/Building the regional tier's pool/);
    // And it leaves no table behind when stopped.
    const left = await pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'regional_pool'");
    expect(left.rows).toEqual([]);
  });

  it('leaves no table behind once the read is over', async () => {
    await readRegionalPool(new Set([TOWER]), REGIONAL_CUT, [{ key: 'all', classes: null }]);
    const left = await pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'regional_pool'");
    expect(left.rows).toEqual([]);
  });
});

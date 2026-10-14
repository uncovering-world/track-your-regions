import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { unreadOnSubset } from './runDoor.js';

/**
 * The rows a run on the subset cannot read (#1462), against PostgreSQL: only
 * a row a run listed on or after the dump's date counts, since a dump holds no
 * merged or deleted item and a row last listed before it had gone by then.
 * Archaeology rows on real items, the dump dated 2026-10-01: Troy (Q22647) is
 * kept; the British Museum (Q6373) is not and was listed after the dump; the
 * Rosetta Stone (Q48584) is not and was last listed before it.
 */

const SOURCE = 5;
const KIND = 5;
const TROY = 'Q22647';
const BRITISH_MUSEUM = 'Q6373';
const ROSETTA = 'Q48584';
const ROWS: Array<[number, string, string, string]> = [
  [914621, TROY, 'Troy', '2026-10-10'],
  [914622, BRITISH_MUSEUM, 'British Museum', '2026-10-10'],
  [914623, ROSETTA, 'Rosetta Stone', '2026-09-20'],
];
let buildId = 0;

const clear = async () => {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [ROWS.map(([id]) => id)]);
  await pool.query('DELETE FROM wikidata_subset_builds WHERE build_id = $1', [buildId]);
  await pool.query('DELETE FROM dump_builds WHERE id = $1', [buildId]);
  await pool.query('TRUNCATE wikidata_entities');
};

beforeAll(async () => {
  const build = await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, file_name, dump_date, url, mode, status)
     VALUES ('wikidata-entities', 'wikidata-20261001-all.json.gz', '2026-10-01', 'https://dumps.wikimedia.org/fixture.json.gz', 'local', 'success')
     RETURNING id`,
  );
  buildId = build.rows[0].id;
  await pool.query("INSERT INTO wikidata_subset_builds (build_id, dump_date, counts) VALUES ($1, '2026-10-01', '{}')", [buildId]);
  await pool.query('TRUNCATE wikidata_entities');
  await pool.query('INSERT INTO wikidata_entities (id, sitelink_count, entity) VALUES ($1, 0, $2)',
    [TROY, JSON.stringify({ id: TROY, labels: {}, descriptions: {}, claims: {}, sitelinks: {} })]);
  for (const [id, qid, name, seen] of ROWS) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(0, 0), 4326))`,
      [id, SOURCE, qid, name],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, last_seen_at)
       VALUES ($1, $2, $3, $4, 'auto', $5)`,
      [id, KIND, SOURCE, qid, seen],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the rows a run on the subset cannot read (#1462)', () => {
  it('names a row listed since the dump whose item the subset lacks, and leaves a row gone before it to missing detection', async () => {
    const fixture = new Set(ROWS.map(([, qid]) => qid));
    const unread = (await unreadOnSubset(SOURCE)).filter(row => fixture.has(row.externalId));
    expect(unread).toEqual([{ externalId: BRITISH_MUSEUM, name: 'British Museum' }]);
  });
});

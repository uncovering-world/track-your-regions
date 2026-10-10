import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperiencesByRegion } from './experienceQueryController.js';
import { experiencesByRegionQuerySchema } from '../../types/index.js';

/**
 * A region's list holds a place only where one membership is both admitted
 * and passed (#1275), against PostgreSQL: the Capitoline Museums with an
 * Archaeology membership admitted but still unread and an Art Museums one
 * passed but refused by its rule is in no list — as it is on no map and in no
 * kind — and once a membership offers it, it is listed under that kind.
 */

const PLACE = 9880;
const NAME = 'Capitoline Museums (offered fixture)';
const QID = 'Q9880-capitoline-offered-fixture';

let regionId = 0;
let artSource = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
}

async function sourceId(name: string): Promise<number> {
  const result = await pool.query<{ id: number }>('SELECT id FROM experience_sources WHERE name = $1', [name]);
  return result.rows[0].id;
}

beforeEach(async () => {
  await clear();
  artSource = await sourceId('Art Museums');
  regionId = (await pool.query<{ id: number }>('SELECT id FROM regions ORDER BY id LIMIT 1')).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(12.48278, 41.89306), 4326))`,
    [PLACE, artSource, QID, NAME],
  );
  // Archaeology admitted but unread; Art Museums passed but refused by its rule.
  await pool.query(
    `INSERT INTO experience_kind_memberships
            (experience_id, kind_id, source_id, external_id, curation_state, published_at, admission, admission_reason)
     SELECT $1, s.kind_id, s.id, $2, v.state, CASE WHEN v.state = 'auto' THEN NOW() END, v.admission, v.reason
       FROM (VALUES ('Archaeology', 'pending', 'admitted', NULL), ('Art Museums', 'auto', 'refused', 'not an art museum'))
            AS v(source, state, admission, reason)
       JOIN experience_sources s ON s.name = v.source`,
    [PLACE, QID],
  );
  // Placed in the region by hand, so the list's membership rule needs no point.
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`,
    [PLACE, regionId],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

async function listed(): Promise<Array<{ id: number; kinds: Array<{ kind_name: string }> }>> {
  const response = await getExperiencesByRegion({
    params: { regionId },
    query: experiencesByRegionQuerySchema.parse({ includeChildren: 'false' }),
    caller: undefined,
  });
  return response.experiences
    .filter(row => row.id === PLACE)
    .map(row => ({ id: row.id, kinds: (row.kinds ?? []) as Array<{ kind_name: string }> }));
}

describe("a region's list and the place no membership offers (#1275)", () => {
  it('lists no place whose admitted membership is unread and whose passed one is refused', async () => {
    expect(await listed()).toEqual([]);
  });

  it('lists the place under the kind whose membership offers it, once one does', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET admission = 'admitted', admission_reason = NULL
        WHERE experience_id = $1 AND source_id = $2`,
      [PLACE, artSource],
    );

    const rows = await listed();

    expect(rows).toHaveLength(1);
    // Under Art Museums alone: the Archaeology membership is admitted but unread.
    expect(rows[0].kinds.map(kind => kind.kind_name)).toEqual(['Art Museums']);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { worldHeritageReading } from './worldHeritageReading.js';

/**
 * The World Heritage List as a survey reads it (#1981), against PostgreSQL: a
 * serial property of the fixture's own (id 9981) in a country nobody else
 * uses, with components under its own references (a part's point, a
 * renumbered one, one a merge folded, one the source withdrew and one folded
 * that the source dropped) and a point another kind's place brought with a
 * merge; and a property the source no longer lists. Ids are the
 * fixture's own, deleted before and after.
 */

const SITE = 9981;
const PART = 9982;
const DELISTED = 9983;
const COUNTRY = 'XQ';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[SITE, PART, DELISTED]]);
}

async function place(id: number, externalId: string, name: string, missing = false): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, country_codes)
     VALUES ($1, 1, $2, $3, ST_SetSRID(ST_MakePoint(10, 10), 4326), ARRAY[$4]::varchar[])`,
    [id, externalId, name, COUNTRY],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, missing_since)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), CASE WHEN $3::boolean THEN NOW() END
       FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [id, externalId, missing],
  );
  return membership.rows[0].id;
}

async function point(placeId: number, ref: string, name: string, withdrawn = false): Promise<void> {
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, missing_since)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(10, 10), 4326), CASE WHEN $4::boolean THEN NOW() END)`,
    [placeId, name, ref, withdrawn],
  );
}

beforeEach(async () => {
  await clear();
  const membership = await place(SITE, '9981', 'Fixture Road System');
  await point(SITE, '9981-001', 'Segment One');
  await point(SITE, '9981-002', 'Segment Two', true);
  await point(SITE, 'Q9981', 'A temple another kind brought');
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location) VALUES ($1, 1, 'part:9981-003', 'Fixture Bridge', ST_SetSRID(ST_MakePoint(10, 10), 4326))`,
    [PART],
  );
  await pool.query(`INSERT INTO experience_parts (whole_id, part_id, reason, membership_id) VALUES ($1, $2, 'component', $3)`, [SITE, PART, membership]);
  await point(PART, '9981-003', 'Fixture Bridge');
  // A component under a renumbered reference, and one whose point a merge
  // folded into the point another kind's place keeps (ADR-0088 decision 3).
  await point(SITE, '9981bis-004', 'Segment Four');
  const kept = (await pool.query<{ id: number }>(
    `SELECT id FROM experience_locations WHERE experience_id = $1 AND external_ref = 'Q9981'`, [SITE],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, merged_into_id)
     VALUES ($1, 'Segment Five', '9981-005', ST_SetSRID(ST_MakePoint(10, 10), 4326), $2)`,
    [SITE, kept],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [kept, membership]);
  // A folded component the source dropped: no placement of the property's
  // stands for it, since the run took its own away.
  const unplaced = (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'A temple of another kind', 'Q9982', ST_SetSRID(ST_MakePoint(10, 10), 4326)) RETURNING id`, [SITE],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, merged_into_id)
     VALUES ($1, 'Segment Six', '9981-006', ST_SetSRID(ST_MakePoint(10, 10), 4326), $2)`,
    [SITE, unplaced],
  );
  await place(DELISTED, '9983', 'A delisted property', true);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the World Heritage List a survey reads (#1981)', () => {
  it("names a country's standing properties with the components it lists under its own references", async () => {
    expect(await worldHeritageReading(pool, { countries: [COUNTRY.toLowerCase()] })).toEqual([{
      id: '9981',
      name: 'Fixture Road System',
      countries: [COUNTRY],
      // A part's point, a renumbered reference and a folded point are components;
      // a withdrawn one, a folded one the source dropped and another kind's
      // point are not.
      components: [
        { ref: '9981-001', name: 'Segment One' }, { ref: '9981-003', name: 'Fixture Bridge' },
        { ref: '9981-005', name: 'Segment Five' }, { ref: '9981bis-004', name: 'Segment Four' },
      ],
    }]);
  });

  it('reads nothing of a property the source no longer lists', async () => {
    expect(await worldHeritageReading(pool, { ids: ['9983'] })).toEqual([]);
  });
});

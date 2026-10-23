import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * The World Heritage run records how roughly the list placed each component
 * (#1853), against PostgreSQL. The fixture is Echmiatsin and Zvartnots (1011)
 * as the list gives it: three components on the property's own point, one
 * given to the second, and the Longmen Grottoes' kind of point, to the whole
 * minute. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9853;
const UNESCO = 1;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

const recorded = async () => (await pool.query<{ ref: string; approximate: string | null }>(
  `SELECT external_ref AS ref, approximate FROM experience_locations el
    WHERE el.experience_id = $1
       OR el.experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)
    ORDER BY external_ref`, [SITE],
)).rows;

const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };
const points = [
  { externalRef: '1011-001', name: 'Mother Cathedral of Echmiatsin', ...SHARED },
  { externalRef: '1011-002', name: 'Church Saint Gayaneh', ...SHARED },
  { externalRef: '1011-003', name: 'Cemetery of Congregation', ...SHARED },
  { externalRef: '1011-006', name: 'Archaeological site of Zvartnots', lon: 44.3246388889, lat: 40.1586666667 },
  { externalRef: '1011-007', name: 'A component to the whole minute', lon: 44.3, lat: 40.15 },
];

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9853-fixture', 'Echmiatsin fixture', ST_SetSRID(ST_MakePoint(44.2951388889, 40.1593055556), 4326))`,
    [SITE, UNESCO],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9853-fixture', 'verified', NOW() FROM experience_sources s WHERE s.id = $2`,
    [SITE, UNESCO],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('how roughly the list placed a component', () => {
  it('records a shared point and a whole minute, and nothing for a point given to the second', async () => {
    await writeExperienceLocations(SITE, points, { syncLogId: null, sourceId: UNESCO, components: true });

    expect(await recorded()).toEqual([
      { ref: '1011-001', approximate: 'shared' },
      { ref: '1011-002', approximate: 'shared' },
      { ref: '1011-003', approximate: 'shared' },
      { ref: '1011-006', approximate: null },
      { ref: '1011-007', approximate: 'whole-minute' },
    ]);
  });

  it('leaves the mark of a point a curator placed as the curator left it', async () => {
    await writeExperienceLocations(SITE, points, { syncLogId: null, sourceId: UNESCO, components: true });
    // As correctPoint leaves it: the coordinate claimed, the mark cleared.
    await pool.query(
      `UPDATE experience_locations SET curated_fields = '["location"]'::jsonb, approximate = NULL
        WHERE external_ref = '1011-007'
          AND (experience_id = $1 OR experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1))`,
      [SITE],
    );
    // A second run with a component more, so the writer leaves its fast path.
    const added = { externalRef: '1011-008', name: 'A component given to the second', lon: 44.3112222222, lat: 40.1612777778 };
    await writeExperienceLocations(SITE, [...points, added], { syncLogId: null, sourceId: UNESCO, components: true });

    const after = await recorded();
    expect(after.find(p => p.ref === '1011-007')?.approximate).toBeNull();
    expect(after.find(p => p.ref === '1011-001')?.approximate).toBe('shared');
    expect(after.find(p => p.ref === '1011-008')?.approximate).toBeNull();
  });

  it('judges each point of a reference listed once per country by its own coordinate', async () => {
    // One reference, two countries: one point to the whole minute, one given to the second.
    await writeExperienceLocations(SITE, [
      { externalRef: '1011-009', name: 'Across the border (one side)', lon: 44.3, lat: 40.15 },
      { externalRef: '1011-009', name: 'Across the border (other side)', lon: 44.3112222222, lat: 40.1612777778 },
    ], { syncLogId: null, sourceId: UNESCO, components: true });

    const rows = (await pool.query<{ lon: number; approximate: string | null }>(
      `SELECT ST_X(location) AS lon, approximate FROM experience_locations
        WHERE external_ref = '1011-009'
          AND (experience_id = $1 OR experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1))
        ORDER BY lon`, [SITE],
    )).rows;
    expect(rows.map(row => row.approximate)).toEqual(['whole-minute', null]);
  });
});

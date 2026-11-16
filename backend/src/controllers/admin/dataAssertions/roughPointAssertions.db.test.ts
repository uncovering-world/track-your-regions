import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { COMPONENT_SOURCE_ID } from '../../../db/membership.js';
import { writeExperienceLocations } from '../../../services/sync/locationWriter.js';
import { roughPointAssertions } from './roughPointAssertions.js';

/**
 * The check that holds a point's stored rough mark to its line's record until
 * the points go (#2123), against PostgreSQL. The fixture is Echmiatsin's
 * components as the World Heritage run writes them. Ids are the fixture's own,
 * deleted before and after.
 */

const SITE = 9857;
const UNESCO = 1;
const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };

async function clear(): Promise<void> {
  // The run makes a place of each component: they go before the site, while the relation still names them.
  await pool.query('DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

async function outOfStep(): Promise<string[]> {
  const rule = roughPointAssertions.find(assertion => assertion.id === 'point-rough-out-of-step')!;
  const rows = (await pool.query<Record<string, unknown>>(rule.sql)).rows.filter(row => Number(row.site_id) === SITE);
  return rows.map(row => rule.describe(row));
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9857', 'Echmiatsin check fixture', ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [SITE, UNESCO, SHARED.lon, SHARED.lat],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9857', 'verified', NOW() FROM experience_sources s WHERE s.id = $2`,
    [SITE, UNESCO],
  );
  await writeExperienceLocations(SITE, [
    { externalRef: '1011-001', name: 'Mother Cathedral of Echmiatsin', ...SHARED },
    { externalRef: '1011-003', name: 'Cemetery of Congregation', ...SHARED },
    { externalRef: '1011-007', name: 'A component to the whole minute', lon: 44.3, lat: 40.15 },
  ], { syncLogId: null, sourceId: UNESCO, components: true });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('point-rough-out-of-step', () => {
  it('names a point whose stored mark its record does not hold, and nothing where they agree', async () => {
    expect(await outOfStep()).toEqual([]);

    await pool.query(
      `UPDATE source_records SET reported_location_rough = NULL
        WHERE source_id = $2 AND whole_id = $1 AND external_id = '1011-007'`,
      [SITE, COMPONENT_SOURCE_ID],
    );
    expect(await outOfStep()).toEqual([expect.stringMatching(
      /^Echmiatsin check fixture: A component to the whole minute \(1011-007, point \d+\) is whole-minute by its mark and not rough by its record$/,
    )]);
  });
});

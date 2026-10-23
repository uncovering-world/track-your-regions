import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { writeExperienceLocations } from '../../services/sync/locationWriter.js';
import { correctPoint } from './experienceLocationWriter.js';

/**
 * A component a curator placed is no longer the list's rough point (#1853),
 * against PostgreSQL: Echmiatsin's Cemetery of Congregation, on the property's
 * shared point until a curator moves it. Ids are the fixture's own.
 */

const SITE = 9854;
const UNESCO = 1;
const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

const pointOf = (ref: string) => pool.query<{ id: number; approximate: string | null }>(
  `SELECT id, approximate FROM experience_locations
    WHERE external_ref = $2
      AND (experience_id = $1 OR experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1))`,
  [SITE, ref],
).then(result => result.rows[0]);

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9854-fixture', 'Echmiatsin fixture', ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [SITE, UNESCO, SHARED.lon, SHARED.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9854-fixture', 'verified', NOW() FROM experience_sources s WHERE s.id = $2`,
    [SITE, UNESCO],
  );
  await writeExperienceLocations(SITE, [
    { externalRef: '1011-001', name: 'Mother Cathedral of Echmiatsin', ...SHARED },
    { externalRef: '1011-003', name: 'Cemetery of Congregation', ...SHARED },
  ], { syncLogId: null, sourceId: UNESCO, components: true });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a curator placing an approximate point', () => {
  it('clears its mark in the statement that claims its coordinate', async () => {
    const cemetery = await pointOf('1011-003');
    expect(cemetery.approximate).toBe('shared');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, SITE);
      await correctPoint(client, locked!.lock, cemetery.id, {
        name: null, movesPoint: true, longitude: 44.2958, latitude: 40.1601, curatedFields: ['location'],
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect((await pointOf('1011-003')).approximate).toBeNull();
    expect((await pointOf('1011-001')).approximate).toBe('shared');
  });
});

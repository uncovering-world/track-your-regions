import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { acceptSourceUnderLock } from './acceptSourceController.js';

/**
 * Taking the source's value writes it at once, whatever the field (#2222),
 * executed against PostgreSQL: the coordinate is a geometry built from the
 * recorded pair, the pin is found by the coordinate the same transaction then
 * overwrites, and a metadata key is merged into the stored object.
 *
 * The fixture is Aqua Virgo as the Bridges & engineering marvels runs of
 * 2026-10-31 left it: a curator moved it to Vicus Caprarius by the Trevi
 * Fountain, where the aqueduct can be seen, and the run proposes Wikidata's
 * coordinate near Salone, 12 km east, where it takes its water, for the place
 * and for its one point. Deleted before and after.
 */

const PLACE = 9612;
const USER_UUID = '00000000-0000-4000-8000-000000009612';
const TREVI = { lon: 12.4841, lat: 41.9004 };
const SALONE = { lon: 12.62688889, lat: 41.91022222 };

let userId = 0;
let sourceId = 0;
let pointId = 0;
const syncLogs: number[] = [];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [PLACE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

/** The run that kept the curator's values and recorded the source's beside them. */
async function conflictRun(): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [sourceId],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  const conflict = (field: string, old: unknown, next: unknown) => ({
    field, old, new: next, significance: 'major', curatedConflict: true, held: false,
  });
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields, contents)
     VALUES ($1, $2, 'Q600139', 'conflict', $3, $4)`,
    [logId, PLACE,
      JSON.stringify([
        conflict('location', TREVI, SALONE),
        conflict('metadata.website', 'https://curator.example/aqua-virgo', 'https://source.example/aqua-virgo'),
      ]),
      JSON.stringify({ locations: { added: [], returned: [], withdrawn: [], changed: [{
        item: { ref: 'Q600139', name: 'Vicus Caprarius, by the Trevi Fountain' },
        fields: [conflict('location', TREVI, SALONE)],
      }] } })],
  );
  return logId;
}

async function place(): Promise<{ lon: number; lat: number; curated_fields: string[]; website: string }> {
  const row = await pool.query(
    `SELECT ST_X(location) AS lon, ST_Y(location) AS lat, curated_fields, metadata->>'website' AS website
       FROM experiences WHERE id = $1`, [PLACE],
  );
  return row.rows[0];
}

async function pin(): Promise<{ lon: number; lat: number; curated_fields: string[] }> {
  const row = await pool.query(
    `SELECT ST_X(location) AS lon, ST_Y(location) AS lat, curated_fields FROM experience_locations WHERE id = $1`,
    [pointId],
  );
  return row.rows[0];
}

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'Bridges & engineering marvels'`,
  );
  sourceId = source.rows[0].id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, curated_fields, metadata)
     VALUES ($1, $2, 'Q600139', 'Aqua Virgo', ST_SetSRID(ST_MakePoint($3, $4), 4326),
             '["location", "metadata.website"]', $5)`,
    [PLACE, sourceId, TREVI.lon, TREVI.lat, JSON.stringify({ website: 'https://curator.example/aqua-virgo' })],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state)
     VALUES ($1, $2, $3, 'Q600139', 'admitted', 'verified')`,
    [PLACE, source.rows[0].kind_id, sourceId],
  );
  const stored = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, external_ref, name, location, curation_state, curated_fields)
     VALUES ($1, 'Q600139', 'Vicus Caprarius, by the Trevi Fountain', ST_SetSRID(ST_MakePoint($2, $3), 4326),
             'verified', '["name", "location"]') RETURNING id`,
    [PLACE, TREVI.lon, TREVI.lat],
  );
  pointId = stored.rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('taking the source\'s value', () => {
  it('moves the place and its pin now, and writes the one metadata key it was answered for', async () => {
    const logId = await conflictRun();

    const { result, refusal } = await acceptSourceUnderLock(PLACE, userId, null, 'all', logId);

    expect(refusal).toBeUndefined();
    expect(result).toMatchObject({
      applied: ['location', 'metadata.website'], released: [], releasedPoints: [pointId], movedPoints: [pointId],
    });
    // The place and its one point move together, 12 km east, and nothing claims either coordinate.
    expect(await place()).toEqual({
      lon: SALONE.lon, lat: SALONE.lat, curated_fields: [], website: 'https://source.example/aqua-virgo',
    });
    expect(await pin()).toEqual({ lon: SALONE.lon, lat: SALONE.lat, curated_fields: ['name'] });
  });

  it('writes nothing where a newer run proposes something else', async () => {
    const logId = await conflictRun();
    await conflictRun();

    const { refusal } = await acceptSourceUnderLock(PLACE, userId, null, 'all', logId);

    expect(refusal?.error).toMatch(/newer run/);
    expect(await place()).toMatchObject({ lon: TREVI.lon, lat: TREVI.lat });
    expect(await pin()).toMatchObject({ lon: TREVI.lon, lat: TREVI.lat });
  });
});

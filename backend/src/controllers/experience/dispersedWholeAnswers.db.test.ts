import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { publishUnderLock } from './publishController.js';
import { acceptSourceUnderLock } from './acceptSourceController.js';

/**
 * A question about the point of a place that has since become a dispersed
 * whole, answered (ADR-0210, #2122), executed against PostgreSQL: the row
 * constraint `experiences_shape_holds` refuses a point on such
 * a whole, so each writer of an answer releases the coordinate rather than
 * writing it, and the card closes.
 *
 * The fixture is Białowieża Forest as migration 244 leaves it: one place of
 * two points until then, a whole of its Polish and Belarusian lines after,
 * holding a move the last World Heritage run proposed for its point before it
 * became one. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9790;
const POLAND = 9791;
const USER_UUID = '00000000-0000-4000-8000-000000009790';
const STORED = { lon: 23.8492, lat: 52.7022 };
const MOVED = { lon: 23.9811, lat: 52.7275 };

let userId = 0;
let siteMembership = 0;
/** The World Heritage source and its kind, and the source of its components' records, by name. */
let heritage = { id: 0, kind_id: 0 };
let components = 0;
const syncLogs: number[] = [];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[SITE, POLAND]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[SITE, POLAND]]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

/** The World Heritage run's proposal of the site's point, held by the gate or kept against a curator's claim. */
async function proposal(how: 'held' | 'conflict'): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [heritage.id],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields)
     VALUES ($1, $2, '9790', $3, $4)`,
    [logId, SITE, how, JSON.stringify([{
      field: 'location', old: STORED, new: MOVED, significance: 'major',
      curatedConflict: how === 'conflict', held: how === 'held',
    }])],
  );
  if (how === 'held') {
    await pool.query('UPDATE source_records SET pending_change_sync_log_id = $2 WHERE id = $1', [siteMembership, logId]);
  }
  return logId;
}

async function site(): Promise<{ shape: string; lon: number | null; curated_fields: string[]; pointer: number | null }> {
  return (await pool.query(
    `SELECT e.shape, ST_X(e.location) AS lon, e.curated_fields, m.pending_change_sync_log_id AS pointer
       FROM experiences e JOIN source_records m ON m.id = $2 WHERE e.id = $1`,
    [SITE, siteMembership],
  )).rows[0];
}

beforeAll(async () => {
  const sources = (await pool.query<{ id: number; kind_id: number | null; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name = ANY($1::text[])`,
    [['UNESCO World Heritage Sites', 'World Heritage components']],
  )).rows;
  const named = (name: string) => sources.find(source => source.name === name)!;
  heritage = { id: named('UNESCO World Heritage Sites').id, kind_id: named('UNESCO World Heritage Sites').kind_id! };
  components = named('World Heritage components').id;
});

beforeEach(async () => {
  await clear();
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [USER_UUID],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $7, '9790', 'Białowieża Forest (answers fixture)', ST_SetSRID(ST_MakePoint($2, $3), 4326)),
            ($4, $7, 'part:9791', 'Białowieża Forest (Poland) (answers fixture)', ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [SITE, STORED.lon, STORED.lat, POLAND, MOVED.lon, MOVED.lat, heritage.id],
  );
  siteMembership = (await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
     VALUES ($1, $2, $3, '9790', 'admitted', 'verified', NOW()) RETURNING id`,
    [SITE, heritage.kind_id, heritage.id],
  )).rows[0].id;
  // The Polish line becomes a part, and the site a dispersed whole with no point.
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, '9790-001')`,
    [POLAND, SITE, components],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a question about a dispersed whole's point", () => {
  it('is published by releasing the held coordinate, and the card closes', async () => {
    expect(await site()).toMatchObject({ shape: 'none', lon: null });
    const logId = await proposal('held');

    const { result, refusal } = await publishUnderLock(SITE, userId, null, {
      heldFields: ['location'], expectedSyncLogId: logId,
    });

    expect(refusal).toBeUndefined();
    expect(result?.appliedFields).toEqual([]);
    expect(await site()).toMatchObject({ shape: 'none', lon: null, pointer: null });
  });

  it("is answered with the source's value by releasing a claim the whole held from before, writing no point", async () => {
    // A claim anchorToItsPoint wrote while the site was one place of two points.
    await pool.query(`UPDATE experiences SET curated_fields = '["location"]' WHERE id = $1`, [SITE]);
    const logId = await proposal('conflict');

    const { result, refusal } = await acceptSourceUnderLock(SITE, userId, null, 'all', logId);

    expect(refusal).toBeUndefined();
    expect(result).toMatchObject({ applied: [], released: ['location'] });
    expect(await site()).toMatchObject({ shape: 'none', lon: null, curated_fields: [] });
  });

  it("takes the claim off with the point when a place becomes a dispersed whole", async () => {
    // A place of its own again, at its record's point, with a curator's claims on it.
    await pool.query(
      'UPDATE source_records SET reported_location = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE id = $1',
      [siteMembership, STORED.lon, STORED.lat],
    );
    await pool.query('DELETE FROM source_records WHERE whole_id = $1', [SITE]);
    await pool.query(`UPDATE experiences SET curated_fields = '["location", "name"]' WHERE id = $1`, [SITE]);
    expect(await site()).toMatchObject({ shape: 'point', lon: STORED.lon });
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, '9790-001')`,
      [POLAND, SITE, components],
    );
    expect(await site()).toMatchObject({ shape: 'none', lon: null, curated_fields: ['name'] });
  });
});

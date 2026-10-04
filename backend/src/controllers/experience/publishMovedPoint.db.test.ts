import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { publishUnderLock } from './publishController.js';
import { queryContents } from './reviewQueueContents.js';
import { refuseUnderLock } from './declineHeldController.js';
import { refuseContentsUnderLock } from './curatorRefusalController.js';
import { writeExperienceLocations } from '../../services/sync/locationWriter.js';

/**
 * Publishing an object's held coordinate publishes the point that is the same
 * move, and a no to it turns that point down and keeps the stored pin (#1233),
 * executed against PostgreSQL: the pairing is a join over three
 * rows and a distance, and the release that follows is the location writer's
 * own statement, so only real rows can show the two halves landing together.
 *
 * The fixture is Ephesus as run 146 left it: one stored point readers see, the
 * object's coordinate held 158 m away, and the moved point written unread,
 * naming the pin it replaces. Deleted before and after.
 */

const SITE = 9460;
const USER_UUID = '00000000-0000-4000-8000-000000009460';
const STORED = { lon: 27.340833, lat: 37.939722 };
const MOVED = { lon: 27.33939, lat: 37.94058 };

let userId = 0;
let sourceId = 0;
let storedPoint = 0;
const syncLogs: number[] = [];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

/** An unread point at `at`, replacing the stored pin, as a gated run writes a point that moved. */
async function arrival(at: { lon: number; lat: number }, ordinal = 1): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations
       (experience_id, external_ref, ordinal, location, curation_state, withdrawal_deferred_for_location_id)
     VALUES ($1, 'Q47611', $5, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'pending', $4) RETURNING id`,
    [SITE, at.lon, at.lat, storedPoint, ordinal],
  );
  return row.rows[0].id;
}

/** A run that held these fields of the object, and the pointer a card finds it by. */
async function heldRun(fields: Array<{ field: string; old: unknown; new: unknown }>): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [sourceId],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields)
     VALUES ($1, $2, 'Q47611', 'held', $3)`,
    [logId, SITE, JSON.stringify(fields.map((f) => ({ ...f, significance: 'minor', curatedConflict: false, held: true })))],
  );
  await pool.query(
    'UPDATE experience_kind_memberships SET pending_change_sync_log_id = $2 WHERE experience_id = $1',
    [SITE, logId],
  );
  return logId;
}

async function point(id: number): Promise<{ curation_state: string; missing: boolean }> {
  const row = await pool.query<{ curation_state: string; missing: boolean }>(
    'SELECT curation_state, missing_since IS NOT NULL AS missing FROM experience_locations WHERE id = $1', [id],
  );
  return row.rows[0];
}

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'Archaeology'`,
  );
  sourceId = source.rows[0].id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, 'Q47611', 'Ephesus', ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [SITE, sourceId, STORED.lon, STORED.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state)
     VALUES ($1, $2, $3, (SELECT external_id FROM experiences WHERE id = $1), 'admitted', 'verified')`,
    [SITE, source.rows[0].kind_id, sourceId],
  );
  const stored = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, external_ref, location, curation_state)
     VALUES ($1, 'Q47611', ST_SetSRID(ST_MakePoint($2, $3), 4326), 'verified') RETURNING id`,
    [SITE, STORED.lon, STORED.lat],
  );
  storedPoint = stored.rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('publishing an object\'s held coordinate', () => {
  it('publishes the point that is the same move, and releases the pin it replaces', async () => {
    const moved = await arrival(MOVED);
    const logId = await heldRun([{ field: 'location', old: STORED, new: MOVED }]);

    const { result, refusal } = await publishUnderLock(SITE, userId, null, {
      heldFields: ['location'], expectedSyncLogId: logId,
    });

    expect(refusal).toBeUndefined();
    expect(result).toMatchObject({ appliedFields: ['location'], locationsPublished: 1, withdrawalsReleased: 1 });
    // The object's coordinate and its pin moved together: the moved point is
    // one readers see, and the pin it replaced is no longer offered.
    expect(await point(moved)).toEqual({ curation_state: 'verified', missing: false });
    expect((await point(storedPoint)).missing).toBe(true);
    const at = await pool.query<{ lon: number; lat: number }>(
      'SELECT ST_X(location) AS lon, ST_Y(location) AS lat FROM experiences WHERE id = $1', [SITE],
    );
    expect(at.rows[0].lon).toBeCloseTo(MOVED.lon, 6);
    expect(at.rows[0].lat).toBeCloseTo(MOVED.lat, 6);
  });

  it('names the point the publish takes, and takes it: the nearer of two, by one rule', async () => {
    // Two arrivals within ten metres of the held coordinate are a rare double
    // write. The queue names one (coordinates_move_point_id) and the card
    // marks that row; the publish must take that same row, or the card would
    // promise one pin and move another. One SQL fragment answers both.
    const farther = await arrival({ lon: MOVED.lon + 0.00005, lat: MOVED.lat });
    const nearer = await arrival(MOVED, 2);
    const logId = await heldRun([{ field: 'location', old: STORED, new: MOVED }]);

    const admin = await pool.query<{ id: number }>('SELECT id FROM users WHERE uuid = $1', [USER_UUID]);
    const card = await queryContents({
      scopeFilter: 'TRUE', sourceFilter: '', params: [admin.rows[0].id], ids: [SITE],
      nameFilter: '', pageSize: 25, offset: 0,
    } as never);
    expect(card.rows[0].coordinates_move_point_id).toBe(nearer);
    expect(card.rows[0].pending_points[0].id).toBe(nearer);

    const { result } = await publishUnderLock(SITE, userId, null, { heldFields: ['location'], expectedSyncLogId: logId });

    expect(result).toMatchObject({ locationsPublished: 1, withdrawalsReleased: 1 });
    expect((await point(nearer)).curation_state).toBe('verified');
    expect((await point(farther)).curation_state).toBe('pending');
  });

  it('names no point on the card once a curator has claimed the coordinate', async () => {
    // A claim made after the run held the move — correcting the pin by hand —
    // makes the publish skip the coordinate and, with it, the point; the card
    // must not promise a move the publish will not make.
    await arrival(MOVED);
    await heldRun([{ field: 'location', old: STORED, new: MOVED }]);
    await pool.query(`UPDATE experiences SET curated_fields = '["location"]'::jsonb WHERE id = $1`, [SITE]);

    const admin = await pool.query<{ id: number }>('SELECT id FROM users WHERE uuid = $1', [USER_UUID]);
    const card = await queryContents({
      scopeFilter: 'TRUE', sourceFilter: '', params: [admin.rows[0].id], ids: [SITE],
      nameFilter: '', pageSize: 25, offset: 0,
    } as never);
    expect(card.rows[0].coordinates_move_point_id).toBeNull();
  });

  it('leaves a moved point alone when another field is what was published', async () => {
    const moved = await arrival(MOVED);
    const logId = await heldRun([
      { field: 'location', old: STORED, new: MOVED },
      { field: 'shortDescription', old: null, new: 'An ancient Greek city on the coast of Ionia.' },
    ]);

    const { result } = await publishUnderLock(SITE, userId, null, {
      heldFields: ['shortDescription'], expectedSyncLogId: logId,
    });

    expect(result).toMatchObject({ appliedFields: ['shortDescription'], locationsPublished: 0, withdrawalsReleased: 0 });
    expect(await point(moved)).toEqual({ curation_state: 'pending', missing: false });
    expect((await point(storedPoint)).missing).toBe(false);
  });

  it('leaves a point that moved somewhere else alone: a component\'s move is not the object\'s', async () => {
    // A serial site's own point and one of its components can both move in one
    // run. The component's arrival sits kilometres from the object's new
    // coordinate, and answering the object's coordinate says nothing about it.
    const elsewhere = await arrival({ lon: 27.40, lat: 37.98 });
    const logId = await heldRun([{ field: 'location', old: STORED, new: MOVED }]);

    const { result } = await publishUnderLock(SITE, userId, null, {
      heldFields: ['location'], expectedSyncLogId: logId,
    });

    expect(result).toMatchObject({ appliedFields: ['location'], locationsPublished: 0, withdrawalsReleased: 0 });
    expect(await point(elsewhere)).toEqual({ curation_state: 'pending', missing: false });
    expect((await point(storedPoint)).missing).toBe(false);
  });
});

/** Whether the moved point still names the pin it replaces, and whether it is turned down. */
async function pairing(id: number): Promise<{ replaces: number | null; refused: boolean }> {
  const row = await pool.query<{ replaces: number | null; refused: boolean }>(
    `SELECT withdrawal_deferred_for_location_id AS replaces, refused_at IS NOT NULL AS refused
       FROM experience_locations WHERE id = $1`, [id],
  );
  return row.rows[0];
}

/** The source offers the object's one point at `at`, as the next run would. */
const nextRun = (at: { lon: number; lat: number }) => writeExperienceLocations(
  SITE, [{ name: null, externalRef: 'Q47611', lon: at.lon, lat: at.lat }], { syncLogId: null },
);

describe('a no to an object\'s moved point', () => {
  it('turns the moved point down with the coordinate, and readers keep the stored pin', async () => {
    const moved = await arrival(MOVED);
    const logId = await heldRun([{ field: 'location', old: STORED, new: MOVED }]);

    const { result, refusal } = await refuseUnderLock(SITE, userId, null, { fields: ['location'] }, logId);

    expect(refusal).toBeUndefined();
    expect(result).toMatchObject({ declinedFields: ['location'], movedPointRefused: moved, heldLeftOpen: 0 });
    expect(await pairing(moved)).toEqual({ replaces: storedPoint, refused: true });
    expect(await point(storedPoint)).toEqual({ curation_state: 'verified', missing: false });
  });

  it('keeps the stored pin through the next run that offers the same move, and asks nothing again', async () => {
    const moved = await arrival(MOVED);
    await refuseContentsUnderLock(SITE, userId, null, { locationIds: [moved] });

    await nextRun(MOVED);

    expect(await point(storedPoint)).toEqual({ curation_state: 'verified', missing: false });
    expect(await pairing(moved)).toEqual({ replaces: storedPoint, refused: true });
    const unread = await pool.query(
      `SELECT 1 FROM experience_locations
        WHERE experience_id = $1 AND curation_state = 'pending' AND refused_at IS NULL AND missing_since IS NULL`,
      [SITE],
    );
    expect(unread.rows).toHaveLength(0);
  });

  it('asks again when the source moves the point somewhere else, the stored pin still shown', async () => {
    const moved = await arrival(MOVED);
    await refuseContentsUnderLock(SITE, userId, null, { locationIds: [moved] });

    const elsewhere = { lon: 27.3412, lat: 37.9420 };
    await nextRun(elsewhere);

    expect(await point(storedPoint)).toEqual({ curation_state: 'verified', missing: false });
    const asked = await pool.query<{ id: number; replaces: number | null }>(
      `SELECT id, withdrawal_deferred_for_location_id AS replaces FROM experience_locations
        WHERE experience_id = $1 AND curation_state = 'pending' AND refused_at IS NULL AND missing_since IS NULL`,
      [SITE],
    );
    expect(asked.rows).toEqual([{ id: expect.any(Number), replaces: storedPoint }]);
    expect(asked.rows[0].id).not.toBe(moved);
  });
});

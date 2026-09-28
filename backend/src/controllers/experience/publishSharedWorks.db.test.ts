import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, rollbackQuietly } from '../../db/index.js';
import { publishUnderLock } from './publishController.js';

/**
 * Two venues that share two works can publish at the same moment (#1095),
 * executed against PostgreSQL: the risk is two transactions locking the same
 * rows in opposite orders, which only the real locks can show.
 *
 * The fixture is two made-up galleries and two paintings on loan between them.
 * Each gallery's last run held a new year for both paintings, the first
 * gallery's record listing them in one order and the second's in the other, and
 * both paintings are still unread, so each publish writes both works twice over:
 * once as a held part, once as a pending work. Deleted before and after.
 */

const NORTH = 9450;
const SOUTH = 9451;
const USER_UUID = '00000000-0000-4000-8000-000000009450';
const WORKS = ['Q9450-harbour-at-dawn', 'Q9450-harbour-at-dusk'] as const;

let userId = 0;
let sourceId = 0;
const syncLogs: number[] = [];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[NORTH, SOUTH]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[NORTH, SOUTH]]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [[...WORKS]]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

/** A run that held a new year for both works at `venue`, listing them in `order`. */
async function heldRun(venue: number, order: readonly string[]): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [sourceId],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  const changed = order.map((ref) => ({
    item: { ref, name: ref },
    fields: [{ field: 'year', old: 1890, new: 1891, significance: 'minor', curatedConflict: false, held: true }],
  }));
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields, contents)
     VALUES ($1, $2, $3, 'held', '[]'::jsonb, $4)`,
    [logId, venue, `Q-venue-${venue}`, JSON.stringify({ treasures: { added: [], withdrawn: [], returned: [], changed } })],
  );
  await pool.query(
    'UPDATE experience_kind_memberships SET pending_change_sync_log_id = $2 WHERE experience_id = $1',
    [venue, logId],
  );
  return logId;
}

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'Art Museums'`,
  );
  sourceId = source.rows[0].id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  );
  userId = user.rows[0].id;

  for (const [venue, name] of [[NORTH, 'North Gallery'], [SOUTH, 'South Gallery']] as const) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(10, 50), 4326))`,
      [venue, sourceId, `Q-venue-${venue}`, name],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, admission, curation_state)
       VALUES ($1, $2, $3, 'admitted', 'verified')`,
      [venue, source.rows[0].kind_id, sourceId],
    );
  }
  for (const ref of WORKS) {
    const work = await pool.query<{ id: number }>(
      `INSERT INTO treasures (external_id, name, treasure_type, year, curation_state)
       VALUES ($1, $1, 'painting', 1890, 'pending') RETURNING id`,
      [ref],
    );
    await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $3, 'pending'), ($2, $3, 'pending')`,
      [NORTH, SOUTH, work.rows[0].id],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/**
 * This spec's connections name themselves, so the count below sees its own
 * publishes and never another spec's lock waits: the lane runs spec files side
 * by side, each on a pool of its own.
 */
const APPLICATION_NAME = 'publish-shared-works-spec';

/** Name every connection the pool will hand out: the publishes, the holder and the probe. */
async function nameThePool(): Promise<void> {
  const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
  for (const client of clients) {
    await client.query(`SET application_name = '${APPLICATION_NAME}'`);
    client.release();
  }
}

/** How many of this spec's connections wait on a lock over a statement that reads `treasures`. */
async function waitingOnLocks(): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND application_name = $1 AND query LIKE '%FROM treasures%'`,
    [APPLICATION_NAME],
  );
  return result.rows[0].n;
}

async function untilWaiting(n: number): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (await waitingOnLocks() >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} backends waited on a lock`);
}

describe('two venues sharing two works', () => {
  it('both publish at once, whichever order their records list the works in', async () => {
    const northLog = await heldRun(NORTH, WORKS);
    const southLog = await heldRun(SOUTH, [...WORKS].reverse());

    // The interleaving that deadlocked, made deterministic: a third connection
    // holds the first work, the North publish queues for it, the South publish
    // (its record listing the works the other way) queues behind, and the holder
    // lets go. Taking works in the record's order, South would hold the second
    // work while North, granted the first, waits for it.
    await nameThePool();
    const holder = await pool.connect();
    const started: Array<Promise<unknown>> = [];
    let committed = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM treasures WHERE external_id = $1 FOR UPDATE', [WORKS[0]]);
      const northDone = publishUnderLock(NORTH, userId, null, { expectedSyncLogId: northLog });
      started.push(northDone);
      await untilWaiting(1);
      const southDone = publishUnderLock(SOUTH, userId, null, { expectedSyncLogId: southLog });
      started.push(southDone);
      await untilWaiting(2);
      await holder.query('COMMIT');
      committed = true;

      const [north, south] = await Promise.all([northDone, southDone]);
      expect(north.refusal).toBeUndefined();
      expect(south.refusal).toBeUndefined();
    } finally {
      // On a failure before the COMMIT, the holder's lock goes first, so the
      // publishes it held up finish before the fixture is cleared under them.
      const unusable = committed ? undefined : await rollbackQuietly(holder);
      holder.release(unusable);
      await Promise.allSettled(started);
    }

    const works = await pool.query<{ year: number; curation_state: string }>(
      'SELECT year, curation_state FROM treasures WHERE external_id = ANY($1::text[]) ORDER BY external_id', [[...WORKS]],
    );
    expect(works.rows).toEqual([
      { year: 1891, curation_state: 'verified' },
      { year: 1891, curation_state: 'verified' },
    ]);
  });
});

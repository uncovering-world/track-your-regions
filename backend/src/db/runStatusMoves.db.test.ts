import { afterAll, describe, expect, it } from 'vitest';
import { IMPORT_RUN_STATUSES, RUN_STATUS_MOVES, SYNC_LOG_STATUSES, type RunTable } from '@tyr/shared/runStatuses';
import { pool } from './index.js';

/**
 * The database refuses exactly the run-status moves `@tyr/shared/runStatuses`
 * does not list (#794), executed against PostgreSQL: every pair of statuses, on
 * both tables the guard covers, is tried as a real UPDATE and its answer
 * compared with `RUN_STATUS_MOVES`. The trigger and the list are two statements
 * of one rule, and this is what holds them to each other.
 *
 * Each pair gets a fresh row inserted in its `from` status, since an insert is
 * not a move; the rows carry a marker and are deleted after.
 */

const SOURCE_ID = 1;
const MARKER = 'run-status-moves-fixture';

const STATUSES: Record<RunTable, readonly string[]> = {
  experience_sync_logs: SYNC_LOG_STATUSES,
  import_runs: IMPORT_RUN_STATUSES,
};

afterAll(async () => {
  await pool.query('DELETE FROM experience_sync_logs WHERE source_id = $1 AND detection_skipped_reason = $2', [SOURCE_ID, MARKER]);
  await pool.query('DELETE FROM import_runs WHERE source_type = $1', [MARKER]);
});

/** Insert one row of `table` in status `from`, and answer its id. */
async function rowIn(table: RunTable, from: string): Promise<number> {
  switch (table) {
    case 'experience_sync_logs': {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO experience_sync_logs (source_id, status, detection_skipped_reason)
         VALUES ($1, $2, $3) RETURNING id`,
        [SOURCE_ID, from, MARKER],
      );
      return inserted.rows[0].id;
    }
    case 'import_runs': {
      const inserted = await pool.query<{ id: number }>(
        'INSERT INTO import_runs (source_type, status) VALUES ($1, $2) RETURNING id',
        [MARKER, from],
      );
      return inserted.rows[0].id;
    }
    default: {
      const unknown: never = table;
      throw new Error(`no fixture for ${String(unknown)}`);
    }
  }
}

const cases = (Object.keys(RUN_STATUS_MOVES) as RunTable[]).flatMap(table =>
  STATUSES[table].flatMap(from =>
    STATUSES[table].filter(to => to !== from).map(to => [table, from, to] as const)));

describe('the run-status moves the database allows', () => {
  it.each(cases)('%s: %s → %s is allowed exactly when the list says so', async (table, from, to) => {
    const listed = (RUN_STATUS_MOVES[table] as readonly (readonly [string, string])[])
      .some(([f, t]) => f === from && t === to);
    const id = await rowIn(table, from);

    const update = pool.query(`UPDATE ${table} SET status = $1 WHERE id = $2`, [to, id]);
    if (listed) {
      await expect(update).resolves.toMatchObject({ rowCount: 1 });
    } else {
      await expect(update).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('refuses a NULL status: a run always says where it stands', async () => {
    await expect(pool.query(
      'INSERT INTO import_runs (source_type, status) VALUES ($1, NULL)', [MARKER],
    )).rejects.toMatchObject({ code: '23502' });
  });
});

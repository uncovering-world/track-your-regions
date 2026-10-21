import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getSyncLogs } from './syncController.js';

/**
 * The run history reads a pass as one run (ADR-0132), against PostgreSQL.
 *
 * A Public Art pass starts at 10:00 and its second source's run at 10:10;
 * a World Heritage run starts between them, at 10:05. Read newest first by
 * start, the World Heritage run would split the pass. Every run is dated in
 * 2099, so the history's newest rows are these, whatever other specs leave.
 */

const DAY = '2099-01-01';
const ids: Record<'first' | 'between' | 'second', number> = { first: 0, between: 0, second: 0 };

async function clear(): Promise<void> {
  await pool.query(`DELETE FROM experience_sync_logs WHERE started_at >= $1::timestamptz AND started_at < $1::timestamptz + interval '1 day'`, [DAY]);
}

async function run(sourceId: number, at: string, passLogId: number | null = null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, started_at, completed_at, is_dry_run, pass_log_id)
     VALUES ($1, 'success', $2::timestamptz, $2::timestamptz + interval '2 minutes', true, $3) RETURNING id`,
    [sourceId, `${DAY}T${at}:00Z`, passLogId],
  );
  return row.rows[0].id;
}

beforeEach(async () => {
  await clear();
  ids.first = await run(3, '10:00');
  ids.between = await run(1, '10:05');
  // The second source of the pass: any source but the first serves, since
  // Public Art's second kind does not exist yet (#1807).
  ids.second = await run(2, '10:10', ids.first);
});

afterAll(async () => {
  await clear();
});

describe('the run history', () => {
  it('keeps a pass\'s runs together, in the order they ran, under the pass\'s start', async () => {
    const { logs } = await getSyncLogs({ query: { limit: 10, offset: 0 } as never });
    const mine = logs.filter((log) => Object.values(ids).includes(log.id));

    expect(mine.map((log) => log.id)).toEqual([ids.between, ids.first, ids.second]);
  });

  it('names the first run of a later run\'s pass, and its source', async () => {
    const { logs } = await getSyncLogs({ query: { limit: 10, offset: 0 } as never });
    const second = logs.find((log) => log.id === ids.second);
    const first = logs.find((log) => log.id === ids.first);

    expect(second).toMatchObject({ pass_log_id: ids.first, pass_source_name: expect.stringMatching(/Public Art/) });
    expect(first).toMatchObject({ pass_log_id: null, pass_source_name: null });
  });
});

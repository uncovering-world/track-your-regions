import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { buildsWaitingFor, openRunLog } from './runInputs.js';
import { holdCopiesForReading, SWAP_LOCK, swapWhenNoRunReads, type RunsWait } from './swapGuard.js';

/**
 * The swap guard against PostgreSQL (#2415): a kept copy is swapped in only
 * while no sync run is alive and no pass holds the copies, a run's start waits
 * for a swap under way, and a row a crashed run left `running` stops holding
 * swaps back. The runs are log rows of UNESCO's source written by the case,
 * deleted before and after it; the source is looked up by its name.
 */

let UNESCO = 0;
/** The rows the spec writes, at ids pinned above the e2e fixture's 9001–9005, deleted before and after it. */
const RUN = 9_415_001;
const STARTED_RUN = 9_415_002;
const BUILD = 9_415_001;
const clear = async () => {
  await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [[RUN, STARTED_RUN]]);
  await pool.query('DELETE FROM dump_builds WHERE id = $1', [BUILD]);
};
beforeAll(async () => {
  UNESCO = (await pool.query<{ id: number }>("SELECT id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'")).rows[0].id;
});
beforeEach(clear);
afterAll(async () => {
  await clear();
  await pool.end();
});

/** A run alive now, or one whose last progress was written `minutesAgo`, at `RUN`. */
async function run(minutesAgo = 0, id: number = RUN): Promise<number> {
  await pool.query(
    `INSERT INTO experience_sync_logs (id, source_id, status, status_message, progress_at)
     VALUES ($3, $1, 'running', 'swap guard fixture', NOW() - make_interval(mins => $2))`,
    [UNESCO, minutesAgo, id],
  );
  return id;
}

const end = (id: number) => pool.query("UPDATE experience_sync_logs SET status = 'success', completed_at = NOW() WHERE id = $1", [id]);

/** A swap that records what it was told, and is cancelled the first time it is told to wait. */
function cancelledOnWait(): { options: Parameters<typeof swapWhenNoRunReads>[0]; told: Array<RunsWait | null> } {
  const controller = new AbortController();
  const told: Array<RunsWait | null> = [];
  return {
    told,
    options: {
      signal: controller.signal,
      askEveryMs: 10,
      onWaitForRuns: wait => {
        told.push(wait);
        if (wait) controller.abort(new Error('Cancelled.'));
      },
    },
  };
}

describe('a swap and a run (#2415)', () => {
  it('swaps at once when no run is alive, and passes over a run that stopped writing its progress', async () => {
    await run(10);
    const { options, told } = cancelledOnWait();
    expect(await swapWhenNoRunReads(options, async () => 'swapped')).toBe('swapped');
    expect(told).toEqual([null]);
  });

  it('waits while a run is alive, says which, and ends the wait with the cancel\'s own reason', async () => {
    const id = await run();
    const { options, told } = cancelledOnWait();
    let swaps = 0;
    await expect(swapWhenNoRunReads(options, async () => { swaps += 1; })).rejects.toThrow('Cancelled.');
    expect(swaps).toBe(0);
    expect(told).toEqual([{ runs: [{ logId: id, source: expect.any(String), dryRun: false }] }]);
    await end(id);
  });

  it('waits while a pass holds the copies between two of its kinds, with no row alive', async () => {
    const release = await holdCopiesForReading();
    const { options, told } = cancelledOnWait();
    await expect(swapWhenNoRunReads(options, async () => 'swapped')).rejects.toThrow('Cancelled.');
    expect(told).toEqual([{ runs: [] }]);
    await release();
  });

  it("writes a run's row only once the swap under way ends, with the copies it reads", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let swapping!: () => void;
    const inSwap = new Promise<void>(resolve => { swapping = resolve; });
    const swap = swapWhenNoRunReads({ signal: new AbortController().signal }, () => { swapping(); return held; });
    // The run starts only once the swap holds the lock alone, so the order is the one asserted.
    await inSwap;
    let started = false;
    const start = openRunLog(async client => {
      const result = await client.query<{ id: number }>(
        "INSERT INTO experience_sync_logs (id, source_id, status, status_message) VALUES ($2, $1, 'running', 'swap guard fixture') RETURNING id",
        [UNESCO, STARTED_RUN],
      );
      started = true;
      return result.rows[0].id;
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(started).toBe(false);
    release();
    await swap;
    const id = await start;
    const row = (await pool.query('SELECT copies_read FROM experience_sync_logs WHERE id = $1', [id])).rows[0];
    expect(row.copies_read).toEqual(expect.any(Object));
    // Nothing holds the lock once both are done; asked and let go on one client, as a session lock must be.
    const client = await pool.connect();
    try {
      const free = await client.query<{ taken: boolean }>('SELECT pg_try_advisory_lock($1) AS taken', [SWAP_LOCK]);
      expect(free.rows[0].taken).toBe(true);
      await client.query('SELECT pg_advisory_unlock($1)', [SWAP_LOCK]);
    } finally {
      client.release();
    }
  });

  it('names the copies whose swap waits for a run, by their title', async () => {
    const id = await run();
    await pool.query(
      `INSERT INTO dump_builds (id, dump, mode, status, request, runner, progress, started_at, heartbeat_at)
       VALUES ($2, 'wikidata-redirects', 'local', 'running', '{"kind":"keep"}', 'worker:swap-guard', $1, NOW(), NOW())`,
      [JSON.stringify({ phase: 'reading', message: 'Waiting', downloaded: 0, read: 0, lines: 0, etaSeconds: null, waitsFor: [{ logId: id, source: 'UNESCO', dryRun: false }] }), BUILD],
    );
    expect(await buildsWaitingFor(id)).toEqual(['The items Wikidata redirected to another']);
    expect(await buildsWaitingFor(id + 1)).toEqual([]);
  });
});

/**
 * The copies a sync run reads, named on its log row as it starts (#2415): the
 * dump date of every copy built from a dump that is in place then, so two runs
 * compared main against a branch can be seen to stand on the same inputs, and
 * a comparison across a swap shows as one.
 *
 * The row is written holding the swap lock shared (`swapGuard.ts`), so no copy
 * is swapped in between the dates read here and the run's start: a swap under
 * way is waited for, and one that comes after sees the run and waits for it.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { DUMPS, dumpNamed } from './catalog.js';
import { keeperOf } from './keepers.js';
import { underReadLock } from './swapGuard.js';

/**
 * Each kept copy a run reads, by its dump date, and after a `#` its revision
 * where its dump date alone does not tell two states of it apart (readership's
 * folds, `Kept.revision`); a copy not built yet is left out, and so is one no
 * run reads (`readByRuns: false`), whose swap waits for nothing.
 */
export async function copiesInPlace(): Promise<Record<string, string>> {
  const copies: Record<string, string> = {};
  for (const dump of DUMPS) {
    const keeper = keeperOf(dump.key);
    if (keeper?.readByRuns === false) continue;
    const kept = await keeper?.latest();
    if (kept) copies[dump.key] = kept.revision ? `${kept.dumpDate}#${kept.revision}` : kept.dumpDate;
  }
  return copies;
}

/**
 * The copies whose swap waits for the run of `logId` to end, by their keeper's
 * title (#2415): a long pass then reads as what a build waits for, and the
 * build does not read as stuck.
 */
export async function buildsWaitingFor(logId: number): Promise<string[]> {
  const result = await pool.query<{ dump: string }>(
    `SELECT dump FROM dump_builds WHERE status = 'running' AND progress->'waitsFor' @> $1::jsonb ORDER BY dump`,
    [JSON.stringify([{ logId }])],
  );
  return result.rows.map(row => {
    const descriptor = dumpNamed(row.dump);
    return (descriptor && keeperOf(descriptor.key)?.title) ?? row.dump;
  });
}

/**
 * Write a run's log row with `insert`, holding the swap lock, and name on it
 * the copies the run will read. Answers the row's id. The row and its copies
 * are one transaction: a row written without them would stand `running` with
 * no run behind it, holding swaps back until it went stale.
 */
export function openRunLog(insert: (client: PoolClient) => Promise<number>): Promise<number> {
  return underReadLock(async (client, discard) => {
    try {
      await client.query('BEGIN');
      const id = await insert(client);
      await client.query('UPDATE experience_sync_logs SET copies_read = $2 WHERE id = $1', [id, JSON.stringify(await copiesInPlace())]);
      await client.query('COMMIT');
      return id;
    } catch (error) {
      // A client whose ROLLBACK failed may still hold the transaction open: it never goes back to the pool.
      const failed = await rollbackQuietly(client);
      if (failed) discard(failed);
      throw error;
    }
  });
}

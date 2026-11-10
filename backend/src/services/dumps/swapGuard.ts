/**
 * A kept copy is swapped in only while no sync run or dry run reads it
 * (#2415). A run reads the copies as they stood when it started; a copy
 * swapped in under it would leave the run's first half and its second half
 * on two dumps. Two runs compared main against a branch (a calibration)
 * would then not stand on the same inputs either.
 *
 * The sides meet on one advisory lock, `SWAP_LOCK`:
 * - **a swap** takes it alone (`pg_try_advisory_lock`), and swaps only where
 *   no run is alive besides; otherwise it lets it go and waits;
 * - **a pass** holds it shared for as long as it runs (`holdCopiesForReading`,
 *   `syncPass.ts`), so no swap lands between one kind's run and the next's;
 * - **a run's start** takes it shared while it writes its log row and the dump
 *   dates of the copies it is about to read (`runInputs.ts`), so no run starts
 *   in the middle of a swap.
 *
 * A run outside a pass holds no lock once started: its row says it is alive,
 * while it is `running` and its progress was written in the last five minutes
 * (`syncProgressWriter.ts` writes it every 15 seconds at least). A row a
 * crashed process left `running` stops counting then, and a crashed pass's
 * lock goes with its connection.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';

/** The session lock a swap and a run's start both take: one key, the project's own. */
export const SWAP_LOCK = 2_415_001;

/** How often a waiting swap asks again whether the runs have ended. */
const ASK_EVERY_MS = 30_000;

/** A run a swap waits for: its log, the source it fills, and whether it is a dry run. */
export interface AliveRun {
  logId: number;
  source: string;
  dryRun: boolean;
}

/** What a swap waits for: the runs alive, which a pass between two of its kinds has none of. */
export interface RunsWait {
  runs: AliveRun[];
}

export interface QuietOptions {
  signal: AbortSignal;
  /** Told what a swap waits for each time it asks, and null once it swaps. */
  onWaitForRuns?: (wait: RunsWait | null) => void;
  /** How often a waiting swap asks again; `ASK_EVERY_MS` unless a spec needs it shorter. */
  askEveryMs?: number;
}

async function aliveRuns(client: PoolClient): Promise<AliveRun[]> {
  const result = await client.query<{ id: number; name: string; is_dry_run: boolean }>(
    `SELECT l.id, s.name, l.is_dry_run
       FROM experience_sync_logs l JOIN experience_sources s ON s.id = l.source_id
      WHERE l.status = 'running' AND COALESCE(l.progress_at, l.started_at) > NOW() - interval '5 minutes'
      ORDER BY l.started_at`,
  );
  return result.rows.map(row => ({ logId: row.id, source: row.name, dryRun: row.is_dry_run }));
}

/** Let the lock go on `client`, and close the client where that fails: a session lock outlives its query. */
async function unlock(client: PoolClient, shared: boolean): Promise<boolean> {
  const call = shared ? 'pg_advisory_unlock_shared' : 'pg_advisory_unlock';
  return client.query(`SELECT ${call}($1)`, [SWAP_LOCK]).then(() => true, () => false);
}

/**
 * Hold the lock shared on a client of its own until the answer is called: what
 * a pass does for as long as it runs, so no swap lands between its kinds. A
 * swap under way is waited for first.
 */
export async function holdCopiesForReading(): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock_shared($1)', [SWAP_LOCK]);
  } catch (error) {
    client.release(true);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    client.release(!await unlock(client, true));
  };
}

/** Run `work` holding the lock shared: a run's start, which waits for a swap under way. */
export async function underReadLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let unlocked = true;
  try {
    await client.query('SELECT pg_advisory_lock_shared($1)', [SWAP_LOCK]);
    try {
      return await work(client);
    } finally {
      unlocked = await unlock(client, true);
    }
  } finally {
    client.release(!unlocked);
  }
}

/**
 * Swap in once no run reads the copies: `swap` runs holding the lock alone, so
 * no run starts and no pass goes on while it does. While a pass holds the lock
 * or a run is alive, the lock is let go and the swap asks again every 30
 * seconds; a cancel ends the wait with the cancel's own reason.
 */
export async function swapWhenNoRunReads<T>(options: QuietOptions, swap: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    for (;;) {
      options.signal.throwIfAborted();
      const taken = await client.query<{ taken: boolean }>('SELECT pg_try_advisory_lock($1) AS taken', [SWAP_LOCK]);
      let runs: AliveRun[] = [];
      if (taken.rows[0]?.taken) {
        try {
          runs = await aliveRuns(client);
          if (runs.length === 0) {
            options.onWaitForRuns?.(null);
            return await swap();
          }
        } finally {
          if (!await unlock(client, false)) broken = true;
        }
      } else {
        runs = await aliveRuns(client);
      }
      if (broken) throw new Error('The swap could not let its lock go, so it stops rather than hold it');
      options.onWaitForRuns?.({ runs });
      await sleep(options.askEveryMs ?? ASK_EVERY_MS, undefined, { signal: options.signal }).catch((error: unknown) => {
        options.signal.throwIfAborted();
        throw error;
      });
    }
  } finally {
    client.release(broken);
  }
}

/** What a build waiting for runs says on its row: which runs, by source, or the pass between two of its kinds. */
export function waitWords(runs: readonly AliveRun[]): string {
  if (runs.length === 0) return 'Waiting to swap in until the sync pass in progress ends: a run reads the copy as it started';
  const named = runs.map(run => `${run.source}${run.dryRun ? ' (a dry run)' : ''}`);
  const list = named.length > 2 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named.join(' and ');
  return `Waiting to swap in until the run of ${list} ${runs.length > 1 ? 'end' : 'ends'}: a run reads the copy as it started`;
}

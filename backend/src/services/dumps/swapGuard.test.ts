import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The swap guard's loop (#2415), with the pool mocked: a swap that cannot take
 * the lock alone (a pass holds it) or finds a run alive asks again, letting the
 * lock go each time it took it, and swaps once neither holds; a cancel ends the
 * wait with its own reason; a client that cannot let the lock go is closed, not
 * handed back. `swapGuard.db.test.ts` holds the same against PostgreSQL.
 */

const db = vi.hoisted(() => {
  const taken: boolean[] = [];
  const alive: Array<Array<{ id: number; name: string; is_dry_run: boolean }>> = [];
  const calls: string[] = [];
  const release = vi.fn();
  let unlockFails = false;
  const client = {
    query: vi.fn(async (sql: string) => {
      const call = /pg_\w+/.exec(sql)?.[0];
      if (call) calls.push(call);
      if (call === 'pg_advisory_unlock' && unlockFails) throw new Error('connection lost');
      if (call === 'pg_try_advisory_lock') return { rows: [{ taken: taken.shift() ?? true }] };
      if (sql.includes('FROM experience_sync_logs')) return { rows: alive.shift() ?? [] };
      return { rows: [] };
    }),
    release,
  };
  return { taken, alive, calls, release, client, failUnlock: () => { unlockFails = true; } };
});
vi.mock('../../db/index.js', () => ({ pool: { connect: vi.fn(async () => db.client) } }));

const { swapWhenNoRunReads, waitWords } = await import('./swapGuard.js');

beforeEach(() => {
  db.taken.length = 0;
  db.alive.length = 0;
  db.calls.length = 0;
  db.release.mockClear();
});

describe('a swap waiting for the runs that read the copy (#2415)', () => {
  it('asks again while a pass holds the lock or a run is alive, and swaps once neither does', async () => {
    // A pass holds the lock; then the lock is free but a dry run is alive; then both have ended.
    db.taken.push(false, true, true);
    db.alive.push([], [{ id: 851, name: 'Public art', is_dry_run: true }], []);
    const told: unknown[] = [];
    const swap = vi.fn(async () => 'swapped');
    await expect(swapWhenNoRunReads({ signal: new AbortController().signal, onWaitForRuns: wait => told.push(wait), askEveryMs: 1 }, swap))
      .resolves.toBe('swapped');
    expect(swap).toHaveBeenCalledTimes(1);
    expect(told).toEqual([{ runs: [] }, { runs: [{ logId: 851, source: 'Public art', dryRun: true }] }, null]);
    expect(db.calls).toEqual([
      'pg_try_advisory_lock', 'pg_try_advisory_lock', 'pg_advisory_unlock', 'pg_try_advisory_lock', 'pg_advisory_unlock',
    ]);
  });

  it("ends a wait with the cancel's own reason", async () => {
    db.taken.push(false);
    const controller = new AbortController();
    const waiting = swapWhenNoRunReads({ signal: controller.signal, askEveryMs: 60_000, onWaitForRuns: () => controller.abort(new Error('Cancelled.')) },
      async () => 'swapped');
    await expect(waiting).rejects.toThrow('Cancelled.');
  });

  it('closes a client that could not let the lock go, rather than hand it back holding it', async () => {
    db.failUnlock();
    await swapWhenNoRunReads({ signal: new AbortController().signal }, async () => undefined);
    expect(db.release).toHaveBeenCalledWith(true);
  });

  it('says which runs a build waits for, by source, or the pass between two of its kinds', () => {
    expect(waitWords([{ logId: 1, source: 'Public art', dryRun: false }]))
      .toBe('Waiting to swap in until the run of Public art ends: a run reads the copy as it started');
    expect(waitWords([
      { logId: 1, source: 'Public art', dryRun: true }, { logId: 2, source: 'Towers', dryRun: true }, { logId: 3, source: 'Bridges', dryRun: false },
    ])).toBe('Waiting to swap in until the run of Public art (a dry run), Towers (a dry run) and Bridges end: a run reads the copy as it started');
    expect(waitWords([])).toBe('Waiting to swap in until the sync pass in progress ends: a run reads the copy as it started');
  });
});

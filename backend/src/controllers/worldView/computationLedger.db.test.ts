import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { Operation } from '../../services/operationProgress.js';
import {
  beatComputation, claimNextComputation, closeComputation, closeOrphanedComputations, ComputationAlreadyRunning,
  enqueueComputation, failComputationsOf, requestComputationCancel, shownComputationOf, type ComputationProgressRecord,
} from './computationLedger.js';

/**
 * The ledger of a world view's geometry computations against PostgreSQL
 * (#1658, ADR-0122): a computation is queued, taken by one worker, followed
 * through its heartbeat, stopped through its row and closed with its outcome;
 * at most one computation of a world view is queued or running; one whose
 * process stopped is closed as failed. The cases run on two world views of
 * their own, removed afterwards with their rows.
 */

let first = 0;
let second = 0;

beforeAll(async () => {
  const made = await pool.query<{ id: number }>(
    "INSERT INTO world_views (name) VALUES ('Fixture computation ledger A'), ('Fixture computation ledger B') RETURNING id",
  );
  [first, second] = made.rows.map(r => r.id);
});

const clear = () => pool.query('DELETE FROM geometry_computations WHERE world_view_id = ANY($1::int[])', [[first, second]]);
beforeEach(clear);
afterAll(async () => {
  await pool.query('DELETE FROM world_views WHERE id = ANY($1::int[])', [[first, second]]);
  await pool.end();
});

const row = async (id: number) => (await pool.query('SELECT * FROM geometry_computations WHERE id = $1', [id])).rows[0];
const request = { force: false, skipSnapping: false, regions: 4, startedBy: null };
const progress = (): ComputationProgressRecord => ({
  progress: 1, total: 4, computed: 1, skipped: 0, errors: 0, status: 'Computing: Adygea [depth 2]', currentGroup: 'Adygea',
  operation: new Operation('[Fixture]', 2, () => {}).progress,
});

/** A computation queued and taken by `runner`, as the worker takes one. */
async function running(worldViewId: number, runner = 'worker:fixture'): Promise<number> {
  await enqueueComputation(worldViewId, request);
  const claimed = await claimNextComputation(runner);
  return claimed!.id;
}

describe("a world view's geometry computation ledger (ADR-0122)", () => {
  it('queues a computation with what was asked for, and refuses a second one of the same world view', async () => {
    const id = await enqueueComputation(first, { ...request, force: true });
    expect(await row(id)).toMatchObject({ status: 'queued', force: true, skip_snapping: false, regions: 4, runner: null });
    await expect(enqueueComputation(first, request)).rejects.toBeInstanceOf(ComputationAlreadyRunning);
    // Another world view has a slot of its own.
    await expect(enqueueComputation(second, request)).resolves.toBeGreaterThan(id);
  });

  it('hands the oldest queued computation to one worker, and none twice', async () => {
    const a = await enqueueComputation(first, request);
    const b = await enqueueComputation(second, request);
    const [one, two, three] = await Promise.all([
      claimNextComputation('worker:one'), claimNextComputation('worker:two'), claimNextComputation('worker:three'),
    ]);
    const taken = [one, two, three].filter(Boolean).map(c => c!.id).sort((x, y) => x - y);
    expect(taken).toEqual([a, b]);
    expect(await row(a)).toMatchObject({ status: 'running' });
    expect((await row(a)).started_at).not.toBeNull();
  });

  it("writes the running computation's progress with its heartbeat and answers an admin's cancel", async () => {
    const id = await running(first);
    expect(await beatComputation(id, progress())).toEqual({ cancelRequested: false });
    expect((await row(id)).progress).toMatchObject({ progress: 1, currentGroup: 'Adygea' });

    expect(await requestComputationCancel(first)).toBe(true);
    // A running one is told, and stays running until the worker stops it.
    expect(await row(id)).toMatchObject({ status: 'running' });
    expect(await beatComputation(id, progress())).toEqual({ cancelRequested: true });
  });

  it('closes a queued computation at once when it is cancelled, and answers whether there was one', async () => {
    const id = await enqueueComputation(first, request);
    expect(await requestComputationCancel(first)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'cancelled', error: 'Cancelled.' });
    expect(await requestComputationCancel(first)).toBe(false);
  });

  it('shows the live computation, then the last one for a short while after it ended, then none', async () => {
    expect(await shownComputationOf(first)).toBeNull();
    const id = await running(first);
    expect(await shownComputationOf(first)).toMatchObject({ id, status: 'running', stale: false });
    await pool.query("UPDATE geometry_computations SET heartbeat_at = NOW() - interval '6 minutes' WHERE id = $1", [id]);
    expect(await shownComputationOf(first)).toMatchObject({ id, status: 'running', stale: true });

    await closeComputation(id, { status: 'success', progress: progress(), outcome: '1 computed, 0 skipped, 0 errors', error: null });
    expect(await shownComputationOf(first)).toMatchObject({ id, status: 'success', outcome: '1 computed, 0 skipped, 0 errors' });

    await pool.query("UPDATE geometry_computations SET finished_at = NOW() - interval '1 minute' WHERE id = $1", [id]);
    expect(await shownComputationOf(first)).toBeNull();
    // Its slot is free again.
    await expect(enqueueComputation(first, request)).resolves.toBeGreaterThan(id);
  });

  it('closes what a stopped process left running: its own runner at once, any other once it stops beating', async () => {
    const mine = await running(first, 'worker:fixture');
    const other = await running(second, 'worker:elsewhere');
    expect(await closeOrphanedComputations({ runner: 'worker:fixture' })).toBe(1);
    expect(await row(mine)).toMatchObject({ status: 'failed' });
    expect((await row(mine)).error).toContain('Start it again');
    expect(await row(other)).toMatchObject({ status: 'running' });

    await pool.query("UPDATE geometry_computations SET heartbeat_at = NOW() - interval '6 minutes' WHERE id = $1", [other]);
    expect(await closeOrphanedComputations()).toBe(1);
    expect(await row(other)).toMatchObject({ status: 'failed' });
  });

  it('leaves a queued computation for a worker to take', async () => {
    const id = await enqueueComputation(first, request);
    expect(await closeOrphanedComputations({ runner: 'worker:fixture' })).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'queued' });
  });

  it("closes a runner's computations with the reason the worker ended", async () => {
    const id = await running(first, 'worker:fixture');
    const why = 'The dump worker ended on an uncaught exception; its log has the cause. Start the computation again.';
    expect(await failComputationsOf('worker:fixture', why)).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'failed', error: why });
  });
});

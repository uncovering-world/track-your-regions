import { describe, expect, it, vi } from 'vitest';

/**
 * The dump worker's look for a scheduled update (ADR-0134 decision 6) and its
 * background check of the newest dumps (#2353), with the schedule, the ledger
 * and the check stood in.
 */

const schedule = vi.hoisted(() => ({ queueScheduledUpdate: vi.fn() }));
vi.mock('./osm/layerSchedule.js', () => schedule);
const newest = vi.hoisted(() => ({ askDueDumps: vi.fn(async () => undefined) }));
vi.mock('./newestOnHost.js', () => newest);
vi.mock('./buildRun.js', () => ({ runBuild: vi.fn() }));
vi.mock('./ledger.js', async () => {
  class BuildAlreadyRunning extends Error {}
  return { BuildAlreadyRunning, claimNextBuild: vi.fn(), closeOrphanedBuilds: vi.fn() };
});

const { newestLoop, queueWhatIsDue } = await import('./dumpWorker.js');
const { BuildAlreadyRunning } = await import('./ledger.js');

describe('queueWhatIsDue', () => {
  it('queues the scheduled update the schedule makes due, and says so', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    schedule.queueScheduledUpdate.mockResolvedValueOnce(42);
    await queueWhatIsDue(new AbortController().signal);
    expect(log).toHaveBeenCalledWith("[Dumps] Queued build 42: the OpenStreetMap layer's scheduled update");
    expect(schedule.queueScheduledUpdate).toHaveBeenCalledWith(expect.any(AbortSignal));
    log.mockRestore();
  });

  it('takes a build an admin queued meanwhile as no error, and logs any other', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    schedule.queueScheduledUpdate.mockRejectedValueOnce(new BuildAlreadyRunning('osm-planet'));
    await queueWhatIsDue(new AbortController().signal);
    expect(error).not.toHaveBeenCalled();
    schedule.queueScheduledUpdate.mockRejectedValueOnce(new Error('the database went away'));
    await queueWhatIsDue(new AbortController().signal);
    expect(error).toHaveBeenCalledWith('[Dumps] Could not queue the scheduled update:', expect.any(Error));
    error.mockRestore();
  });
});

describe('newestLoop', () => {
  it('learns the newest dumps at once, again at each interval, and stops when the worker does', async () => {
    newest.askDueDumps.mockClear();
    const stop = new AbortController();
    const loop = newestLoop(stop.signal, 20);
    await vi.waitFor(() => expect(newest.askDueDumps.mock.calls.length).toBeGreaterThanOrEqual(2));
    stop.abort();
    await loop;
    const asked = newest.askDueDumps.mock.calls.length;
    await new Promise(r => setTimeout(r, 60));
    expect(newest.askDueDumps).toHaveBeenCalledTimes(asked);
  });

  it('logs a check that failed and keeps going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    newest.askDueDumps.mockClear();
    newest.askDueDumps.mockRejectedValueOnce(new Error('the database went away'));
    const stop = new AbortController();
    const loop = newestLoop(stop.signal, 20);
    await vi.waitFor(() => expect(newest.askDueDumps.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(error).toHaveBeenCalledWith('[Dumps] The worker could not learn the newest dumps:', expect.any(Error));
    stop.abort();
    await loop;
    error.mockRestore();
  });
});

import { describe, expect, it, vi } from 'vitest';

/**
 * The dump worker's look for the scheduled builds (ADR-0195) and its
 * background check of the newest dumps (#2353), with the schedules, the
 * ledger and the check stood in.
 */

const schedule = vi.hoisted(() => ({ queueDueCopies: vi.fn() }));
vi.mock('./scheduledCopies.js', () => schedule);
const newest = vi.hoisted(() => ({ askDueDumps: vi.fn(async () => undefined) }));
vi.mock('./newestOnHost.js', () => newest);
vi.mock('./buildRun.js', () => ({ runBuild: vi.fn() }));
vi.mock('./ledger.js', () => ({ claimNextBuild: vi.fn(), closeOrphanedBuilds: vi.fn() }));

const { newestLoop, queueWhatIsDue } = await import('./dumpWorker.js');

describe('queueWhatIsDue', () => {
  it('queues the builds the schedules make due, and says each', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    schedule.queueDueCopies.mockResolvedValueOnce([{ dump: 'osm-planet', id: 42 }, { dump: 'enwiki-page', id: 43 }]);
    await queueWhatIsDue(new AbortController().signal);
    expect(log).toHaveBeenCalledWith('[Dumps] Queued build 42: the scheduled build of osm-planet');
    expect(log).toHaveBeenCalledWith('[Dumps] Queued build 43: the scheduled build of enwiki-page');
    expect(schedule.queueDueCopies).toHaveBeenCalledWith(expect.any(AbortSignal));
    log.mockRestore();
  });

  it('logs a look that failed, and the next look tries again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    schedule.queueDueCopies.mockRejectedValueOnce(new Error('the database went away'));
    await queueWhatIsDue(new AbortController().signal);
    expect(error).toHaveBeenCalledWith('[Dumps] Could not queue the scheduled builds:', expect.any(Error));
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

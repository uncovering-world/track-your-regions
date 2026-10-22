import { describe, expect, it, vi } from 'vitest';

/** The dump worker's look for a scheduled update (ADR-0134 decision 6), with the schedule and the ledger stood in. */

const schedule = vi.hoisted(() => ({ queueScheduledUpdate: vi.fn() }));
vi.mock('./osm/layerSchedule.js', () => schedule);
vi.mock('./buildRun.js', () => ({ runBuild: vi.fn() }));
vi.mock('./ledger.js', async () => {
  class BuildAlreadyRunning extends Error {}
  return { BuildAlreadyRunning, claimNextBuild: vi.fn(), closeOrphanedBuilds: vi.fn() };
});

const { queueWhatIsDue } = await import('./dumpWorker.js');
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

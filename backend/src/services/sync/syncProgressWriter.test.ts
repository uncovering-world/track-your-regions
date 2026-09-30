/**
 * Tests for when a running run writes its progress to its log row (#1131):
 * at once when asked, on a change of phase, not more than once per gap while
 * its figures move, on a heartbeat while they do not, one write at a time with
 * the newest waiting, never after it is closed, and never with a throw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./syncUtils.js', () => ({
  writeSyncLogProgress: vi.fn().mockResolvedValue(true),
}));

import { writeSyncLogProgress } from './syncUtils.js';
import { startProgressWriter, type ProgressWriter } from './syncProgressWriter.js';
import type { SyncProgress } from './types.js';

const write = writeSyncLogProgress as ReturnType<typeof vi.fn>;

function makeProgress(overrides: Partial<SyncProgress>): SyncProgress {
  return {
    cancel: false, kind: 'sync', status: 'processing', statusMessage: '', progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0, filtered: 0,
    errors: 0, currentItem: '', logId: null, dryRun: false,
    ...overrides,
  };
}

/** Let the promise callbacks a tick started run to their end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('startProgressWriter', () => {
  let progress: SyncProgress;
  let writer: ProgressWriter | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    write.mockReset();
    write.mockResolvedValue(true);
    progress = makeProgress({ status: 'fetching', statusMessage: 'Initializing...', total: 0, logId: 42 });
  });

  afterEach(async () => {
    await writer?.close();
    writer = undefined;
    vi.useRealTimers();
  });

  it('writes nothing for a run that has no row yet', async () => {
    progress.logId = null;
    writer = startProgressWriter(progress);

    await writer.flush(true);
    await vi.advanceTimersByTimeAsync(20000);

    expect(write).not.toHaveBeenCalled();
  });

  it('writes where the run stands when asked, with the phase and every running count', async () => {
    progress.held = 3;
    writer = startProgressWriter(progress);

    await writer.flush(true);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(42, {
      phase: 'fetching', statusMessage: 'Initializing...', currentItem: '', done: 0, total: 0,
      created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 3, filtered: 0, errors: 0,
    });
  });

  it('writes moving figures at most once per gap', async () => {
    writer = startProgressWriter(progress);
    await writer.flush(true);

    Object.assign(progress, { status: 'processing', total: 10 });
    await vi.advanceTimersByTimeAsync(1000);
    // A change of phase is written at the next tick, whatever the gap.
    expect(write).toHaveBeenCalledTimes(2);

    progress.progress = 1;
    await vi.advanceTimersByTimeAsync(1000);
    // One second after the last write: the figures moved, the gap has not passed.
    expect(write).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenLastCalledWith(42, expect.objectContaining({ phase: 'processing', done: 1, total: 10 }));
  });

  it('writes again on the heartbeat while nothing moves, so the row says the run is alive', async () => {
    writer = startProgressWriter(progress);
    await writer.flush(true);

    await vi.advanceTimersByTimeAsync(14000);
    expect(write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('keeps one write in flight, and writes the newest of what waited behind it', async () => {
    let finish: (value: boolean) => void = () => {};
    write.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    writer = startProgressWriter(progress);

    const first = writer.flush(true);
    progress.progress = 1;
    writer.flush(true);
    progress.progress = 2;
    writer.flush(true);
    expect(write).toHaveBeenCalledTimes(1);

    finish(true);
    await first;

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(42, expect.objectContaining({ done: 2 }));
  });

  it('logs a failed write and keeps writing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    write.mockRejectedValueOnce(new Error('connection reset'));
    writer = startProgressWriter(progress);

    await expect(writer.flush(true)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.any(String), '[Sync]', 42, 'connection reset');

    progress.statusMessage = 'Collecting museums...';
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it('writes nothing for a run that has ended', async () => {
    progress.status = 'complete';
    writer = startProgressWriter(progress);

    await writer.flush(true);
    await vi.advanceTimersByTimeAsync(20000);

    expect(write).not.toHaveBeenCalled();
  });

  it('once closed, writes the figures as they stand after the write in flight, and nothing more', async () => {
    let finish: (value: boolean) => void = () => {};
    write.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    writer = startProgressWriter(progress);

    writer.flush(true);
    progress.progress = 5;
    writer.flush(true);

    let closed = false;
    const closing = writer.close().then(() => { closed = true; });
    await settle();
    // The write in flight is not over, so neither is the close.
    expect(closed).toBe(false);

    finish(true);
    await closing;
    // The close's own last word: the figures at the close, not the last tick's.
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][1]).toMatchObject({ done: 5 });

    progress.progress = 9;
    await writer.flush(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(write).toHaveBeenCalledTimes(2);
  });
});

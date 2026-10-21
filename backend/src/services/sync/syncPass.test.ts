/**
 * Tests for a pass (ADR-0132): sources run one after another from one gather,
 * each registered before the first starts, a Cancel stops the ones still
 * waiting, and a run that fails for its own reason leaves the next to run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSyncPass, sharedGather, passIsRunning, type PassMember } from './syncPass.js';
import type { PassSlot } from './syncOrchestrator.js';
import { runningSyncs } from './types.js';
import { makeProgress } from './syncOrchestrator.fixtures.js';

/** A source whose run stands in for `orchestrateSync`: it takes up its slot and closes it. */
function member(
  sourceId: number, logId: number, during?: (slot: PassSlot) => Promise<void> | void,
): PassMember & { slots: PassSlot[] } {
  const slots: PassSlot[] = [];
  return {
    sourceId,
    logPrefix: `[Source ${sourceId}]`,
    slots,
    run: vi.fn(async (_by, _options, slot: PassSlot) => {
      slots.push({ ...slot });
      slot.progress.logId = logId;
      slot.progress.status = 'processing';
      await during?.(slot);
      if (slot.progress.cancel) {
        slot.progress.status = 'cancelled';
        throw new Error('Sync cancelled');
      }
      slot.progress.status = 'complete';
    }),
  };
}

describe('runSyncPass', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runningSyncs.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    runningSyncs.clear();
  });

  it('runs every source in order, each naming the first run\'s log', async () => {
    const first = member(3, 101);
    const second = member(6, 102);

    await runSyncPass([first, second], 1, { dryRun: true });

    expect(first.slots[0].firstLogId).toBeNull();
    expect(second.slots[0].firstLogId).toBe(101);
    expect(vi.mocked(first.run).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(second.run).mock.invocationCallOrder[0]);
    expect(first.run).toHaveBeenCalledWith(1, { dryRun: true }, expect.anything());
  });

  it('registers every source before the first starts, the later ones waiting', async () => {
    let seenSecond: ReturnType<typeof runningSyncs.get>;
    let whileFirstRan: { status?: string; statusMessage?: string } = {};
    const first = member(3, 101, () => {
      seenSecond = runningSyncs.get(6);
      whileFirstRan = { status: seenSecond?.status, statusMessage: seenSecond?.statusMessage };
    });
    const second = member(6, 102);

    await runSyncPass([first, second], null);

    expect(whileFirstRan.status).toBe('fetching');
    expect(whileFirstRan.statusMessage).toMatch(/Waiting/);
    expect(seenSecond?.passSources).toEqual([3, 6]);
    // The waiting entry is the one the second run took up, not a replacement.
    expect(second.slots[0].progress).toBe(seenSecond);
  });

  it('closes a waiting source as cancelled when the pass is cancelled before its turn', async () => {
    const first = member(3, 101, () => {
      // A Cancel reaches every source of the pass (`cancelSync`).
      for (const id of [3, 6]) (runningSyncs.get(id) as NonNullable<ReturnType<typeof runningSyncs.get>>).cancel = true;
    });
    const second = member(6, 102);

    await expect(runSyncPass([first, second], null)).rejects.toThrow('Sync cancelled');

    expect(second.run).not.toHaveBeenCalled();
    expect(runningSyncs.get(6)?.status).toBe('cancelled');
    expect(runningSyncs.get(6)?.logId).toBeNull();
    vi.advanceTimersByTime(30000);
    expect(runningSyncs.has(6)).toBe(false);
  });

  it('leaves the next source to run when one fails for its own reason, and reports the failure', async () => {
    const first = member(3, 101, () => { throw new Error('database gone'); });
    const second = member(6, 102);

    await expect(runSyncPass([first, second], null)).rejects.toThrow('database gone');

    expect(second.run).toHaveBeenCalledOnce();
    expect(second.slots[0].firstLogId).toBe(101);
  });

  it('keeps every entry until the last run ends, then releases them all', async () => {
    let firstWhileSecondRan: ReturnType<typeof runningSyncs.get>;
    const first = member(3, 101);
    const second = member(6, 102, () => {
      // Minutes into the second run: the first's entry is still what a
      // Cancel on its card, and the merge of its arrivals, read.
      vi.advanceTimersByTime(120000);
      firstWhileSecondRan = runningSyncs.get(3);
    });

    await runSyncPass([first, second], null);

    expect(firstWhileSecondRan?.logId).toBe(101);
    expect(runningSyncs.get(3)?.status).toBe('complete');
    vi.advanceTimersByTime(30000);
    expect(runningSyncs.has(3)).toBe(false);
    expect(runningSyncs.has(6)).toBe(false);
  });

  it('closes an entry whose run never took it up, so the pass can start again', async () => {
    const silent: PassMember = { sourceId: 3, logPrefix: '[Source 3]', run: vi.fn().mockResolvedValue(undefined) };

    await runSyncPass([silent], null);

    expect(runningSyncs.get(3)?.status).toBe('failed');
    expect(passIsRunning([3])).toBe(false);
  });

  it('refuses to start while any of its sources is running', async () => {
    runningSyncs.set(6, makeProgress({ status: 'processing' }));

    expect(passIsRunning([3, 6])).toBe(true);
    await expect(runSyncPass([member(3, 101), member(6, 102)], null)).rejects.toThrow(/already in progress/);
    expect(runningSyncs.has(3)).toBe(false);
  });
});

describe('sharedGather', () => {
  it('gathers once with the first asker\'s progress, and hands every asker the same answer', async () => {
    const gather = vi.fn().mockResolvedValue({ pool: 7 });
    const shared = sharedGather(gather);
    const progress = makeProgress();

    const answers = await Promise.all([shared(progress), shared(makeProgress())]);

    expect(gather).toHaveBeenCalledOnce();
    expect(gather).toHaveBeenCalledWith(progress);
    expect(answers[0]).toBe(answers[1]);
  });

  it('hands a failed gather\'s error to every asker, without gathering again', async () => {
    const gather = vi.fn().mockRejectedValue(new Error('subset unreadable'));
    const shared = sharedGather(gather);

    await expect(shared(makeProgress())).rejects.toThrow('subset unreadable');
    await expect(shared(makeProgress())).rejects.toThrow('subset unreadable');
    expect(gather).toHaveBeenCalledOnce();
  });
});

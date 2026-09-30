/**
 * A running sync's progress, written to its log row as it goes (#1131).
 *
 * `runningSyncs` holds a run's progress in memory, and a restart loses it: the
 * row said nothing of how far the run got, and the status endpoint had nothing
 * to read for a run another process holds. This keeps the row a few seconds
 * behind the memory, never more.
 *
 * When it writes, checked once a tick: at the first chance on a change of
 * phase, at most once per `minGapMs` while the figures move, and once per
 * `heartbeatMs` while they do not, so `progress_at` says the run is alive
 * through a long collection that moves no count. One write is in flight at a
 * time; what comes up meanwhile waits, the newest replacing the one before
 * it. A failed write is logged and never thrown: the run's own work matters
 * more than its report of it, and the close writes the figures anyway.
 */

import { writeSyncLogProgress, type SyncLogProgress } from './syncUtils.js';
import type { SyncProgress } from './types.js';

export interface ProgressWriterTiming {
  /** How often the writer looks at the run. */
  tickMs: number;
  /** The least time between two writes of moving figures. */
  minGapMs: number;
  /** The most time between two writes, figures moving or not. */
  heartbeatMs: number;
}

export const PROGRESS_WRITER_TIMING: ProgressWriterTiming = {
  tickMs: 1000,
  minGapMs: 2000,
  heartbeatMs: 15000,
};

export interface ProgressWriter {
  /**
   * Write now if a write is due; `force` makes one due. Resolves when the
   * write in flight, and whatever waited behind it, has landed or failed.
   */
  flush(force?: boolean): Promise<void>;
  /**
   * Stop writing, with one last write of the figures as they stand: after the
   * write in flight, it replaces whatever waited, so a run the orchestrator
   * closes normally holds its final phase and count rather than the last
   * tick's. No tick follows, and the close that follows is the row's last
   * word. Never rejects, and a second call only waits again.
   */
  close(): Promise<void>;
}

/** The row's progress for a run still going, or null for one that has ended. */
function snapshotOf(progress: SyncProgress): SyncLogProgress | null {
  const { status } = progress;
  if (status !== 'fetching' && status !== 'processing' && status !== 'assigning') return null;
  return {
    phase: status,
    statusMessage: progress.statusMessage,
    currentItem: progress.currentItem,
    done: progress.progress,
    total: progress.total,
    created: progress.created,
    updated: progress.updated,
    unchanged: progress.unchanged,
    missing: progress.missing,
    curatedConflicts: progress.curatedConflicts,
    held: progress.held,
    filtered: progress.filtered,
    errors: progress.errors,
  };
}

/** Both snapshots come from `snapshotOf`, so their keys are in one order. */
function sameProgress(a: SyncLogProgress, b: SyncLogProgress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function startProgressWriter(
  progress: SyncProgress,
  options: Partial<ProgressWriterTiming> & { logPrefix?: string } = {},
): ProgressWriter {
  const timing = { ...PROGRESS_WRITER_TIMING, ...options };
  const logPrefix = options.logPrefix ?? '[Sync]';
  let last: SyncLogProgress | null = null;
  let lastAt = 0;
  let inFlight: Promise<void> | null = null;
  let waiting: SyncLogProgress | null = null;
  let closed = false;

  function due(snapshot: SyncLogProgress, force: boolean): boolean {
    if (force || last === null || snapshot.phase !== last.phase) return true;
    const since = Date.now() - lastAt;
    if (since >= timing.heartbeatMs) return true;
    return since >= timing.minGapMs && !sameProgress(snapshot, last);
  }

  async function drain(logId: number, first: SyncLogProgress): Promise<void> {
    let next: SyncLogProgress | null = first;
    while (next !== null) {
      last = next;
      lastAt = Date.now();
      try {
        await writeSyncLogProgress(logId, next);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('%s Could not write the run\'s progress to log %d: %s', logPrefix, logId, msg);
      }
      next = waiting;
      waiting = null;
    }
    // In the same turn as the last read of `waiting`, so nothing can be left
    // waiting behind a write that has already finished.
    inFlight = null;
  }

  function flush(force = false): Promise<void> {
    const settled = inFlight ?? Promise.resolve();
    if (closed || progress.logId === null) return settled;
    const snapshot = snapshotOf(progress);
    if (snapshot === null || !due(snapshot, force)) return settled;
    if (inFlight !== null) {
      waiting = snapshot;
      return inFlight;
    }
    inFlight = drain(progress.logId, snapshot);
    return inFlight;
  }

  const timer = setInterval(() => { void flush(); }, timing.tickMs);
  // A tick must never be what keeps the process alive.
  timer.unref?.();

  return {
    flush,
    async close() {
      if (!closed) {
        clearInterval(timer);
        const last = flush(true);
        closed = true;
        await last;
      }
      await inFlight;
    },
  };
}

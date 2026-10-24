/**
 * A pass: several sources filling their kinds from one gather (ADR-0132).
 *
 * A Wikidata kind is filled by a source of its own, so that a place in two
 * kinds holds two memberships, one per source, each keyed as ADR-0084 keys it.
 * What the sources share is the gather: the class trees, the pool and the
 * facts are read once, and each source's run takes its share of them through
 * its own `fetchItems`. The runs go one after another through
 * `orchestrateSync`, each with its own log, admission, sweep and changeset, and
 * every log after the first names the first, so the history reads the pass as
 * one run.
 */

import { orchestrateSync, type PassSlot } from './syncOrchestrator.js';
import type { SyncServiceConfig } from './syncContract.js';
import { runningSyncs, isTerminalSyncStatus, type SyncProgress, type SyncRunOptions } from './types.js';

/**
 * A gather the sources of a pass read, made once.
 *
 * The first source to ask makes it, with that run's progress on screen, and
 * every later ask gets the same answer, a failure included: a gather that
 * failed fails each run that needed it, with the same error on its log, rather
 * than being asked again by the next.
 */
export function sharedGather<G>(gather: (progress: SyncProgress) => Promise<G>): (progress: SyncProgress) => Promise<G> {
  let made: Promise<G> | undefined;
  return (progress) => {
    made ??= gather(progress);
    return made;
  };
}

/**
 * One source of a pass: its run, with the type of its items left inside it,
 * so sources whose items differ run in one pass.
 */
export interface PassMember {
  sourceId: number;
  logPrefix: string;
  run: (triggeredBy: number | null, options: SyncRunOptions, slot: PassSlot) => Promise<void>;
}

export function passMember<T>(config: SyncServiceConfig<T>): PassMember {
  return {
    sourceId: config.sourceId,
    logPrefix: config.logPrefix,
    run: (triggeredBy, options, slot) => orchestrateSync(config, triggeredBy, options, slot),
  };
}

/** The entry a later source of a pass holds while an earlier one runs. */
function waitingProgress(dryRun: boolean, passSources: number[]): SyncProgress {
  return {
    cancel: false,
    kind: 'sync',
    status: 'fetching',
    statusMessage: 'Waiting for the pass\'s earlier kinds to finish...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    held: 0,
    filtered: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun,
    passSources,
  };
}

/**
 * Whether any source of the pass is running, so a start of one of them is
 * refused while another is mid-run.
 */
export function passIsRunning(sourceIds: readonly number[]): boolean {
  return sourceIds.some((id) => {
    const progress = runningSyncs.get(id);
    return !!progress && !isTerminalSyncStatus(progress.status);
  });
}

/**
 * Run the sources of a pass, in order, from the gather they share.
 *
 * Every source is registered before the first starts, so the panel shows the
 * whole pass as running and `cancelSync` reaches the ones still waiting. A
 * Cancel stops the pass: the run it reached stops, and a source that had not
 * started yet is closed as cancelled with no log, since it read nothing. A run
 * that fails for its own reason leaves the next to run: their memberships,
 * admission and logs are their own.
 */
export async function runSyncPass(
  members: readonly PassMember[],
  triggeredBy: number | null,
  options: SyncRunOptions = {},
): Promise<void> {
  const sourceIds = members.map((member) => member.sourceId);
  if (passIsRunning(sourceIds)) {
    throw new Error(`${members[0].logPrefix} pass already in progress`);
  }
  const dryRun = options.dryRun ?? false;
  const slots = new Map(sourceIds.map((id) => [id, waitingProgress(dryRun, sourceIds)]));
  for (const [id, progress] of slots) runningSyncs.set(id, progress);

  let firstLogId: number | null = null;
  let stopped = false;
  let failure: unknown;
  try {
    for (const member of members) {
      const progress = slots.get(member.sourceId) as SyncProgress;
      if (stopped || progress.cancel) {
        stopped = true;
        progress.status = 'cancelled';
        progress.statusMessage = 'Cancelled before its turn in the pass.';
        continue;
      }
      try {
        await member.run(triggeredBy, options, { progress, firstLogId });
      } catch (err) {
        failure ??= err;
        stopped = progress.cancel;
      }
      // A run that never took its entry up would leave it waiting for good, and
      // every later start of the pass refused.
      if (!isTerminalSyncStatus(progress.status)) {
        progress.status = 'failed';
        progress.statusMessage = 'The run did not start.';
      }
      firstLogId ??= progress.logId;
    }
  } finally {
    // Every entry is the pass's to release, and only once its last run has
    // ended (`orchestrateSync` leaves a pass's entry alone): until then an
    // earlier source's entry is what a Cancel pressed on it reads, and what
    // the merge of that run's arrivals reads once the pass is over.
    for (const [id, progress] of slots) releaseLater(id, progress);
  }
  // The first failure, for the caller's log, once every source had its turn.
  if (failure !== undefined) throw failure;
}

/** Drop a source's entry once a poller has had time to read how it ended. */
function releaseLater(sourceId: number, progress: SyncProgress): void {
  setTimeout(() => {
    // The run's after-steps hold the entry and release it themselves (#1805).
    if (progress.continues) return;
    if (runningSyncs.get(sourceId) === progress) runningSyncs.delete(sourceId);
  }, 30000);
}

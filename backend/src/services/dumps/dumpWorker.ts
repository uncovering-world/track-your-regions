/**
 * The dump worker (ADR-0106): a process of its own, run without a file
 * watcher, that takes the builds the admin panel queues and runs them one at
 * a time (`runBuild`). An edit, a `git pull` or a restart of the backend does
 * not stop a build it runs; only stopping the worker does, and the build's
 * row then says to start it again.
 */

import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { claimNextBuild, closeOrphanedBuilds } from './ledger.js';
import { runBuild } from './buildRun.js';
import { queueDueCopies } from './scheduledCopies.js';
import { askDueDumps } from './newestOnHost.js';

/**
 * What the worker's builds are run by: its host name, which compose fixes
 * (`hostname:` on the dump-worker service) so it stays the same across a
 * restart and a recreated container, and a worker that starts knows the
 * running rows its previous run left.
 */
export const WORKER_RUNNER = `worker:${hostname()}`;

/** How long the worker waits before it looks for a queued build again. */
const POLL_EVERY_MS = 3_000;
/** How often an idle worker asks whether a scheduled build is due (`scheduledCopies.ts`). */
const SCHEDULE_EVERY_MS = 10 * 60 * 1000;
/** How often the worker looks for a dump whose newest file on the host it last learnt a day ago (`newestOnHost.ts`). */
const NEWEST_EVERY_MS = 10 * 60 * 1000;

/** Run the oldest queued build, if any; answers whether there was one. */
export async function runNextBuild(stop: AbortSignal): Promise<boolean> {
  const claimed = await claimNextBuild(WORKER_RUNNER);
  if (!claimed) return false;
  console.log(`[Dumps] Worker took build ${claimed.id} of ${claimed.dump}`);
  await runBuild(claimed, stop);
  return true;
}

/**
 * Queue the builds the copies' schedules make due (ADR-0195), the
 * OpenStreetMap layer's update among them. A build an admin queued meanwhile
 * holds the dump's one slot, which is no error; anything else is logged, and
 * the next look tries again.
 */
export async function queueWhatIsDue(stop: AbortSignal): Promise<void> {
  try {
    for (const { dump, id } of await queueDueCopies(stop)) console.log(`[Dumps] Queued build ${id}: the scheduled build of ${dump}`);
  } catch (error) {
    console.error('[Dumps] Could not queue the scheduled builds:', error);
  }
}

/**
 * Learn the newest file on the host of each dump a day after it was last
 * learnt, until `stop` aborts: beside the builds rather than between them, so
 * a build that runs for hours does not leave the panel's dates a day stale.
 * Its requests share the process's connections with the build's (#2353).
 */
export async function newestLoop(stop: AbortSignal, everyMs = NEWEST_EVERY_MS): Promise<void> {
  while (!stop.aborted) {
    await askDueDumps(stop).catch(error => console.error('[Dumps] The worker could not learn the newest dumps:', error));
    await sleep(everyMs, undefined, { signal: stop }).catch(() => undefined);
  }
}

/** Take and run queued builds until `stop` aborts, and between them queue the updates a schedule makes due. */
export async function workLoop(stop: AbortSignal): Promise<void> {
  const closed = await closeOrphanedBuilds({ runner: WORKER_RUNNER });
  if (closed > 0) console.log(`[Dumps] Closed ${closed} build(s) the worker's previous run left`);
  const newest = newestLoop(stop);
  let scheduledAt = 0;
  while (!stop.aborted) {
    if (Date.now() - scheduledAt >= SCHEDULE_EVERY_MS) {
      scheduledAt = Date.now();
      await queueWhatIsDue(stop);
    }
    const ran = await runNextBuild(stop).catch(error => {
      console.error('[Dumps] The worker could not take a build:', error);
      return false;
    });
    if (!ran) await sleep(POLL_EVERY_MS, undefined, { signal: stop }).catch(() => undefined);
  }
  await newest;
}

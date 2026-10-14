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

/**
 * What the worker's builds are run by: its host name, which compose fixes
 * (`hostname:` on the dump-worker service) so it stays the same across a
 * restart and a recreated container, and a worker that starts knows the
 * running rows its previous run left.
 */
export const WORKER_RUNNER = `worker:${hostname()}`;

/** How long the worker waits before it looks for a queued build again. */
const POLL_EVERY_MS = 3_000;

/** Run the oldest queued build, if any; answers whether there was one. */
export async function runNextBuild(stop: AbortSignal): Promise<boolean> {
  const claimed = await claimNextBuild(WORKER_RUNNER);
  if (!claimed) return false;
  console.log(`[Dumps] Worker took build ${claimed.id} of ${claimed.dump}`);
  await runBuild(claimed, stop);
  return true;
}

/** Take and run queued builds until `stop` aborts. */
export async function workLoop(stop: AbortSignal): Promise<void> {
  const closed = await closeOrphanedBuilds({ runner: WORKER_RUNNER });
  if (closed > 0) console.log(`[Dumps] Closed ${closed} build(s) the worker's previous run left`);
  while (!stop.aborted) {
    const ran = await runNextBuild(stop).catch(error => {
      console.error('[Dumps] The worker could not take a build:', error);
      return false;
    });
    if (!ran) await sleep(POLL_EVERY_MS, undefined, { signal: stop }).catch(() => undefined);
  }
}

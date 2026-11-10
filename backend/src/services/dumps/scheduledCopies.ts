/**
 * The copies the dump worker brings forward by itself (ADR-0195): every kept
 * copy whose schedule makes a build due (`copySchedule.ts`), and the
 * OpenStreetMap layer on its own trigger (`osm/layerSchedule.ts`). One look
 * queues at most one build a copy; the ledger lets one build of a dump be
 * queued or running at a time, so a build an admin started meanwhile holds
 * the slot and none is queued beside it.
 */

import { dumpsDir } from './buildQueue.js';
import { DUMPS } from './catalog.js';
import { copyDue, copyFacts, queueScheduledBuild } from './copySchedule.js';
import { BuildAlreadyRunning } from './ledger.js';
import { keeperOf } from './keepers.js';
import { queueScheduledUpdate } from './osm/layerSchedule.js';

/** Queue the builds a schedule makes due; answers each one queued, by dump and build id. */
export async function queueDueCopies(stop: AbortSignal, now = new Date()): Promise<Array<{ dump: string; id: number }>> {
  const queued: Array<{ dump: string; id: number }> = [];
  const tryQueue = async (dump: string, queue: () => Promise<number | null>) => {
    try {
      const id = await queue();
      if (id !== null) queued.push({ dump, id });
    } catch (error) {
      if (!(error instanceof BuildAlreadyRunning)) console.error('[Dumps] Could not queue the scheduled build of %s:', dump, error);
    }
  };
  for (const descriptor of DUMPS) {
    if (stop.aborted) break;
    const keeper = keeperOf(descriptor.key);
    if (!keeper) continue;
    if (keeper.update) {
      // The layer is brought forward from the daily diffs, not from a newer weekly planet.
      await tryQueue(descriptor.key, () => queueScheduledUpdate(stop, now));
      continue;
    }
    await tryQueue(descriptor.key, async () => {
      const kept = await keeper.latest();
      const facts = await copyFacts(descriptor.key, await keeper.schedule.read(), kept, keeper.followsInputs === true && kept?.needs === 'rebuild');
      if (!copyDue(facts, now)) return null;
      return queueScheduledBuild(descriptor.key, dumpsDir() ? 'local' : 'stream', now);
    });
  }
  return queued;
}

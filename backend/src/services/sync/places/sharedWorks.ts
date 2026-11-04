/**
 * The pass's one gather of works (#1821), as a source's pipeline asks for it.
 *
 * Its own module, importing only types, so a source's service names the
 * pass's works without loading the gather that reads them.
 */

import type { SharedWorks } from '../museum/worksGather.js';
import type { SyncProgress } from '../types.js';
import type { PlaceGather } from './gather.js';

/** The pass's works, for a source's pipeline to take its share of: read when the pipeline first asks, not before. */
export function sharedWorksOf(gather: (progress: SyncProgress) => Promise<PlaceGather>, progress: SyncProgress): SharedWorks {
  return {
    gathered: async () => (await gather(progress)).works.gathered(progress),
    museumClasses: async () => (await gather(progress)).works.museumClasses(progress),
    treasureClasses: async () => (await gather(progress)).works.treasureClasses(progress),
  };
}

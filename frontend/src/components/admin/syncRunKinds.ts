/**
 * What the source card says about each kind of run it follows: a sync, a
 * picture repair, and the search for World Heritage components' items (#1272).
 * One table, so a new kind of run is given all of its sentences at once rather
 * than falling through to a sync's.
 */

import type { SyncStatus } from '../../api/admin';

export type RunKind = NonNullable<SyncStatus['kind']>;

interface RunWords {
  /** The run as the subject of "… failed" or "… was cancelled". */
  subject: string;
  /** The chip while it runs; a sync says whether it writes. */
  running: (dryRun: boolean) => string;
  /** The alert once it has finished, from the run's own last words. */
  finished: (message: string | undefined) => string;
}

export const RUN_WORDS: Record<RunKind, RunWords> = {
  sync: {
    subject: 'The sync',
    running: (dryRun) => (dryRun ? 'Previewing...' : 'Syncing...'),
    // A sync's sentence says nothing about how region assignment turned out:
    // the run only reports itself finished once placement has run, so the
    // source's status chip already carries that verdict.
    finished: () => 'Sync completed. Region assignment runs as part of the run, so there is normally '
      + 'nothing further to do — check the status chip if it reports Partial.',
  },
  repair: {
    subject: 'The picture repair',
    running: () => 'Fixing pictures...',
    finished: (message) => `Pictures repaired: ${message ?? 'done'}.`,
  },
  components: {
    subject: 'The component search',
    running: () => 'Finding component items...',
    finished: (message) => `Component items: ${message ?? 'done'}. Each candidate waits for a curator's answer.`,
  },
};

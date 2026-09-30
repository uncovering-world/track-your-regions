/**
 * What the sync card says about a last run the server was restarted under
 * (#1131).
 *
 * The startup sweep closes such a run `failed`, and the chip says Failed —
 * which alone reads as a sync that went wrong on its own. This says what
 * happened and how far the run got, what of it stands, and what starting it
 * again costs: it goes over everything from the start, and gets back only
 * the answers the source already gave, which are kept between runs.
 */

import { Alert } from '@mui/material';
import type { SyncLastRun } from '../../api/admin';

/** The sentence for a run a restart stopped, or null for any other run. */
export function lastRunSentence(run: SyncLastRun | undefined): string | null {
  if (!run?.stoppedByRestart) return null;
  const subject = run.dryRun ? 'The last preview' : 'The last sync';
  const again = 'starting it again goes over everything, with the answers the source already gave kept.';

  // Still collecting: nothing was looked at yet, so there is nothing to count.
  if (run.phase === 'fetching' || run.phase === null) {
    return `${subject} stopped when the server was restarted under it, while it was still collecting `
      + `from the source. ${again.charAt(0).toUpperCase()}${again.slice(1)}`;
  }

  const done = `${run.progress.toLocaleString()} of ${run.total.toLocaleString()} done`;
  if (run.dryRun) {
    return `${subject} stopped when the server was restarted under it — ${done}. A preview writes `
      + `nothing; ${again}`;
  }

  const counts = [`${run.created.toLocaleString()} created`, `${run.updated.toLocaleString()} updated`];
  if (run.held > 0) counts.push(`${run.held.toLocaleString()} held`);
  // Placement runs at a run's end, so what a killed run wrote was never placed.
  const placement = run.created + run.updated > 0 ? ' Objects it wrote may need Region Assignment.' : '';
  return `${subject} stopped when the server was restarted under it — ${done}: ${counts.join(', ')}. `
    + `What it wrote stands; ${again}${placement}`;
}

export function SourceLastRunNote({ run }: { run: SyncLastRun | undefined }) {
  const sentence = lastRunSentence(run);
  if (sentence === null) return null;
  return <Alert severity="warning" sx={{ mb: 2 }}>{sentence}</Alert>;
}

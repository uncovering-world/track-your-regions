/**
 * What the sync card says about a last run the server was restarted under
 * (#1131).
 *
 * The startup sweep closes such a run `failed`, and the chip says Failed —
 * which alone reads as a sync that went wrong on its own. This says what
 * happened and how far the run got, what of it stands, and what starting it
 * again costs: it goes over everything from the start, and gets back only
 * the answers the source already gave, which are kept between runs.
 *
 * A run places what it moved only after it has closed, so a restart can
 * also land in that placement, on a run that otherwise finished: the sweep
 * marks it Partial, and this says why (#1152). Either way, the objects the
 * source moved and has not placed are named on its rows, and the next sync
 * places them and clears the note; the sentence says how many, and that
 * Region Assignment places them sooner — which leaves the note until that
 * sync, since only a sync's placement empties the list.
 */

import { Alert } from '@mui/material';
import type { SyncLastRun } from '../../api/admin';

/**
 * What waits to be placed and who places it. The count is what the row names:
 * the objects this run moved and those it took over from earlier runs, so it
 * is said as the source's, not the run's.
 */
function unplacedSentence(unplaced: number): string {
  if (unplaced === 1) {
    return 'One object this source moved is not in its region yet. The next sync places it and '
      + 'clears this note; Region Assignment places it sooner.';
  }
  return `${unplaced.toLocaleString()} objects this source moved are not in their regions yet. The next `
    + 'sync places them and clears this note; Region Assignment places them sooner.';
}

/** The sentence for a run a restart stopped while it placed what it moved. */
function placementStoppedSentence(run: SyncLastRun): string {
  // Only a run that closed Partial here went through all its objects: a
  // cancelled or failed one keeps its own verdict, and the sweep marks it too.
  const lead = run.status === 'partial'
    ? 'The last sync went through all its objects, but the server was restarted under it while it was placing what it moved.'
    : 'The server was restarted under the last sync while it was placing what it moved.';
  return run.unplaced ? `${lead} ${unplacedSentence(run.unplaced)}` : lead;
}

/**
 * The sentence for a run a restart stopped, or for any newest run while the
 * source's objects wait to be placed; null when there is nothing to say.
 */
export function lastRunSentence(run: SyncLastRun | undefined): string | null {
  if (run?.placementStoppedByRestart) return placementStoppedSentence(run);
  // Objects still waiting though the newest run was not stopped: a placement
  // that failed, or a preview run since the run that left them.
  if (!run?.stoppedByRestart) return run?.unplaced ? unplacedSentence(run.unplaced) : null;
  const subject = run.dryRun ? 'The last preview' : 'The last sync';
  const again = 'starting it again goes over everything, with the answers the source already gave kept.';
  // What waits is the source's, so it is said whichever way this run stopped.
  const waiting = run.unplaced ? ` ${unplacedSentence(run.unplaced)}` : '';

  // Still collecting: nothing was looked at yet, so there is nothing to count.
  if (run.phase === 'fetching' || run.phase === null) {
    return `${subject} stopped when the server was restarted under it, while it was still collecting `
      + `from the source. ${again.charAt(0).toUpperCase()}${again.slice(1)}${waiting}`;
  }

  const done = `${run.progress.toLocaleString()} of ${run.total.toLocaleString()} done`;
  if (run.dryRun) {
    return `${subject} stopped when the server was restarted under it — ${done}. A preview writes `
      + `nothing; ${again}${waiting}`;
  }

  const counts = [`${run.created.toLocaleString()} created`, `${run.updated.toLocaleString()} updated`];
  if (run.held > 0) counts.push(`${run.held.toLocaleString()} held`);
  // Placement runs at a run's end, so what a killed run moved was never
  // placed. Its row names how many; a run from before the count can only
  // hedge.
  let placement = '';
  if (run.unplaced === null) {
    if (run.created + run.updated > 0) placement = ' Objects it wrote may need Region Assignment.';
  } else if (run.unplaced > 0) {
    placement = ` ${unplacedSentence(run.unplaced)}`;
  }
  return `${subject} stopped when the server was restarted under it — ${done}: ${counts.join(', ')}. `
    + `What it wrote stands; ${again}${placement}`;
}

export function SourceLastRunNote({ run }: { run: SyncLastRun | undefined }) {
  const sentence = lastRunSentence(run);
  if (sentence === null) return null;
  return <Alert severity="warning" sx={{ mb: 2 }}>{sentence}</Alert>;
}

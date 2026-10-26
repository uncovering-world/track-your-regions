/**
 * What one *Start Sync* does once its run's items are written (#1805): the
 * steps a current catalogue still needs, reported as steps of the run on the
 * source's own card (#1356), so an admin presses one button and reads one
 * closing line.
 *
 * 1. The places claiming one Wikidata item are joined (ADR-0046 decision 2,
 *    `equalItemMerges.ts`): a run finds the place an item names before it
 *    creates one (ADR-0143), and what it can still leave is an item recorded
 *    on a place that exists.
 * 2. For the World Heritage source, the items of the components this run left
 *    without one: the component points it created, searched by the same
 *    finder the card's *Find component items* runs over every component
 *    (`componentItemJob.ts`), then the exact candidates nothing contradicts
 *    accepted (ADR-0141). A run that created no itemless component skips the
 *    search, which is the ordinary run: the list changes yearly, and a full
 *    search costs eight minutes and three hundred requests to Wikidata, so
 *    that stays the card's own action for after a rule changes.
 * 3. The places whose pairing inputs the run changed — created, renamed,
 *    moved, admitted, refused — are paired again with near places of similar
 *    names (#1950, `drainPairing`), with every other place marked since.
 *
 * Each step is guarded on its own (#2074): one that fails is logged, named in
 * the closing line, and the steps after it still run. The search needs the
 * local Wikidata subset, so it asks for that first, and a run on a machine
 * that has none says so and leaves the search to the card's action.
 *
 * The steps run here rather than inside the run, since each is a curation
 * write the sync layer sits below. However the run ended: a run cancelled or
 * failed half-way still wrote what it wrote. Every entry of the pass is kept
 * (`progress.continues`); the one the card still follows, the pass's last
 * run's, goes back to `processing` while the steps go and to what the run
 * said at the end, its closing line extended by what the steps did, and a
 * Cancel pressed meanwhile (`isCancellable` accepts one while `continues`)
 * stops the search between its requests, or the pairing before it starts.
 * The release the run's writer scheduled leaves the entries to the steps,
 * which release them a while after they end, as the writer would have.
 */

import { pool } from '../../db/index.js';
import { Operation } from '../../services/operationProgress.js';
import { FINDER_STEPS, heldSubset } from '../../services/sync/componentItemFinder.js';
import { runComponentItemSearch, type AcceptExact } from '../../services/sync/componentItemJob.js';
import { drainPairing, pairingSentence } from '../../services/sync/mergeProposalFinder.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from '../../services/sync/types.js';
import { joinPlacesClaimingOneItem } from '../experience/equalItemMerges.js';

const UNESCO_SOURCE_ID = 1;
const LOG_PREFIX = '[After run]';
/** How long the entry stays readable once the steps are over, as a run's writer keeps it. */
const RELEASE_AFTER_MS = 30000;

/** The real runs of a pass as their entries stand once the pass is over, keyed by source. */
export function realRunsOf(pass: readonly number[]): Array<{ sourceId: number; progress: SyncProgress }> {
  return pass.flatMap((sourceId) => {
    const progress = runningSyncs.get(sourceId);
    return progress && !progress.dryRun && progress.logId ? [{ sourceId, progress }] : [];
  });
}

/**
 * The component points the run created that no item records and no curator
 * has claimed one for: what the finder is asked about as the run's own step.
 */
async function newItemlessComponents(logId: number): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT el.id
       FROM experience_locations el
       JOIN experience_parts prt ON prt.part_id = el.experience_id AND prt.reason = 'component'
       JOIN experience_sync_logs run ON run.id = $1
      WHERE el.created_at >= run.started_at
        AND el.wikidata_item IS NULL AND el.merged_into_id IS NULL AND el.missing_since IS NULL
        AND NOT (COALESCE(el.curated_fields, '[]'::jsonb) ? 'wikidata_item')
      ORDER BY el.id`,
    [logId],
  );
  return result.rows.map(row => row.id);
}

/**
 * The World Heritage step: the finder on the component points this run
 * created without an item, or nothing where it created none. Answers the
 * closing clause, or null where there is nothing to say.
 */
async function searchNewComponents(
  shown: SyncProgress, operation: Operation, logId: number, accept: AcceptExact,
): Promise<string | null> {
  const points = await newItemlessComponents(logId);
  if (points.length === 0) {
    operation.note('No new component without an item: the search is not needed');
    return null;
  }
  if (shown.cancel) {
    operation.note('Cancelled before the search');
    return null;
  }
  if (!(await heldSubset())) {
    operation.note('The local Wikidata subset is not built: the search waits for it');
    const components = `${points.length} new component${points.length === 1 ? '' : 's'}`;
    return `${components} left without an item, since the local Wikidata subset is not built: build it under Public Dumps, then Find component items`;
  }
  shown.statusMessage = `Looking for the items of ${points.length} components this run left without one...`;
  const found = await runComponentItemSearch(shown, operation, { pointIds: points }, accept);
  if (found === null) {
    operation.note('Cancelled during the search');
    return null;
  }
  operation.note(`${found.queries} requests to Wikidata's API`);
  return found.sentence;
}

/**
 * The last step: the places the runs changed, paired again with near places of
 * similar names (#1950). One drain for the pass, whatever number of runs it
 * held, since the marks are the places', not a run's.
 */
async function pairNearPlaces(shown: SyncProgress, operation: Operation, index: number): Promise<string> {
  operation.step(index, 'Pairing the changed places with near places of similar names', 1);
  // The flag a Cancel sets while the steps go (`isCancellable`): the marks stay,
  // and the next drain pairs them.
  if (shown.cancel) return 'the pairing was cancelled; the next one pairs the places this run changed';
  shown.statusMessage = 'Pairing the changed places with near places of similar names...';
  const sentence = pairingSentence(await drainPairing());
  operation.advance();
  return sentence;
}

/**
 * One step, answering its clause; a step that fails answers a clause naming
 * it, so that the steps after it still run.
 */
async function guarded(name: string, logId: SyncProgress['logId'], step: () => Promise<string | null>): Promise<string | null> {
  try {
    return await step();
  } catch (error) {
    console.error('%s %s after run %s failed:', LOG_PREFIX, name, logId, error);
    return `${name} failed; the server log has the cause`;
  }
}

/**
 * Run the after-steps for the pass `pass` started from `startedId`, on the
 * entry the card is still following, and release every entry of the pass when
 * they end. `accept` is the catalogue's own answer to the exact candidates
 * (ADR-0141), the controller's, since it is a curator-side write.
 */
export async function afterRun(startedId: number, pass: readonly number[], accept: AcceptExact): Promise<void> {
  // Every entry read before the first step: a step has no time limit, and
  // meanwhile the writers' release timers run out and, every entry being
  // closed, a new start may replace one.
  const runs = realRunsOf(pass);
  if (runs.length === 0) return;
  // The pass's last run: on a pass of several sources the first source's run
  // ends minutes before the pass does, and its card has stopped asking about
  // it by then, while the last run's entry is the one the card still reads
  // (`PassCard`). On a source of its own it is the one run there is.
  const shown = runs[runs.length - 1].progress;
  const ended = shown.status;
  const closing = shown.statusMessage;
  // The run's own Cancel is answered: its verdict is in `ended`. The flag is
  // cleared so that the steps read only a Cancel pressed while they go — a
  // cancelled run still wrote what it wrote, and that is paired like any
  // other run's (#1800).
  shown.cancel = false;
  const searches = startedId === UNESCO_SOURCE_ID;
  const steps = (searches ? FINDER_STEPS : 0) + 1;
  const operation = new Operation(LOG_PREFIX, steps);
  for (const run of runs) run.progress.continues = true;
  shown.operation = operation;
  shown.status = 'processing';
  const said: string[] = [];
  const run = async (name: string, step: () => Promise<string | null>) => {
    const sentence = await guarded(name, shown.logId, step);
    if (sentence !== null) said.push(sentence);
  };
  try {
    await run('the joining of places claiming one item', async () => { await joinPlacesClaimingOneItem(); return null; });
    if (searches) {
      await run('the search for the new components\' items', () => searchNewComponents(shown, operation, shown.logId!, accept));
    }
    await run('the pairing of near places', () => pairNearPlaces(shown, operation, steps));
    operation.finish(said.join('; '));
  } finally {
    // The run's own verdict stands; the steps only add to its line.
    shown.status = isTerminalSyncStatus(ended) ? ended : 'complete';
    shown.statusMessage = said.length > 0 ? `${closing}; ${said.join('; ')}` : closing;
    for (const run of runs) run.progress.continues = false;
    setTimeout(() => {
      for (const run of runs) {
        if (runningSyncs.get(run.sourceId) === run.progress) runningSyncs.delete(run.sourceId);
      }
    }, RELEASE_AFTER_MS);
  }
}

/**
 * The admin panel's "Find component items" (#1272): `findComponentItems` run in
 * the background for the World Heritage source, reported through the same
 * status the source's card polls for a sync or a picture repair.
 *
 * It writes proposals only — a curator's answer is what records an item on a
 * point (ADR-0046) — so it needs no review of its own and can be run again:
 * a second pass replaces what is still unanswered and never brings back a
 * candidate a curator refused.
 */

import { sentenceFor } from '../../api/readerFacingError.js';
import { findComponentItems } from './componentItemFinder.js';
import { WaitBudget } from './sourceRetry.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from './types.js';
import { SPARQL_WAIT_BUDGET_MS, waitMessage } from './wikidataUtils.js';

const UNESCO_SOURCE_ID = 1;
const LOG_PREFIX = '[Component items]';

export async function findUnescoComponentItems(_triggeredBy: number | null): Promise<void> {
  const existing = runningSyncs.get(UNESCO_SOURCE_ID);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw new Error('UNESCO sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    kind: 'components',
    status: 'fetching',
    statusMessage: 'Reading the components no Wikidata item records...',
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
    dryRun: false,
  };
  runningSyncs.set(UNESCO_SOURCE_ID, progress);

  try {
    const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
    const { report } = await findComponentItems({
      write: true,
      hooks: {
        budget,
        isCancelled: () => progress.cancel,
        onQuery: () => { progress.progress += 1; },
        onWait: (wait) => { progress.statusMessage = waitMessage('Wikidata', wait, budget); },
      },
      onStage: (message) => { progress.statusMessage = message; },
    });
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      return;
    }
    progress.status = 'complete';
    progress.created = report.partOf + report.near;
    progress.statusMessage =
      `${report.partOf + report.near} of ${report.points} components without an item have a candidate for a curator`
      + ` — ${report.partOf} named as parts of their site, ${report.near} found near the point`
      + `, ${report.exact} of the same name at the point`
      + (report.unsearched > 0 ? `; ${report.unsearched} could not be searched around, as Wikidata did not answer` : '')
      + (report.unreadSites > 0 ? `; the parts of ${report.unreadSites} sites could not be read` : '')
      + (report.wholeSites > 0 ? `; ${report.wholeSites} stand for their whole site and were not searched` : '')
      + (report.settlements > 0 ? `; ${report.settlements} settlements set aside` : '');
    console.log(`${LOG_PREFIX} Complete after ${report.queries} queries: ${progress.statusMessage}`);
  } catch (err) {
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = progress.cancel ? 'Cancelled.' : sentenceFor(err, 'the server log has the cause.');
    console.error('[Component items] Search failed:', err);
    throw err;
  } finally {
    // The captured reference, so a later run's entry is never the one deleted.
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(UNESCO_SOURCE_ID) === thisProgress) runningSyncs.delete(UNESCO_SOURCE_ID);
    }, 60000);
  }
}

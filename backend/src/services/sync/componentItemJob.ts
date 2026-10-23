/**
 * The admin panel's "Find component items" (#1272): `findComponentItems` run in
 * the background for the World Heritage source, reported through the same
 * status the source's card polls for a sync or a picture repair.
 *
 * It writes proposals, and a curator's answer is what records an item on a
 * point (ADR-0046), save one kind whose answer is already known: an exact
 * candidate nothing contradicts, which the pass then accepts itself through
 * `accept` (ADR-0141), the caller's, since the answer is a curator-side write.
 * It can be run again:
 * a second pass replaces what is still unanswered and never brings back a
 * candidate a curator refused. Given a site (#1429), it asks about that site's
 * components only, for a curator working through one site or a change measured
 * on the site it was made for, under the same manners and the same report.
 */

import { sentenceFor } from '../../api/readerFacingError.js';
import { Operation } from '../operationProgress.js';
import { FINDER_STEPS, findComponentItems, type ComponentItemReport } from './componentItemFinder.js';
import { findPointHints, type PointHintsReport } from './pointHints.js';
import { WaitBudget } from './sourceRetry.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from './types.js';
import { SPARQL_WAIT_BUDGET_MS, sayWait } from './wikidataUtils.js';

const UNESCO_SOURCE_ID = 1;
const LOG_PREFIX = '[Component items]';

/** What the pass's own answers recorded: the points, on how many sites, and the candidates left for the next pass. */
export interface CatalogueAnswers {
  accepted: number;
  sites: number;
  leftForNextPass: number;
}

export async function findUnescoComponentItems(
  _triggeredBy: number | null,
  site?: { id: number; name: string },
  accept?: (siteId: number | undefined, run: { isCancelled: () => boolean }) => Promise<CatalogueAnswers>,
): Promise<void> {
  const existing = runningSyncs.get(UNESCO_SOURCE_ID);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw new Error('UNESCO sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    kind: 'components',
    status: 'fetching',
    statusMessage: site
      ? `Reading the components of ${site.name} no Wikidata item records...`
      : 'Reading the components no Wikidata item records...',
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
  const operation = new Operation(LOG_PREFIX, FINDER_STEPS);
  progress.operation = operation;
  runningSyncs.set(UNESCO_SOURCE_ID, progress);

  try {
    const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
    const { report } = await findComponentItems({
      write: true,
      siteId: site?.id,
      hooks: {
        budget,
        isCancelled: () => progress.cancel,
        onAnswered: (count) => { operation.advance(count); },
        onWait: (wait) => { sayWait(progress, 'Wikidata', wait, budget); },
      },
      onStep: (index, sentence, total) => {
        progress.statusMessage = sentence;
        operation.step(index, sentence, total);
      },
    });
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      operation.finish('cancelled');
      return;
    }
    const after = await afterSearch(progress, site, accept);
    if (!after) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      operation.finish('cancelled');
      return;
    }
    progress.status = 'complete';
    progress.created = report.partOf + report.near + report.toponym + report.numbered;
    progress.statusMessage = sentenceOf(report, site) + acceptedSentence(after.taken) + hintsSentence(after.hints);
    operation.finish(`${report.queries} requests to Wikidata's API; ${progress.statusMessage}`);
  } catch (err) {
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = progress.cancel ? 'Cancelled.' : sentenceFor(err, 'the server log has the cause.');
    operation.finish(progress.cancel ? 'cancelled' : 'failed');
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

/**
 * What the pass does once its search is over: accept the exact candidates
 * nothing contradicts (ADR-0141), then work out where the components the list
 * placed only roughly may stand (#1853). Null where the pass was cancelled.
 */
async function afterSearch(
  progress: SyncProgress,
  site: { id: number; name: string } | undefined,
  accept: ((siteId: number | undefined, run: { isCancelled: () => boolean }) => Promise<CatalogueAnswers>) | undefined,
): Promise<{ taken: CatalogueAnswers | null; hints: PointHintsReport } | null> {
  progress.statusMessage = 'Recording the exact candidates nothing contradicts...';
  const taken = accept ? await accept(site?.id, { isCancelled: () => progress.cancel }) : null;
  if (progress.cancel) return null;
  progress.statusMessage = 'Finding where the components placed only roughly may stand...';
  const hints = await findPointHints(site?.id);
  return progress.cancel ? null : { taken, hints };
}

/** Where the roughly placed components may stand, as the closing line's last clause. */
function hintsSentence(hints: PointHintsReport): string {
  return hints.points > 0 ? `; ${hints.hints} hints of where ${hints.points} roughly placed components may stand` : '';
}

/** What the pass's own answers recorded, as the closing line's clause. */
function acceptedSentence(taken: CatalogueAnswers | null): string {
  if (!taken) return '';
  const left = taken.leftForNextPass > 0 ? `, ${taken.leftForNextPass} left for the next pass` : '';
  return `; ${taken.accepted} of the same name at the point recorded without a curator, on ${taken.sites} sites${left}`;
}

/** What a finished pass found, as the source's card says it. */
function sentenceOf(report: ComponentItemReport, site?: { id: number; name: string }): string {
  return (site ? `${site.name}: ` : '')
    + `${report.partOf + report.near + report.toponym} of ${report.points} components without an item have a candidate`
    + ` — ${report.partOf} named as parts of their site, ${report.near} found near the point`
    + (report.toponym > 0 ? `, ${report.toponym} near the point carrying a place name of the component's` : '')
    + `, ${report.exact} of the same name at the point`
    + (report.numbered > 0 ? `; ${report.numbered} more carry a component's number under another inscription` : '')
    + (report.wholeSites > 0 ? `; ${report.wholeSites} stand for their whole site and were not searched` : '')
    + (report.settlements > 0 ? `; ${report.settlements} settlements set aside` : '')
    + (report.atTheComponent > 0 ? `; ${report.atTheComponent} near candidates standing at their component set aside` : '')
    + `; read from the Wikidata subset of the ${report.dumpDate} dump`;
}

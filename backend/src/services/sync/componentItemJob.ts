/**
 * The admin panel's "Find component items" (#1272): `findComponentItems` run in
 * the background for the World Heritage source, reported through the same
 * status the source's card polls for a sync or a picture repair — and the
 * same search run as a step of the source's own run, for the components the
 * run has just left without an item (#1805, `afterRun.ts`).
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

/** The catalogue's own answer to the exact candidates nothing contradicts (ADR-0141), the controller's. */
export type AcceptExact = (siteId: number | undefined, run: { isCancelled: () => boolean }) => Promise<CatalogueAnswers>;

/** What one search covers: every component, one site's (#1429), or the points named (#1805). */
export interface SearchScope {
  site?: { id: number; name: string };
  pointIds?: readonly number[];
}

/** What one search came to: its closing sentence, the candidates it proposed, and what it cost. */
export interface SearchOutcome {
  sentence: string;
  candidates: number;
  /** The requests sent to Wikidata, which the job's finish line records: the cost a change to the search is measured by. */
  queries: number;
}

/**
 * Run the finder on `progress`, reporting its steps through `operation`, then
 * accept the exact candidates nothing contradicts. Answers what the search
 * came to, or null where it was cancelled. The caller owns the entry, its
 * status and its counts; this writes the status message and the operation's
 * steps.
 */
export async function runComponentItemSearch(
  progress: SyncProgress,
  operation: Operation,
  scope: SearchScope,
  accept?: AcceptExact,
): Promise<SearchOutcome | null> {
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const { report } = await findComponentItems({
    write: true,
    siteId: scope.site?.id,
    pointIds: scope.pointIds,
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
  if (progress.cancel) return null;
  progress.statusMessage = 'Recording the exact candidates nothing contradicts...';
  const taken = accept ? await accept(scope.site?.id, { isCancelled: () => progress.cancel }) : null;
  if (progress.cancel) return null;
  return {
    sentence: sentenceOf(report, scope.site) + acceptedSentence(taken),
    candidates: report.partOf + report.near + report.toponym + report.numbered,
    queries: report.queries,
  };
}

export async function findUnescoComponentItems(
  _triggeredBy: number | null,
  site?: { id: number; name: string },
  accept?: AcceptExact,
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
    const found = await runComponentItemSearch(progress, operation, { site }, accept);
    if (found === null) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      operation.finish('cancelled');
      return;
    }
    // The job's own entry, so what it proposed is what it created; as a step
    // of a run the count stays the run's.
    progress.created += found.candidates;
    progress.statusMessage = 'Finding where the components placed only roughly may stand...';
    const hints = await findPointHints(site?.id);
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      operation.finish('cancelled');
      return;
    }
    progress.status = 'complete';
    progress.statusMessage = found.sentence + hintsSentence(hints);
    operation.finish(`${found.queries} requests to Wikidata's API; ${progress.statusMessage}`);
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

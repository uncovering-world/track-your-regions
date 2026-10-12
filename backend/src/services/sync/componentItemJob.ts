/**
 * The admin panel's "Find component items" (#1272): `findComponentItems` run in
 * the background for the World Heritage source, reported through the same
 * status the source's card polls for a sync or a picture repair.
 *
 * It writes proposals only — a curator's answer is what records an item on a
 * point (ADR-0046) — so it needs no review of its own and can be run again:
 * a second pass replaces what is still unanswered and never brings back a
 * candidate a curator refused.
 *
 * Once the proposals are written, and where an admin turned it on (#1355),
 * Jev is asked about the candidates it has not judged as they stand, the
 * question the card asks, within a budget for the pass, checked against an
 * estimate of each site's questions before it is asked: Jev is paid by the
 * token. The judging is handed in by the caller (`JudgeCandidates`),
 * which owns the writes to the judgements; without it the pass is as before,
 * and every candidate is asked about when a curator opens its card.
 */

import { sentenceFor } from '../../api/readerFacingError.js';
import { findComponentItems, type ComponentItemReport } from './componentItemFinder.js';
import { WaitBudget } from './sourceRetry.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from './types.js';
import { SPARQL_WAIT_BUDGET_MS, waitMessage } from './wikidataUtils.js';

const UNESCO_SOURCE_ID = 1;
const LOG_PREFIX = '[Component items]';

/** What one site's Jev call came to; `failed` where the call did not answer at all. */
export interface JudgedTally {
  asked: number;
  same: number;
  other: number;
  refused: number;
  inputTokens: number;
  failed: boolean;
}

/** A call that asked nothing. */
export const noJudgements = (): JudgedTally => ({ asked: 0, same: 0, other: 0, refused: 0, inputTokens: 0, failed: false });

/** A site with candidates Jev has not judged as they stand, and how many. */
export interface UnjudgedSite { experienceId: number; unjudged: number }

/**
 * How the pass has Jev judge the candidates it proposed: the sites to ask
 * about, in the order they are worth asking, one site's call, and what the
 * pass may spend (`@tyr/shared/jevSettings`), in input tokens.
 */
export interface JudgeCandidates {
  budgetUsd: number;
  budgetTokens: number;
  sites: () => Promise<UnjudgedSite[]>;
  site: (experienceId: number) => Promise<JudgedTally>;
}

/**
 * The input tokens a question is reckoned at before it is asked: above the
 * 533 of the 90th percentile and short of the 729 most of the 119 questions
 * recorded on 2026-10-12, so a site is left out rather than the budget passed.
 */
export const TOKENS_PER_QUESTION = 600;

/** What the pass's questions came to, the candidates the budget left for their card, and those a failed call did. */
interface Judged extends JudgedTally { budgetUsd: number; left: number; unasked: number }

/**
 * Ask Jev about the sites with unjudged candidates, one site a call, while the
 * budget allows: the tokens spent so far and the site's questions reckoned at
 * `TOKENS_PER_QUESTION`. A site that would pass it is left whole for its
 * card, and a smaller one after it is still asked.
 */
async function judgeAll(judge: JudgeCandidates, progress: SyncProgress): Promise<Judged> {
  const total: Judged = { ...noJudgements(), budgetUsd: judge.budgetUsd, left: 0, unasked: 0 };
  const sites = await judge.sites();
  for (const [i, { experienceId, unjudged }] of sites.entries()) {
    if (progress.cancel) break;
    // A call that failed is not tried on every other site: Jev is down or
    // refusing, and the rest wait for their cards.
    if (total.failed) { total.unasked += unjudged; continue; }
    if (total.inputTokens + unjudged * TOKENS_PER_QUESTION > judge.budgetTokens) { total.left += unjudged; continue; }
    progress.statusMessage = `Asking Jev about the candidates of site ${i + 1} of ${sites.length}`;
    const one = await judge.site(experienceId);
    total.asked += one.asked; total.same += one.same; total.other += one.other;
    total.refused += one.refused; total.inputTokens += one.inputTokens;
    if (one.failed) { total.failed = true; total.unasked += unjudged; }
  }
  return total;
}

/** The pass's Jev questions in the summary's words; nothing where none was asked or left. */
function judgedWords(judged: Judged | null): string {
  if (!judged) return '';
  const unanswered = judged.refused > 0 ? `, ${judged.refused} unanswered` : '';
  const asked = judged.asked === 0 ? '' : `; Jev judged ${judged.asked} candidates — ${judged.same} the same place, `
    + `${judged.other} another${unanswered} — for ${judged.inputTokens} input tokens`;
  const left = judged.left === 0 ? '' : `; ${judged.left} candidates past the pass's budget of $${judged.budgetUsd} wait for their card`;
  const failed = judged.failed ? `; Jev did not answer, so ${judged.unasked} candidates wait for their card` : '';
  return asked + left + failed;
}

/** The pass's outcome in the words the source's card shows. */
function summaryOf(report: ComponentItemReport, judged: Judged | null): string {
  return `${report.partOf + report.near} of ${report.points} components without an item have a candidate for a curator`
    + ` — ${report.partOf} named as parts of their site, ${report.near} found near the point`
    + `, ${report.exact} of the same name at the point`
    + (report.numbered > 0 ? `; ${report.numbered} more carry a component's number under another inscription` : '')
    + (report.unsearched > 0 ? `; ${report.unsearched} could not be searched around, as Wikidata did not answer` : '')
    + (report.unreadSites > 0 ? `; the parts of ${report.unreadSites} sites could not be read` : '')
    + (report.wholeSites > 0 ? `; ${report.wholeSites} stand for their whole site and were not searched` : '')
    + (report.settlements > 0 ? `; ${report.settlements} settlements set aside` : '')
    + (report.atTheComponent > 0 ? `; ${report.atTheComponent} near candidates standing at their component set aside` : '')
    + judgedWords(judged);
}

export async function findUnescoComponentItems(_triggeredBy: number | null, judge?: JudgeCandidates): Promise<void> {
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
    const judged = judge ? await judgeAll(judge, progress) : null;
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled.';
      return;
    }
    progress.status = 'complete';
    progress.created = report.partOf + report.near + report.numbered;
    progress.statusMessage = summaryOf(report, judged);
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

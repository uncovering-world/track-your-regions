/**
 * Giving the World Heritage catalogue pictures it is allowed to show.
 *
 * The repair half of ADR-0043. The run itself proposes rather than writes —
 * UNESCO is a gated category, so a picture arriving through
 * `unescoSyncService` reaches a curator as a held proposal, and 1260 rows
 * carrying a picture the World Heritage Centre's terms do not let this product
 * draw are not a queue of 1260 questions. Taking those pictures off, and putting
 * a Commons one in their place, is an operator's decision about the catalogue —
 * the same shape as the museums' "fix missing images", started from the same
 * panel button, writing now.
 *
 * What it does per row, in the order that matters:
 *   1. Wikidata states a Commons picture for the property → write it, with the
 *      credit Commons gives for that file.
 *   2. Nothing states one, and the row carries a picture the product may not
 *      show → take it away. A card with no picture keeps the link to the
 *      property's own page, which is the use those terms invite.
 *   3. Nothing states one and the row's picture is fine → leave it alone.
 * A picture a curator owns is never touched, in any of the three.
 */

import { pool } from '../../db/index.js';
import { isDisplayablePictureUrl } from '../../types/urlSafety.js';
import {
  fetchCommonsCredits, readStoredCredits, type ImageCredit, type StoredCredit,
} from './imageCredit.js';
import { clearUnshowablePicture, writeFoundPicture } from './pictureRepair.js';
import { WaitBudget } from './sourceRetry.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from './types.js';
import {
  factsForSite, fetchWorldHeritageFacts, type WorldHeritageIndex,
} from './unescoWikidata.js';
import {
  delay, waitMessage, SPARQL_DELAY_MS, SPARQL_WAIT_BUDGET_MS, WIKIDATA_USER_AGENT,
} from './wikidataUtils.js';

const UNESCO_CATEGORY_ID = 1;
const LOG_PREFIX = '[UNESCO Sync]';

interface SiteRow {
  id: number;
  external_id: string;
  name: string;
  image_url: string | null;
}

/** What this action did, so the panel can say it in one sentence. */
export interface PictureRepairReport {
  /** Rows given a Commons picture. */
  fixed: number;
  /** Rows whose picture was taken away because nothing may replace it. */
  cleared: number;
  /** Rows Wikidata states no picture for, whose stored picture is fine as it is. */
  untouched: number;
  /** Rows whose picture a curator owns. */
  kept: number;
}

/**
 * The rows this action has anything to do: every site whose picture is missing,
 * or is one the product may not show.
 *
 * The host rule is asked in TypeScript rather than spelled again as a `LIKE`,
 * because there is one list of hosts and it lives in `urlSafety.ts`. 1272 rows
 * is one query and a pass over an array; a second copy of the rule in SQL is a
 * copy that can disagree with the one the writer enforces.
 */
export function sitesNeedingAPicture(rows: SiteRow[]): SiteRow[] {
  return rows.filter((row) => !row.image_url || !isDisplayablePictureUrl(row.image_url));
}

async function readSites(): Promise<SiteRow[]> {
  const result = await pool.query(
    `SELECT id, external_id, name, image_url
       FROM experiences
      WHERE category_id = $1
      ORDER BY name`,
    [UNESCO_CATEGORY_ID],
  );
  return result.rows as SiteRow[];
}

/**
 * The files whose photographer has to be asked for: every picture about to be
 * written whose row does not already hold a credit for that same file.
 */
function picturesToAskAbout(
  rows: SiteRow[],
  facts: WorldHeritageIndex,
  stored: Map<string, StoredCredit>,
): string[] {
  const wanted = new Set<string>();
  for (const row of rows) {
    const picture = factsForSite(facts, row.external_id).picture;
    if (!picture) continue;
    const known = stored.get(row.external_id);
    if (known?.credit && known.imageUrl === picture.url) continue;
    wanted.add(picture.url);
  }
  return [...wanted];
}

/**
 * Who took the pictures about to be written.
 *
 * Asked before the write loop rather than per row: it is one batch of up to
 * fifty files per request either way, and a card must never appear with a
 * photograph and no name.
 */
async function creditsFor(
  urls: string[],
  progress: SyncProgress,
  budget: WaitBudget,
): Promise<Map<string, ImageCredit>> {
  if (urls.length === 0) return new Map();
  progress.statusMessage = `Asking Commons who took ${urls.length} pictures...`;
  return fetchCommonsCredits(urls, {
    userAgent: WIKIDATA_USER_AGENT,
    budget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => { progress.statusMessage = waitMessage('Commons', wait, budget); },
    pause: () => delay(SPARQL_DELAY_MS),
  });
}

/**
 * Write what was found, and take away what may not stand.
 *
 * A curator's claim is what separates `kept` from the rest, and it is read from
 * the write's own answer rather than from a column read beforehand: the two
 * statements in `pictureRepair.ts` refuse a claimed row themselves, so a claim
 * made while this action runs is honoured rather than raced.
 */
async function repairRows(
  rows: SiteRow[],
  facts: WorldHeritageIndex,
  credits: Map<string, ImageCredit>,
  progress: SyncProgress,
): Promise<PictureRepairReport> {
  const report: PictureRepairReport = { fixed: 0, cleared: 0, untouched: 0, kept: 0 };

  for (let i = 0; i < rows.length; i++) {
    if (progress.cancel) throw new Error('Sync cancelled');
    const row = rows[i];
    progress.currentItem = row.name;
    progress.progress = i + 1;
    progress.statusMessage = `Fixing ${i + 1}/${rows.length}: ${row.name}`;

    const picture = factsForSite(facts, row.external_id).picture;
    // A file the product may not show — a PDF under a P18 — is answered exactly
    // as no picture is: written, it would be re-selected on every run.
    const wrote = picture
      ? await writeFoundPicture(row.id, picture.url, credits.get(picture.url))
      : 'refused';
    if (wrote === 'written') { report.fixed++; continue; }
    if (wrote === 'kept') { report.kept++; continue; }
    // Nothing to put there. A stored picture the product may not show still has
    // to go; a row that simply has none is left as it is.
    if (!row.image_url) {
      report.untouched++;
    } else if (await clearUnshowablePicture(row.id)) {
      report.cleared++;
    } else {
      report.kept++;
    }
  }

  return report;
}

/**
 * Replace every World Heritage picture the product may not show, from Commons.
 *
 * Runs in the background like the syncs do, reporting through the same
 * `runningSyncs` entry the panel polls, and refusing to start while a UNESCO run
 * is in flight — the two would write the same column from two different beliefs
 * about who owns it.
 */
export async function fixUnescoImages(_triggeredBy: number | null): Promise<void> {
  const existing = runningSyncs.get(UNESCO_CATEGORY_ID);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw new Error('UNESCO sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    kind: 'repair',
    status: 'processing',
    statusMessage: 'Finding sites whose picture we may not show...',
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
  runningSyncs.set(UNESCO_CATEGORY_ID, progress);

  try {
    const rows = sitesNeedingAPicture(await readSites());
    progress.total = rows.length;
    console.log(`${LOG_PREFIX} Fix images: ${rows.length} sites without a picture we may show`);
    if (rows.length === 0) {
      progress.status = 'complete';
      progress.statusMessage = 'Every site already shows a picture we may show';
      return;
    }

    const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
    progress.statusMessage = 'Asking Wikidata for a Commons picture of each property...';
    const facts = await fetchWorldHeritageFacts(progress, budget);
    // No answer is not "no pictures". Taking a picture off a row is right once
    // Wikidata has been asked and has said nothing for it; done on a day the
    // query service did not answer, it would empty every selected row and
    // report the work complete. So the repair stops here, with the rows as they
    // were, and says why.
    if (!facts) {
      throw new Error('Wikidata did not answer, so nothing was changed — try again later');
    }

    const credits = await creditsFor(
      picturesToAskAbout(rows, facts, await readStoredCredits(UNESCO_CATEGORY_ID)),
      progress, budget,
    );

    const report = await repairRows(rows, facts, credits, progress);

    progress.status = 'complete';
    progress.created = report.fixed;
    progress.updated = report.cleared;
    const curated = report.kept > 0 ? `, ${report.kept} left as the curator set them` : '';
    progress.statusMessage =
      `${report.fixed} given a Commons picture, ${report.cleared} left without one`
      + `, ${report.untouched} had none either way${curated}`;
    console.log(`${LOG_PREFIX} Fix images complete: ${progress.statusMessage}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;
    // A literal first argument, as the museum repair logs it: the message is
    // the format string, and one built from a variable is what Semgrep flags.
    console.error('[UNESCO Sync] Fix images failed:', errorMsg);
    throw err;
  } finally {
    // The captured reference, so a later run's entry is never the one deleted.
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(UNESCO_CATEGORY_ID) === thisProgress) {
        runningSyncs.delete(UNESCO_CATEGORY_ID);
      }
    }, 60000);
  }
}

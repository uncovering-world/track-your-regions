/**
 * Re-fetching a picture from Wikidata for a row that already exists, on demand
 * from the admin panel — the museums' familiar "fix missing images" action,
 * pulled out of `museumSyncService.ts` so a second kind whose rows also carry
 * a Wikidata QID can run its own repair through the same mechanism rather than
 * sharing the museum's. `makeWikidataPictureRepair` closes over what makes one
 * source's repair different from another's: which category's rows to look at,
 * and the line its log messages carry.
 */

import { pool } from '../../db/index.js';
import { fetchCommonsCredits, type ImageCredit } from './imageCredit.js';
import { writeFoundPicture } from './pictureRepair.js';
import { fetchEntityDetails, isQid } from './museum/queries.js';
import type { SparqlFn } from './wikidataQueries.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  waitMessage,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
} from './wikidataUtils.js';
import { isTerminalSyncStatus, runningSyncs, type SyncProgress } from './types.js';

const ENTITY_BATCH = 50;

/** Wikimedia image URLs for a set of QIDs, batched. */
async function fetchWikidataImages(
  qids: string[],
  progress: SyncProgress,
  logPrefix: string,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  // The same door as every other query this service sends. It used to be a bare
  // `sparqlQuery` with none of the three: no cancel check, no reporter, and no
  // shared budget — so `sparqlQuery` minted a fresh fifteen minutes *per batch*.
  // At `ENTITY_BATCH = 50` that is hours for a few hundred museums, none of it
  // interruptible, while `runningSyncs` shows the card as running with a Cancel
  // button on it. Raising the retry ceiling is what made the arithmetic bite.
  const door = wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), logPrefix);
  // `SparqlFn`'s second parameter is a cache descriptor and the door's is a
  // retry count, so the two signatures cannot be passed for each other. This
  // pass describes no question and caches nothing, which is why the descriptor
  // is dropped rather than forwarded.
  const sparql: SparqlFn = (query) => door(query);
  for (let i = 0; i < qids.length; i += ENTITY_BATCH) {
    if (progress.cancel) throw new Error('Sync cancelled');
    progress.statusMessage =
      `Fetching image URLs from Wikidata (${Math.min(i + ENTITY_BATCH, qids.length)}/${qids.length})...`;
    const details = await fetchEntityDetails(sparql, qids.slice(i, i + ENTITY_BATCH));
    for (const [qid, row] of details) {
      if (row.imageUrl) images.set(qid, row.imageUrl);
    }
    if (i + ENTITY_BATCH < qids.length) await delay(SPARQL_DELAY_MS);
  }
  return images;
}

/**
 * Write every picture this action found, and report what happened to each row.
 *
 * Three outcomes rather than two, because they have different causes and only
 * one of them is a problem: `fixed` is a picture written, `failed` is a row
 * Wikidata offered none for, and `kept` is a row whose picture a curator owns.
 * Folding the last into either of the others would blame the source for a
 * person's decision, or claim a write that never happened.
 */
async function writeFixedImages(
  rows: { id: number; external_id: string; name: string }[],
  images: Map<string, string>,
  credits: Map<string, ImageCredit>,
  progress: SyncProgress,
): Promise<{ fixed: number; failed: number; kept: number }> {
  let fixed = 0;
  let failed = 0;
  let kept = 0;

  for (let i = 0; i < rows.length; i++) {
    if (progress.cancel) throw new Error('Sync cancelled');

    const row = rows[i];
    const imageUrl = images.get(row.external_id);
    progress.currentItem = row.name;
    progress.statusMessage = `Fixing ${i + 1}/${rows.length}: ${row.name}`;
    progress.progress = i + 1;

    if (!imageUrl) {
      failed++;
      continue;
    }
    // A file Wikidata calls an image and is not one counts as none found: the
    // writer refuses it, and this row is asked about again next time.
    const wrote = await writeFoundPicture(row.id, imageUrl, credits.get(imageUrl));
    if (wrote === 'written') fixed++;
    else if (wrote === 'kept') kept++;
    else failed++;
  }

  return { fixed, failed, kept };
}

/**
 * Who took the pictures this action is about to put on cards.
 *
 * Asked before the write loop rather than per row: it is one batch of up to
 * fifty files per request either way, and a card must never appear with a
 * photograph and no name — the standing rule is that anything displaying an
 * experience picture shows the credit with it.
 */
async function creditsForFixedImages(
  imageUrls: string[],
  progress: SyncProgress,
): Promise<Map<string, ImageCredit>> {
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  return fetchCommonsCredits(imageUrls, {
    userAgent: WIKIDATA_USER_AGENT,
    budget,
    isCancelled: () => progress.cancel,
    // Nothing else writes the status between the SPARQL pass and the write
    // loop, so without this a bad day at Commons is a sentence frozen on the
    // panel for as long as the budget lasts — the hung-looking run this whole
    // change set exists to stop showing.
    onWait: (wait) => { progress.statusMessage = waitMessage('Commons', wait, budget); },
    pause: () => delay(SPARQL_DELAY_MS),
  });
}

/**
 * Build the repair for one source: fix missing images — re-fetch a Wikidata
 * picture for every row of `categoryId` that has none, or still carries an old
 * local path. `categoryId` picks the rows and doubles as the `runningSyncs`
 * key it refuses a second start under; `logPrefix` names the source in the
 * lines it logs and in the message of the "already running" refusal, the way
 * `syncOrchestrator.ts` names a sync; `noun` names what a row *is* in those
 * same lines, so a museum's repair reads "museums" and a place of worship's
 * reads "places" rather than borrowing the other source's word.
 */
export function makeWikidataPictureRepair(
  categoryId: number, logPrefix: string, noun: { singular: string; plural: string },
): (triggeredBy: number | null) => Promise<void> {
  return async function fixImages(_triggeredBy: number | null): Promise<void> {
    // Check if already running
    const existing = runningSyncs.get(categoryId);
    if (existing && !isTerminalSyncStatus(existing.status)) {
      throw new Error(`${logPrefix} sync already in progress`);
    }

    const progress: SyncProgress = {
      cancel: false,
      kind: 'repair',
      status: 'processing',
      statusMessage: `Fixing missing ${noun.singular} images...`,
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
    runningSyncs.set(categoryId, progress);

    try {
      // Find rows missing an image or with an old local path
      const result = await pool.query(`
        SELECT id, external_id, name, metadata
        FROM experiences
        WHERE category_id = $1
          AND (image_url IS NULL OR image_url = '' OR image_url LIKE '/images/%')
          AND metadata IS NOT NULL
      `, [categoryId]);

      const rows = result.rows;
      progress.total = rows.length;
      progress.statusMessage = `Found ${rows.length} ${noun.plural} without images`;
      console.log('%s Fix images: %d %s missing images', logPrefix, rows.length, noun.plural);

      if (rows.length === 0) {
        progress.status = 'complete';
        progress.statusMessage = `All ${noun.plural} already have images`;
        return;
      }

      // Re-fetch image URLs from Wikidata for these rows.
      //
      // Filtered to real QIDs: a curator can create a row by hand, and its key
      // is `curator-<id>-<ts>`, which interpolates into the VALUES clause as
      // `wd:curator-5-1754…` and makes Wikidata reject the whole batch — so one
      // hand-made row would cost every other row on the page its image.
      const qids = rows
        .map((m: { external_id: string }) => m.external_id)
        .filter(isQid);
      progress.statusMessage = 'Fetching image URLs from Wikidata...';
      const images = await fetchWikidataImages(qids, progress, logPrefix);

      const credits = await creditsForFixedImages([...images.values()], progress);

      const { fixed, failed, kept } = await writeFixedImages(rows, images, credits, progress);

      progress.status = 'complete';
      progress.created = fixed;
      progress.errors = failed;
      const curated = kept > 0 ? `, ${kept} left as the curator set them` : '';
      progress.statusMessage = `Fixed images: ${fixed} updated, ${failed} no image found${curated}`;
      console.log(
        '%s Fix images complete: %d updated, %d no image found%s', logPrefix, fixed, failed, curated,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      progress.status = progress.cancel ? 'cancelled' : 'failed';
      progress.statusMessage = errorMsg;
      console.error('%s Fix images failed:', logPrefix, errorMsg);
      throw err;
    } finally {
      const thisProgress = progress;
      setTimeout(() => {
        if (runningSyncs.get(categoryId) === thisProgress) {
          runningSyncs.delete(categoryId);
        }
      }, 30000);
    }
  };
}

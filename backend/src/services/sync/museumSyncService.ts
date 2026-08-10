/**
 * Museum Sync Service
 *
 * Collects the works the world knows, then admits the museums that hold them. The selection
 * itself lives in `museum/` — one tested module per rule, composed by `museum/pipeline.ts`;
 * this file is the run around it: read what the last run left, hand the proposal to the
 * orchestrator, and write museums as experiences and their works as treasures.
 *
 * The rule it replaced asked which Wikidata entity owns famous paintings and called the answer
 * a museum, which is how the catalogue came to hold four Louvre departments and no Louvre.
 */

import { pool } from '../../db/index.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { retirePassAfterNewContent } from './curationDecay.js';
import { orchestrateSync, getSyncStatus, cancelSync, type FilteredEntity } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import type { ChangeSetResult } from './changeSet.js';
import type {
  SyncProgress,
  ProcessedContent,
  CollectedMuseum,
} from './types.js';
import { isTerminalSyncStatus, runningSyncs } from './types.js';
import { collectTier1Museums } from './museum/pipeline.js';
import { fetchEntityDetails, isQid } from './museum/queries.js';
import { ICONIC_SITELINKS, ICONIC_RELEASE } from './museum/tier1.js';
import {
  sparqlQuery,
  delay,
  SPARQL_DELAY_MS,
} from './wikidataUtils.js';
// Museums use remote Wikimedia URLs, no local image storage

const MUSEUM_CATEGORY_ID = 2;
const ENTITY_BATCH = 50;

const LOG_PREFIX = '[Museum Sync]';

/** One SPARQL door for the whole pipeline, so a test can close it. */
const sparql = (query: string) => sparqlQuery(query, LOG_PREFIX);

// =============================================================================
// Fetch
// =============================================================================

/**
 * Where the last run left each work.
 *
 * Read from what is actually stored rather than from a record of the previous proposal, because
 * that is what the placement diff has to be measured against: a work the database holds under a
 * museum this run no longer names is the thing worth printing.
 */
async function readPreviousPlacements(): Promise<Record<string, string[]>> {
  const result = await pool.query(
    `SELECT t.external_id AS work, e.external_id AS venue
       FROM experience_treasures et
       JOIN treasures t ON t.id = et.treasure_id
       JOIN experiences e ON e.id = et.experience_id
      WHERE e.category_id = $1`,
    [MUSEUM_CATEGORY_ID],
  );
  const placements: Record<string, string[]> = {};
  for (const row of result.rows as { work: string; venue: string }[]) {
    const held = placements[row.work] ?? [];
    held.push(row.venue);
    placements[row.work] = held;
  }
  return placements;
}

async function fetchMuseumItems(
  progress: SyncProgress,
): Promise<{ items: CollectedMuseum[]; fetchedCount: number; filtered: FilteredEntity[] }> {
  const previousPlacements = await readPreviousPlacements();

  const { items, fetched, filtered } = await collectTier1Museums({
    sparql,
    previousPlacements,
    onPhase: (message) => { progress.statusMessage = message; },
    checkCancel: () => {
      if (progress.cancel) throw new Error('Sync cancelled');
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  return { items, fetchedCount: fetched, filtered };
}

// =============================================================================
// Write
// =============================================================================

/**
 * Upsert a museum as an experience.
 *
 * `category` is the venue type, not UNESCO's triple: this category holds art museums and says
 * so. `country` is deliberately absent from the metadata — `country_names` already carries it,
 * and when both existed they disagreed.
 */
async function upsertMuseumExperience(
  museum: CollectedMuseum,
  context: SyncRunContext,
): Promise<{ experienceId: number; changeSet: ChangeSetResult; nameSnapshot: string;
             returnedFromMissing: boolean }> {
  const details = museum.details!;

  // Total sitelinks across all artworks as a ranking metric
  const totalSitelinks = museum.artworks.reduce((sum, a) => sum + a.sitelinksCount, 0);

  const metadata = {
    wikidataQid: museum.qid,
    website: details.website,
    wikipediaUrl: details.articleUrl || null,
    artworkCount: museum.artworks.length,
    totalArtworkSitelinks: totalSitelinks,
    // The reason this row exists, nameable: the most famous iconic work it holds.
    admittedFor: museum.admittedFor ?? null,
  };

  // Store remote Wikimedia URL directly (thumbnailing handled by frontend)
  const imageUrl = details.imageUrl || null;

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    categoryId: MUSEUM_CATEGORY_ID,
    externalId: museum.qid,
    name: details.museumLabel,
    nameLocal: { en: details.museumLabel },
    description: details.description,
    shortDescription: null,
    category: 'art',
    tags: ['museum'],
    lon: details.lon!,
    lat: details.lat!,
    countryCodes: [],
    countryNames: details.countryLabel ? [details.countryLabel] : [],
    imageUrl,
    metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  if (!context.dryRun) {
    // Every museum admitted here holds a work above the iconic threshold, so the flag is a
    // property of belonging to this category rather than a field the source proposes — which is
    // why it is written here and not through the curated_fields-aware upsert.
    //
    // It still honours the same guard by hand. Nothing sets `is_iconic` by hand today, so there
    // is nothing to overwrite yet; the moment a curation surface exists, a run without this
    // would restore `true` over a curator's `false` every time, and since the write is outside
    // the changeset the run's own record would not show the flip. COALESCE because the column
    // is nullable and `NULL ? 'x'` is NULL, which would skip the row rather than write it.
    await pool.query(
      `UPDATE experiences SET is_iconic = true
        WHERE id = $1 AND NOT is_iconic
          AND NOT COALESCE(curated_fields ? 'is_iconic', false)`,
      [experienceId],
    );

    const written = await upsertSingleLocation(experienceId, museum.qid, details.lon!, details.lat!);
    // Registered here rather than returned: `upsertMuseumTreasures` runs after
    // this and can throw, and a returned field would be lost with it while the
    // point had already moved on disk.
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
  }

  return { experienceId, changeSet, nameSnapshot, returnedFromMissing };
}

/**
 * Upsert artworks as treasures and link to experience via junction table.
 *
 * `is_iconic` is sticky on the way down: a work joins the highlights at `ICONIC_SITELINKS` and
 * only leaves below `ICONIC_RELEASE`, so the badge does not flicker on and off as Wikipedia
 * grows. Selection upstream uses the single threshold; only the stored flag has hysteresis.
 *
 * Exported for its test and called nowhere else: two of its promises live in a
 * parameter number and a `RETURNING` clause, which no caller can observe.
 */
export async function upsertMuseumTreasures(
  experienceId: number,
  artworks: ProcessedContent[]
): Promise<void> {
  let linked = false;

  for (const artwork of artworks) {
    // Step 1: Upsert into treasures (globally unique by external_id)
    //
    // `curation_state` is bound to `MUSEUM_CATEGORY_ID` directly rather than
    // reached through an experience: a treasure is globally shared and is not
    // owned by any one of them. It is set on insert only — absent from
    // `DO UPDATE SET` — because a work already stored may already have been
    // passed by a curator, and this run must not reset that (ADR-0025).
    const treasureResult = await pool.query(
      `INSERT INTO treasures (
        external_id, name, treasure_type, artist, year,
        image_url, sitelinks_count, is_iconic, metadata, curation_state, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN (SELECT requires_curation FROM experience_categories WHERE id = $12)
             THEN 'pending' ELSE 'auto' END,
        NOW(), NOW())
      ON CONFLICT (external_id) DO UPDATE SET
        name = EXCLUDED.name,
        treasure_type = EXCLUDED.treasure_type,
        artist = EXCLUDED.artist,
        year = EXCLUDED.year,
        image_url = EXCLUDED.image_url,
        sitelinks_count = EXCLUDED.sitelinks_count,
        is_iconic = CASE
          WHEN EXCLUDED.sitelinks_count >= $10 THEN true
          WHEN treasures.is_iconic THEN EXCLUDED.sitelinks_count >= $11
          ELSE false
        END,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id`,
      [
        artwork.externalId,
        artwork.name,
        artwork.treasureType,
        artwork.artist,
        artwork.year,
        artwork.imageUrl,
        artwork.sitelinksCount,
        artwork.sitelinksCount >= ICONIC_SITELINKS,
        null, // metadata
        ICONIC_SITELINKS,
        ICONIC_RELEASE,
        MUSEUM_CATEGORY_ID,
      ]
    );

    const treasureId = treasureResult.rows[0].id;

    // Step 2: Link treasure to experience via junction table. Unlike the
    // treasure above, a link does have an experience to read the gate through,
    // so it is reached the same way the location insert reaches it. Links are
    // never deleted (ADR-0023), so a link a curator already passed must keep
    // that state when a later run finds it again — insert-only, same as above.
    const link = await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state)
       VALUES ($1, $2,
         CASE WHEN (SELECT c.requires_curation
                      FROM experiences e JOIN experience_categories c ON c.id = e.category_id
                     WHERE e.id = $1)
              THEN 'pending' ELSE 'auto' END)
       ON CONFLICT (experience_id, treasure_id) DO NOTHING
       RETURNING treasure_id`,
      [experienceId, treasureId]
    );
    // `DO NOTHING` returns no row when the link was already there, so this is
    // "the museum gained a work", not "the run mentioned one".
    if (link.rows.length > 0) linked = true;
  }

  // Once for the museum rather than once per painting: the fact is that a
  // curator's pass no longer covers everything on show, and it is the same fact
  // whether one work arrived or twelve.
  if (linked) await retirePassAfterNewContent(pool, experienceId);
}

/**
 * Process a single museum: upsert experience + treasures
 */
async function processMuseum(
  museum: CollectedMuseum,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } =
    await upsertMuseumExperience(museum, context);

  // Treasures hang off a row a preview never wrote.
  if (!context.dryRun) {
    await upsertMuseumTreasures(experienceId, museum.artworks);
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function - fetches top museums from Wikidata and upserts to database
 */
export function syncMuseums(
  triggeredBy: number | null,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedMuseum>({
    categoryId: MUSEUM_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // The list length is a property of the data — the museums holding an iconic work — but it
    // is still a fame ranking: a museum absent from a run lost the work that admitted it, which
    // says nothing about whether it still exists.
    sourceCompleteness: 'ranked',
    // It does, however, say that the museum is not one of ours. Every run
    // recomputes the whole membership from the whole pool rather than fetching a
    // published list, so absence from the admitted set is this category's own
    // decision and belongs on the admission axis (ADR-0024) — which is a
    // different question from whether the place still exists, and is why both
    // lines stand together.
    recomputesMembership: true,
    fetchItems: fetchMuseumItems,
    processItem: processMuseum,
    getItemName: (m) => m.details?.museumLabel || m.label,
    getItemId: (m) => m.qid,
  }, triggeredBy, options);
}

/**
 * Get current museum sync status
 */
export function getMuseumSyncStatus() {
  return getSyncStatus(MUSEUM_CATEGORY_ID);
}

/**
 * Cancel running museum sync
 */
export function cancelMuseumSync() {
  return cancelSync(MUSEUM_CATEGORY_ID);
}

/** Wikimedia image URLs for a set of museum QIDs, batched. */
async function fetchMuseumImages(qids: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (let i = 0; i < qids.length; i += ENTITY_BATCH) {
    const details = await fetchEntityDetails(sparql, qids.slice(i, i + ENTITY_BATCH));
    for (const [qid, row] of details) {
      if (row.imageUrl) images.set(qid, row.imageUrl);
    }
    if (i + ENTITY_BATCH < qids.length) await delay(SPARQL_DELAY_MS);
  }
  return images;
}

/**
 * Fix missing museum images - re-download images for museums that have a
 * Wikidata image URL but no local image file.
 */
export async function fixMuseumImages(_triggeredBy: number | null): Promise<void> {
  // Check if already running
  const existing = runningSyncs.get(MUSEUM_CATEGORY_ID);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw new Error('Museum sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    status: 'processing',
    statusMessage: 'Fixing missing museum images...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    filtered: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun: false,
  };
  runningSyncs.set(MUSEUM_CATEGORY_ID, progress);

  try {
    // Find museums missing images or with old local paths
    const result = await pool.query(`
      SELECT id, external_id, name, metadata
      FROM experiences
      WHERE category_id = $1
        AND (image_url IS NULL OR image_url = '' OR image_url LIKE '/images/%')
        AND metadata IS NOT NULL
    `, [MUSEUM_CATEGORY_ID]);

    const museums = result.rows;
    progress.total = museums.length;
    progress.statusMessage = `Found ${museums.length} museums without images`;
    console.log(`[Museum Sync] Fix images: ${museums.length} museums missing images`);

    if (museums.length === 0) {
      progress.status = 'complete';
      progress.statusMessage = 'All museums already have images';
      return;
    }

    // Re-fetch image URLs from Wikidata for these museums.
    //
    // Filtered to real QIDs: a curator can create a museum by hand, and its key
    // is `curator-<id>-<ts>`, which interpolates into the VALUES clause as
    // `wd:curator-5-1754…` and makes Wikidata reject the whole batch — so one
    // hand-made row would cost every other museum on the page its image.
    const qids = museums
      .map((m: { external_id: string }) => m.external_id)
      .filter(isQid);
    progress.statusMessage = 'Fetching image URLs from Wikidata...';
    const images = await fetchMuseumImages(qids);

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < museums.length; i++) {
      if (progress.cancel) throw new Error('Sync cancelled');

      const museum = museums[i];
      const imageUrl = images.get(museum.external_id);
      progress.currentItem = museum.name;
      progress.statusMessage = `Fixing ${i + 1}/${museums.length}: ${museum.name}`;
      progress.progress = i + 1;

      if (!imageUrl) {
        failed++;
        continue;
      }

      // Store remote Wikimedia URL directly
      await pool.query(
        'UPDATE experiences SET image_url = $1, updated_at = NOW() WHERE id = $2',
        [imageUrl, museum.id]
      );
      fixed++;
    }

    progress.status = 'complete';
    progress.created = fixed;
    progress.errors = failed;
    progress.statusMessage = `Fixed images: ${fixed} updated, ${failed} no image found`;
    console.log(`[Museum Sync] Fix images complete: ${fixed} updated, ${failed} no image found`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;
    console.error(`[Museum Sync] Fix images failed:`, errorMsg);
    throw err;
  } finally {
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(MUSEUM_CATEGORY_ID) === thisProgress) {
        runningSyncs.delete(MUSEUM_CATEGORY_ID);
      }
    }, 30000);
  }
}

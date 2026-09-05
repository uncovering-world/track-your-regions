/**
 * Landmark Sync Service — the Public Art & Monuments source.
 *
 * Collects the public art the world knows, in stages (`publicArt/pipeline.ts`),
 * admits what the rule admits and refuses what it refuses with the reason on
 * the row (ADR-0024), keeps Wikidata's answers between runs (ADR-0030), and
 * writes each landmark as one experience with one point. No grouping, no
 * treasures — simpler than museums, and since #754 the same shape.
 */

import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import type { SyncProgress, WikidataLandmark, ContentsByKind } from './types.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult, ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import { admittedExternalIds } from './admission.js';
import { collectPublicArt } from './publicArt/pipeline.js';
import { withCache, type CacheDescriptor } from './wikidataCache.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  waitMessage,
} from './wikidataUtils.js';
import type { SparqlBinding } from './wikidataUtils.js';
import {
  fetchCommonsCredits,
  readStoredCredits,
  creditToWrite,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';

const LANDMARK_CATEGORY_ID = 3;
const LOG_PREFIX = '[Landmark Sync]';

/**
 * Credits for this run's photographs, keyed by image URL.
 *
 * Module state, like the UNESCO run's Wikipedia links: the orchestrator hands
 * `processItem` one landmark at a time, and asking Commons per landmark would
 * be 200 requests where four will do.
 */
let imageCredits = new Map<string, ImageCredit>();
/** What each landmark's row already says, so a failed credit pass erases nothing. */
let storedCredits = new Map<string, StoredCredit>();

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(externalId: string, imageUrl: string | null): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? imageCredits.get(imageUrl) : undefined,
    storedCredits.get(externalId),
    imageUrl,
  );
}

/**
 * The run's door to Wikidata, with the answers kept.
 *
 * The museum collector's shape (ADR-0030): one wait budget for the whole
 * collection, a cache keyed by the question, and `refreshCache` turning the
 * cache off for one run in both directions — a cache nobody can bypass is a
 * fork of reality. A hit says so on screen, because an admin who cannot tell
 * a cached phase from a fetched one will eventually debug an answer from last
 * week.
 */
function collectingSparql(
  progress: SyncProgress, refreshCache: boolean,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX), {
    categoryId: LANDMARK_CATEGORY_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

/**
 * Upsert a landmark as an experience + experience_location
 */
async function upsertLandmarkExperience(
  landmark: WikidataLandmark,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const imageUrl = landmark.imageUrl || null;

  const metadata = {
    wikidataQid: landmark.qid,
    // Every class the rule read, and whether an artwork class answered it, for
    // the check that asks what an admitted row is typed as. The run's own
    // notes, not fields (`SYNC_OWNED_METADATA_KEYS`).
    wikidataClasses: landmark.classes,
    wikidataArtwork: landmark.artwork,
    creators: landmark.creators,
    year: landmark.year,
    sitelinksCount: landmark.sitelinks,
    // Not `type` here: the column is the type, and storing it twice made every
    // run propose the same change twice — 124 of 1,685 public-art proposals on
    // the development catalogue carried both (#814). Migration 044 cleared the
    // key from the stored rows.
    wikipediaUrl: landmark.articleUrl || null,
    website: landmark.website || null,
    // `creator` is who made the sculpture; this is who photographed it. Two
    // different people, and only one of them has ever been named on the card.
    //
    // What this run fetched, or the row's own credit where the picture has not
    // changed. Resent rather than omitted, because the upsert replaces the whole
    // metadata object — a key left out is a key dropped. See `creditToWrite`.
    ...creditPatch(landmark.qid, imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    categoryId: LANDMARK_CATEGORY_ID,
    externalId: landmark.qid,
    name: landmark.label,
    nameLocal: { en: landmark.label },
    description: landmark.description,
    shortDescription: null,
    type: landmark.type,
    tags: ['outdoor', landmark.type],
    lon: landmark.lon,
    lat: landmark.lat,
    countryCodes: [],
    countryNames: landmark.countryLabel ? [landmark.countryLabel] : [],
    imageUrl,
    metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  let contents: ContentsByKind | undefined;
  if (!context.dryRun) {
    const written = await upsertSingleLocation(
      experienceId, landmark.qid, landmark.lon, landmark.lat, { syncLogId: context.syncLogId },
    );
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    // One point per landmark, so this reports a source that moved it — a withdrawal
    // and an arrival, since identity is the point together with the source's reference
    // (ADR-0022), and a coordinate rewritten more than ten metres away is a different
    // point (ADR-0027). Inside that the writer reads it as the same place and nothing
    // is reported at all.
    // Worth recording even where the object's own `lon`/`lat` diff says the same:
    // the row was replaced, and a reader's tick did not follow it.
    contents = { locations: written.delta };
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    contents,
  };
}

function disambiguateDuplicateNames(landmarks: WikidataLandmark[]): void {
  const nameCounts = new Map<string, number>();
  for (const lm of landmarks) {
    nameCounts.set(lm.label, (nameCounts.get(lm.label) || 0) + 1);
  }
  for (const lm of landmarks) {
    if ((nameCounts.get(lm.label) || 0) <= 1 || !lm.description) continue;
    // Extract a short location hint from the description (e.g., "in Berlin-Tiergarten").
    // Negated class avoids backtracking across stop chars.
    const match = lm.description.match(/\bin\s+([^,.\n]+)/i);
    if (match) lm.label = `${lm.label} (${match[1].trim()})`;
  }
}

/**
 * Collect, decide, and ask Commons about the pictures of what was admitted.
 *
 * The refusals come back as the run's `filtered`, which is what the
 * orchestrator marks on the rows (ADR-0024); what the category already admits
 * is read first, so the collection's stay line has something to hold.
 */
async function fetchLandmarkItems(
  progress: SyncProgress,
  refreshCache: boolean,
): Promise<FetchResult<WikidataLandmark>> {
  imageCredits = new Map();
  storedCredits = await readStoredCredits(LANDMARK_CATEGORY_ID);
  const admitted = await admittedExternalIds(LANDMARK_CATEGORY_ID);

  const { items, fetched, filtered } = await collectPublicArt({
    sparql: collectingSparql(progress, refreshCache),
    phase: (message) => { progress.statusMessage = message; },
    step: async () => {
      if (progress.cancel) throw new Error('Sync cancelled');
      await delay(SPARQL_DELAY_MS);
    },
  }, admitted);

  disambiguateDuplicateNames(items);

  // After the decision, so the credit pass asks about the rows that will exist
  // rather than every candidate the pool named. Its own patience: the
  // collection's is spent by the time this runs.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  imageCredits = await fetchCommonsCredits(items.map((l) => l.imageUrl), {
    userAgent: WIKIDATA_USER_AGENT,
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  return { items, fetchedCount: fetched, filtered };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — collects the public art the world knows from Wikidata
 */
export function syncLandmarks(
  triggeredBy: number | null,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<void> {
  return orchestrateSync<WikidataLandmark>({
    categoryId: LANDMARK_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // A fame line over a pool, so absence from a run says the row fell below
    // it or stopped passing the rule — nothing about whether it still stands.
    sourceCompleteness: 'ranked',
    // Every run recomputes the whole membership from the whole pool rather than
    // fetching a published list, so absence from the admitted set is this
    // category's own decision and belongs on the admission axis (ADR-0024).
    recomputesMembership: true,
    // Belonging is the badge: the world tier is what clears the fame line, and
    // every row this run admits carries is_iconic for that (ADR-0045 decision
    // 5) — written once admission is settled, not per landmark (#760).
    badgesAdmitted: true,
    // The one place the run's options reach the collection: the cache is a
    // property of *this* run rather than of the category.
    // Nothing appends to the orchestrator's error list any more: a collection
    // that fails throws, and fails the run.
    fetchItems: (progress) => fetchLandmarkItems(progress, options.refreshCache === true),
    processItem: upsertLandmarkExperience,
    getItemName: (lm) => lm.label,
    getItemId: (lm) => lm.qid,
  }, triggeredBy, options);
}

/**
 * Get current landmark sync status
 */
export function getLandmarkSyncStatus() {
  return getSyncStatus(LANDMARK_CATEGORY_ID);
}

/**
 * Cancel running landmark sync
 */
export function cancelLandmarkSync() {
  return cancelSync(LANDMARK_CATEGORY_ID);
}

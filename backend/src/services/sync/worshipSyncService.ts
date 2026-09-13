/**
 * Places of Worship Sync Service.
 *
 * The run around the collector. What a place of worship is, which classes count
 * and which of two doors admitted a row all live in `worship/` — one tested
 * module per rule, composed by `worship/pipeline.ts`. This file does what the
 * museum service does for its own kind: read what the last run left and what
 * the source row states, hand the proposal to the orchestrator, and write each
 * place as an experience with one point and its treasures as treasures.
 *
 * Two doors, one tier. A cathedral enters because the world knows the building,
 * or because it holds something the world knows — a relic, a tomb, an
 * altarpiece — and both lines are the source's own fame line (ADR-0045 decision
 * 5), which is why the run badges everything it admits and recomputes the whole
 * membership every pass.
 */

import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult, ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import type { SyncProgress, ContentsDelta } from './types.js';
import { withCache, type CacheDescriptor } from './wikidataCache.js';
import { admittedExternalIds } from './admission.js';
import { readSourceLine } from './sourceLine.js';
import { collectPlacesOfWorship, type CollectedPlaceOfWorship } from './worship/pipeline.js';
// The museum run's reader, taking the source as an argument since the day the
// floor was written: "where the catalogue offers each work" is the same
// question for any kind that hangs treasures off a venue, and asking it twice
// in two files is how the floor and the diff come to disagree.
import { readPreviousPlacements } from './museumSyncService.js';
import { upsertVenueTreasures } from './museum/treasureWriter.js';
import { measureWorksCoverage, worksCoverageSkipReason } from './museum/worksCoverage.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  waitMessage,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  type SparqlBinding,
} from './wikidataUtils.js';
import {
  fetchCommonsCredits,
  readStoredCredits,
  readStoredTreasureCredits,
  creditToWrite,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';
import { makeWikidataPictureRepair } from './wikidataPictureRepair.js';

const WORSHIP_SOURCE_ID = 4;

const LOG_PREFIX = '[Worship Sync]';

/**
 * The run's door to Wikidata, with the answers kept.
 *
 * The museum collector's shape (ADR-0030): one wait budget for the whole
 * collection, a cache keyed by the source and the question, and `refreshCache`
 * turning the cache off for one run — a cache nobody can bypass is a fork of
 * reality. A hit says so on screen, because an admin who cannot tell a cached
 * phase from a fetched one will eventually debug an answer from last week.
 *
 * This kind asks more distinct questions than either of the two before it: the
 * worship tree and the type trees, the pools of places and of works, the venue
 * statements, the details and the edges. All of it runs before the first place
 * is written, which is where a wait is invisible and an answer is worth keeping.
 */
function collectingSparql(
  progress: SyncProgress, refreshCache: boolean,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX), {
    sourceId: WORSHIP_SOURCE_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

// =============================================================================
// Fetch
// =============================================================================

/**
 * Credits for every photograph this run shows, keyed by image URL: the places'
 * and their treasures' alike, filled by one call in `fetchWorshipItems`.
 *
 * Both in one map deliberately — it is what stops a reliquary and the cathedral
 * holding it crediting the same file differently — which is why `processPlace`
 * hands this same map to `upsertVenueTreasures`.
 *
 * Module state for the reason the museum run keeps its credits that way: the
 * orchestrator hands `processItem` one place at a time, and asking Commons per
 * place would be one request each where a handful covers them all.
 */
let imageCredits = new Map<string, ImageCredit>();

/** What each place's row already says about who took its picture, by external id. */
let storedCredits = new Map<string, StoredCredit>();

/**
 * The same for what stands inside it, by the treasure's own id.
 *
 * Separate from the places' map and not merged into it: both are keyed by a
 * Wikidata QID, and a place and a treasure are different rows in different
 * tables that can hold different pictures.
 */
let storedTreasureCredits = new Map<string, StoredCredit>();

/**
 * Where this run places each treasure, by the treasure's id: the admitted
 * places holding it in the proposal. Built once in `fetchWorshipItems` and read
 * per place in `processPlace`, for the hold on a moved treasure's old link
 * (ADR-0044 decision 5): the place it moved to may be written after the one it
 * left, so the writer cannot learn from the table alone that a new place is
 * coming.
 */
let placedThisRun = new Map<string, Set<string>>();

/**
 * The treasures this run places at another admitted place and not at this one.
 * What the writer holds a visible link for while the new place is unread.
 */
function placedElsewhereFor(placeQid: string): string[] {
  const elsewhere: string[] = [];
  for (const [work, venues] of placedThisRun) {
    if (!venues.has(placeQid) && venues.size > 0) elsewhere.push(work);
  }
  return elsewhere;
}

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(externalId: string, imageUrl: string | null): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? imageCredits.get(imageUrl) : undefined,
    storedCredits.get(externalId),
    imageUrl,
  );
}

async function fetchWorshipItems(
  progress: SyncProgress,
  refreshCache: boolean,
): Promise<FetchResult<CollectedPlaceOfWorship>> {
  // The line first, because a run that cannot state its own fame line has no
  // business sending a query: it would admit a different catalogue than the
  // panel says it does (ADR-0052), and the collector needs the number for its
  // very first decision.
  const line = await readSourceLine(WORSHIP_SOURCE_ID);
  const previousPlacements = await readPreviousPlacements(WORSHIP_SOURCE_ID);
  imageCredits = new Map();
  storedCredits = await readStoredCredits(WORSHIP_SOURCE_ID);
  storedTreasureCredits = await readStoredTreasureCredits();
  // What the source holds as admitted before the run, so the stay line of the
  // hysteretic tier has something to hold (ADR-0023).
  const admitted = await admittedExternalIds(WORSHIP_SOURCE_ID);

  const { items, fetched, filtered } = await collectPlacesOfWorship({
    sparql: collectingSparql(progress, refreshCache),
    previousPlacements,
    admitted,
    line,
    onPhase: (message) => { progress.statusMessage = message; },
    checkCancel: () => {
      if (progress.cancel) throw new Error('Sync cancelled');
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // Whether the run saw enough of what the catalogue holds to be believed about
  // what left it (ADR-0044) — measured here, before a single place is written,
  // over the same placements the collector's diff was measured against, and
  // handed to the orchestrator: it decides the run's status and reaches every
  // place's writer through the run context, which is what keeps the order —
  // floor first, withdrawal second — out of this file's hands.
  const coverage = {
    stored: previousPlacements,
    admitted: items.map((p) => ({ qid: p.qid, works: p.artworks.map((a) => a.externalId) })),
  };
  placedThisRun = new Map();
  for (const venue of coverage.admitted) {
    for (const work of venue.works) {
      const venues = placedThisRun.get(work) ?? new Set<string>();
      venues.add(venue.qid);
      placedThisRun.set(work, venues);
    }
  }
  const measured = measureWorksCoverage(coverage);
  console.log(
    `${LOG_PREFIX} Treasure coverage: ${measured.seen} of ${measured.stored} treasures offered at `
    + `the ${measured.museums} admitted places placed again`,
  );
  const withdrawalSkippedReason = worksCoverageSkipReason(coverage, 'places');

  // Whose photographs these are. Asked after the collection rather than during
  // it: only the admitted places are worth crediting, which is a handful of
  // requests instead of one per candidate the pools ever named. The treasures
  // are asked about in the same breath, so that a reliquary and the cathedral
  // holding it cannot end up crediting the same file differently.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  imageCredits = await fetchCommonsCredits([
    ...items.map((p) => p.imageUrl),
    ...items.flatMap((p) => p.artworks.map((a) => a.imageUrl)),
  ], {
    userAgent: WIKIDATA_USER_AGENT,
    // Its own patience: the collection's is spent by the time this runs.
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  return { items, fetchedCount: fetched, filtered, withdrawalSkippedReason };
}

// =============================================================================
// Write
// =============================================================================

/**
 * Write one place of worship: the experience, its point, and what it holds.
 *
 * The type is a word a reader filters the kind by — cathedral, mosque, temple —
 * and it is the column, so the tag beside `worship` is the same word rather than
 * a second copy of it in metadata (#814). Which of the two doors admitted the
 * row is not stored at all: it is the run's own bookkeeping, and `admitted_for`
 * already says whether a treasure opened one.
 */
async function processPlace(
  place: CollectedPlaceOfWorship,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const metadata = {
    wikidataQid: place.qid,
    // Every class the rule read, and how famous the building is: the run's own
    // notes about its pass, so they go past the gate and past a claim and no
    // card is ever raised about them (`SYNC_OWNED_METADATA_KEYS`, #571).
    wikidataClasses: place.classes,
    sitelinksCount: place.sitelinks,
    artworkCount: place.artworks.length,
    totalArtworkSitelinks: place.artworks.reduce((sum, a) => sum + a.sitelinksCount, 0),
    website: place.website,
    wikipediaUrl: place.articleUrl || null,
    // The picture comes from Commons and was taken by somebody, usually under a
    // licence that asks for them to be named. What goes here is what this run
    // fetched, or the row's own credit where the picture has not changed —
    // never the one from a different photograph. See `creditToWrite`.
    ...creditPatch(place.qid, place.imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId: WORSHIP_SOURCE_ID,
    externalId: place.qid,
    name: place.label,
    nameLocal: { en: place.label },
    description: place.description,
    shortDescription: null,
    type: place.type,
    tags: place.type ? ['worship', place.type] : ['worship'],
    lon: place.lon,
    lat: place.lat,
    countryCodes: [],
    countryNames: place.countryLabel ? [place.countryLabel] : [],
    imageUrl: place.imageUrl,
    metadata,
    // The reason this membership exists, nameable: the most famous treasure the
    // place holds, where a treasure is what admitted it. A place through door
    // one is admitted for its own fame and names nothing.
    admittedFor: place.admittedFor ?? null,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // Undefined on a preview, which writes no point and so has none to report — as
  // against an empty delta, which says the question was asked (ADR-0026).
  let locations: ContentsDelta | undefined;
  let treasures: ContentsDelta | undefined;

  if (!context.dryRun) {
    // The must-see flag is not written here. Both doors are the world tier, so
    // the flag is a property of belonging to this kind rather than a field the
    // source proposes — and it is written where belonging is settled, after the
    // run's restore step (`markIconic`, admission.ts), so a cancelled run never
    // badges a row it did not re-admit (#760).
    const written = await upsertSingleLocation(
      experienceId, place.qid, place.lon, place.lat, { syncLogId: context.syncLogId },
    );
    // Registered here rather than returned: `upsertVenueTreasures` runs after
    // this and can throw, and a returned field would be lost with it while the
    // point had already moved on disk.
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    locations = written.delta;

    // The floor's verdict goes with the run's id: the writer marks a link only
    // where the collector, up in `fetchWorshipItems`, saw enough of the
    // treasures to vouch for what left.
    treasures = await upsertVenueTreasures(
      experienceId,
      place.artworks,
      { fetched: imageCredits, stored: storedTreasureCredits },
      {
        syncLogId: context.syncLogId,
        withdrawalSkippedReason: context.withdrawalSkippedReason,
        sourceId: WORSHIP_SOURCE_ID,
      },
      placedElsewhereFor(place.qid),
    );
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    // Both kinds a place holds, from the two writers that touched them. The
    // recorder drops whichever did nothing, so a cathedral that only gained a
    // relic carries no points key at all.
    contents: { locations, treasures },
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — collects the places of worship the world knows, and the
 * ones the world knows for what they hold.
 */
export function syncPlacesOfWorship(
  triggeredBy: number | null,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedPlaceOfWorship>({
    sourceId: WORSHIP_SOURCE_ID,
    logPrefix: LOG_PREFIX,
    // A fame line over two pools, so absence from a run says a row fell below
    // it or stopped passing the rule — nothing about whether the building
    // still stands.
    sourceCompleteness: 'ranked',
    // It does, however, say the place is not one of ours: every run recomputes
    // the whole membership from the whole pool rather than fetching a published
    // list, so absence from the admitted set is this source's own decision and
    // belongs on the admission axis (ADR-0024).
    recomputesMembership: true,
    // And belonging is the badge: a place enters on its own fame or on a
    // treasure's, and both lines are the world tier (ADR-0045 decision 5) —
    // written once admission is settled, not per place (#760).
    badgesAdmitted: true,
    // The one place the run's options reach the collection: the cache is a
    // property of *this* run rather than of the source.
    fetchItems: (progress) => fetchWorshipItems(progress, options.refreshCache === true),
    processItem: processPlace,
    getItemName: (p) => p.label,
    getItemId: (p) => p.qid,
  }, triggeredBy, options);
}

/**
 * Get current places-of-worship sync status
 */
export function getWorshipSyncStatus() {
  return getSyncStatus(WORSHIP_SOURCE_ID);
}

/**
 * Cancel running places-of-worship sync
 */
export function cancelWorshipSync() {
  return cancelSync(WORSHIP_SOURCE_ID);
}

/**
 * This source's instance of the Wikidata picture repair
 * (`wikidataPictureRepair.ts`): the same mechanism as a run reaching for a
 * picture, started by hand from the admin panel against rows already stored
 * rather than during a sync pass.
 */
export const fixWorshipImages = makeWikidataPictureRepair(WORSHIP_SOURCE_ID, LOG_PREFIX, {
  singular: 'place',
  plural: 'places',
});

/**
 * Landmark Sync Service — the Public art and the Monuments & memorials sources.
 *
 * Collects the outdoor art and monuments the world knows, in stages
 * (`publicArt/pipeline.ts`), admits what each kind's rule admits and refuses
 * what it refuses with the reason on the row (ADR-0024), keeps Wikidata's
 * answers between runs (ADR-0030), and writes each landmark as one experience
 * with one point. No grouping, no treasures — simpler than museums, and since
 * #754 the same shape.
 *
 * Each source is a member of the place pass (ADR-0132, `places/placePass.ts`):
 * the places are gathered once for every source of `PLACE_PASS`, and each of
 * these two decides from its kind's share by its kind's rule
 * (`publicArt/kindRules.ts`) and writes its own kind.
 */

import { readsSubset } from './subset/reader.js';
import { unreadOnSubset } from './subset/runDoor.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import type { SyncProgress, WikidataLandmark, ContentsByKind } from './types.js';
import { getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult, FilteredEntity, ProcessItemResult, SyncRunContext, SyncServiceConfig } from './syncContract.js';
import { admittedExternalIds } from './admission.js';
import { placesOtherSourcesOffer } from './shownElsewhere.js';
import { classifyPublicArt, PUBLIC_ART_KIND } from './publicArt/pipeline.js';
import { shareOf, type GatheredPlaces, type PlaceGather } from './places/gather.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE, type KindRule } from './publicArt/kindRules.js';
import { PUBLIC_ART_SOURCES } from './passes.js';
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

const LANDMARK_SOURCE_ID = 3;
const LOG_PREFIX = '[Landmark Sync]';

/**
 * What a source of the place pass decides by: its classifier over the gather,
 * the type vocabulary it files places under, and the tag its places carry
 * beside their type. A place with one point, written the same way whatever
 * its kind: Public art's and Monuments & memorials' here, every other place
 * kind's in its own `kind.ts`.
 */
export interface PlaceClassifier {
  /** Decide from the gather; `admitted` is what the source holds as admitted before the run. */
  classify(gathered: GatheredPlaces, admitted: ReadonlySet<string>): Promise<{
    items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[];
  }>;
  types: readonly string[];
  tag: string;
}

/** Public art's and Monuments & memorials' classifier: their kind's rule over the public-art share. */
function publicArtClassifier(rule: KindRule): PlaceClassifier {
  return {
    // The places a kind outside these two offers a reader, so a work outdoors
    // on a venue no such kind offers stays public art rather than being
    // refused onto no card (#1444).
    classify: async (gathered, admitted) => classifyPublicArt(
      shareOf(gathered, PUBLIC_ART_KIND), rule, admitted, await placesOtherSourcesOffer(PUBLIC_ART_SOURCES),
    ),
    types: rule.types,
    tag: 'outdoor',
  };
}

/** The classifier each public-art source decides by. */
const PUBLIC_ART_CLASSIFIERS: Readonly<Record<number, PlaceClassifier>> = {
  [LANDMARK_SOURCE_ID]: publicArtClassifier(PUBLIC_ART_RULE),
  6: publicArtClassifier(MONUMENTS_RULE),
};

/**
 * A source's credits for its run's photographs, keyed by image URL, and what
 * each of its landmarks' rows already says, so a failed credit pass erases
 * nothing.
 *
 * Held for the run, like the UNESCO run's Wikipedia links: the orchestrator
 * hands `processItem` one landmark at a time, and asking Commons per landmark
 * would be 200 requests where four will do.
 */
interface RunCredits {
  fetched: Map<string, ImageCredit>;
  stored: Map<string, StoredCredit>;
}

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(
  credits: RunCredits, externalId: string, imageUrl: string | null,
): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? credits.fetched.get(imageUrl) : undefined,
    credits.stored.get(externalId),
    imageUrl,
  );
}

/**
 * The live service with nothing kept: what a run on the subset asks about
 * what the subset in place does not hold (`publicArt/subjects.ts`). An
 * answer kept here would be read back into a later run on the subset, which
 * no run may mix in (ADR-0119).
 */
export function liveSparql(progress: SyncProgress): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  const door = wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX);
  // The descriptor names a cache entry, and there is none to name.
  return (query) => door(query);
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
 *
 * The pass's gather asks it and keeps its answers under its first source
 * (ADR-0132 decision 5).
 */
export function collectingSparql(
  sourceId: number, progress: SyncProgress, refreshCache: boolean,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX), {
    sourceId,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

/**
 * Upsert a landmark as an experience + experience_location, in the kind
 * `sourceId` fills.
 */
async function upsertLandmarkExperience(
  sourceId: number,
  classifier: PlaceClassifier,
  credits: RunCredits,
  landmark: WikidataLandmark,
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
    ...creditPatch(credits, landmark.qid, imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId,
    externalId: landmark.qid,
    name: landmark.label,
    nameLocal: { en: landmark.label },
    subtitle: landmark.description,
    description: null,
    type: landmark.type,
    // The kind's own words, so a type the split left outside them is rewritten
    // past the gate rather than asked about (#1807).
    typeVocabulary: classifier.types,
    tags: [classifier.tag, landmark.type],
    lon: landmark.lon,
    lat: landmark.lat,
    countryCodes: [],
    countryNames: landmark.countryLabel ? [landmark.countryLabel] : [],
    imageUrl,
    itemPictures: landmark.itemPictures,
    metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  let contents: ContentsByKind | undefined;
  if (!context.dryRun) {
    const written = await upsertSingleLocation(
      experienceId, landmark.qid, landmark.lon, landmark.lat, { syncLogId: context.syncLogId, sourceId },
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
 * Decide from the gather, and ask Commons about the pictures of what was
 * admitted.
 *
 * The refusals come back as the run's `filtered`, which is what the
 * orchestrator marks on the rows (ADR-0024); what the source already admits
 * is read first, so the collection's stay line has something to hold.
 */
async function fetchLandmarkItems(
  sourceId: number,
  classifier: PlaceClassifier,
  credits: RunCredits,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
  progress: SyncProgress,
): Promise<FetchResult<WikidataLandmark>> {
  credits.fetched = new Map();
  credits.stored = await readStoredCredits(sourceId);
  const admitted = await admittedExternalIds(sourceId);

  const { gathered, sparql } = await gather(progress);
  const { items, fetched, filtered } = await classifier.classify(gathered, admitted);

  disambiguateDuplicateNames(items);

  // After the decision, so the credit pass asks about the rows that will exist
  // rather than every candidate the pool named. Its own patience: the
  // collection's is spent by the time this runs.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  credits.fetched = await fetchCommonsCredits(items.map((l) => l.imageUrl), {
    userAgent: WIKIDATA_USER_AGENT,
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // What the subset cannot read is left as it is, not read as gone.
  const unread = readsSubset(sparql) ? await unreadOnSubset(sourceId) : undefined;
  return { items, fetchedCount: fetched, filtered, unread, typeVocabulary: classifier.types };
}

/** One public-art source of the pass: its kind's rule, writing the kind `sourceId` fills. */
export function publicArtSource(
  sourceId: number,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
): SyncServiceConfig<WikidataLandmark> {
  return placeSource(sourceId, gather, PUBLIC_ART_CLASSIFIERS[sourceId]);
}

/** One source of the pass whose places have one point: its classifier, writing the kind `sourceId` fills. */
export function placeSource(
  sourceId: number,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
  classifier: PlaceClassifier,
): SyncServiceConfig<WikidataLandmark> {
  const credits: RunCredits = { fetched: new Map(), stored: new Map() };
  return {
    sourceId,
    logPrefix: LOG_PREFIX,
    // A fame line over a pool, so absence from a run says the row fell below
    // it or stopped passing the rule — nothing about whether it still stands.
    sourceCompleteness: 'ranked',
    // Every run recomputes the whole membership from the whole pool rather than
    // fetching a published list, so absence from the admitted set is this
    // source's own decision and belongs on the admission axis (ADR-0024).
    recomputesMembership: true,
    // Belonging is the badge: the world tier is what clears the fame line, and
    // every row this run admits carries is_iconic for that (ADR-0045 decision
    // 5) — written once admission is settled, not per landmark (#760).
    badgesAdmitted: true,
    // Nothing appends to the orchestrator's error list any more: a collection
    // that fails throws, and fails the run.
    fetchItems: (progress) => fetchLandmarkItems(sourceId, classifier, credits, gather, progress),
    processItem: (landmark, _progress, context) => upsertLandmarkExperience(sourceId, classifier, credits, landmark, context),
    getItemName: (lm) => lm.label,
    getItemId: (lm) => lm.qid,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get current landmark sync status
 */
export function getLandmarkSyncStatus() {
  return getSyncStatus(LANDMARK_SOURCE_ID);
}

/**
 * Cancel running landmark sync
 */
export function cancelLandmarkSync() {
  return cancelSync(LANDMARK_SOURCE_ID);
}

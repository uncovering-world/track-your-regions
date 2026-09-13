/**
 * Archaeology Sync Service.
 *
 * The run around the collector. What an archaeology museum is, what a find is,
 * which classes and which Wikipedia categories count, and whether a museum
 * arrives admitted or held all live in `archaeology/` — one tested module per
 * rule, composed by `archaeology/pipeline.ts`. This file does what the museum
 * and worship services do for their own kinds: read what the last run left and
 * what the source row states, hand the proposal to the orchestrator, and write
 * each museum as an experience with one point and its finds as treasures.
 *
 * One door, two lines. A museum is here for what it is — Wikidata's class or
 * English Wikipedia's category — and never for a find it holds (ADR-0058
 * decision 2), but a find above the finds' own line carries a museum that
 * already passed that door and stands below the museums' line, which is how the
 * Archaeological Museum of Delphi enters at 15 sitelinks for the Charioteer.
 * Both lines are the source's own fame line (ADR-0045 decision 5), which is why
 * the run badges everything it admits and recomputes the whole membership every
 * pass.
 *
 * The kind's other half is the site a traveller stands on (ADR-0058 decision
 * 1). It is another door and another run; nothing here knows about it.
 */

import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult, ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import type { SyncProgress, ContentsDelta } from './types.js';
import { withCache, type CacheDescriptor } from './wikidataCache.js';
import { admittedExternalIds } from './admission.js';
import { readSourceLine } from './sourceLine.js';
import {
  collectArchaeologyMuseums, type CollectedArchaeologyMuseum,
} from './archaeology/pipeline.js';
import { fetchWikipediaCategories } from './wikipediaCategories.js';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';
import { NATURE_CATEGORY, NATURE_CATEGORY_ROOT } from './archaeology/classes.js';
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

const ARCHAEOLOGY_SOURCE_ID = 5;

const LOG_PREFIX = '[Archaeology Sync]';

/**
 * The run's door to Wikidata, with the answers kept.
 *
 * The museum collector's shape (ADR-0030): one wait budget for the whole
 * collection, a cache keyed by the source and the question, and `refreshCache`
 * turning the cache off for one run — a cache nobody can bypass is a fork of
 * reality. A hit says so on screen, because an admin who cannot tell a cached
 * phase from a fetched one will eventually debug an answer from last week.
 *
 * The budget is handed in rather than minted here, because this run waits on two
 * wikis and the patience is the *run's* (#886): a budget per door would let a
 * run spend `SPARQL_WAIT_BUDGET_MS` on Wikidata and as much again on Wikipedia.
 *
 * This kind asks the museum import's whole set: the archaeology class trees,
 * the pool of museums and the pool of finds, the venue statements, the details
 * and the edges. All of it runs before the first museum is written, which is
 * where a wait is invisible and an answer is worth keeping.
 */
function collectingSparql(
  progress: SyncProgress, refreshCache: boolean, budget: WaitBudget,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(wikidataDoor(progress, budget, LOG_PREFIX), {
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

/**
 * What English Wikipedia files each museum's article under, asked through the
 * one door (`wikipediaCategories.ts`).
 *
 * **A batch that cannot be read ends the run.** Nothing is caught here: the
 * error travels out of the collection, the orchestrator marks the run failed
 * and not a row is written. Swallowed, it would be up to fifty museums read as
 * category-less — which for half the canon is fifty museums this kind refuses,
 * the British Museum among them — on a run whose log said success.
 *
 * **A wait says so, on the run's own patience** (#886). The waits go through
 * `waitMessage` like Wikidata's, so the panel reads "Waiting on Wikipedia…"
 * rather than the last phase line for as long as a 429's `Retry-After` lasts,
 * and they are drawn from the budget this run shares with its Wikidata door — a
 * budget per wiki would let one run wait twice the number either was held to.
 */
function categoriesDoor(
  progress: SyncProgress, budget: WaitBudget,
): (titles: string[]) => Promise<Map<string, string[]>> {
  return (titles) => fetchWikipediaCategories(titles, {
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    budget,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikipedia', wait, budget); },
  });
}

/**
 * The same categories entered rather than tested: the walk down
 * `Archaeological museums by country`, which names the museums no class does
 * (ADR-0058 decision 2, `archaeology/classes.ts`).
 *
 * **A category that cannot be read ends the run**, exactly as a batch of titles
 * does and for a stronger reason: a lost category is every museum of a country
 * missing from the candidate set — the Bardo, the Museo del Oro and the
 * National Museum of Iraq are in the catalogue by this walk alone — on a run
 * whose log said success.
 */
function categoryMembersDoor(
  progress: SyncProgress, budget: WaitBudget,
): () => Promise<Map<string, string>> {
  return () => fetchCategoryMembers(NATURE_CATEGORY_ROOT, {
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    recurseInto: NATURE_CATEGORY,
    budget,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikipedia', wait, budget); },
  });
}

// =============================================================================
// Fetch
// =============================================================================

/**
 * Credits for every photograph this run shows, keyed by image URL: the museums'
 * and their finds' alike, filled by one call in `fetchArchaeologyItems`.
 *
 * Both in one map deliberately — it is what stops the Rosetta Stone and the
 * British Museum crediting the same file differently — which is why
 * `processMuseum` hands this same map to `upsertVenueTreasures`.
 *
 * Module state for the reason the museum run keeps its credits that way: the
 * orchestrator hands `processItem` one museum at a time, and asking Commons per
 * museum would be one request each where a handful covers them all.
 */
let imageCredits = new Map<string, ImageCredit>();

/** What each museum's row already says about who took its picture, by external id. */
let storedCredits = new Map<string, StoredCredit>();

/**
 * The same for what stands inside it, by the find's own id.
 *
 * Separate from the museums' map and not merged into it: both are keyed by a
 * Wikidata QID, and a museum and a find are different rows in different tables
 * that can hold different pictures.
 */
let storedTreasureCredits = new Map<string, StoredCredit>();

/**
 * Where this run places each find, by the find's id: the admitted museums
 * holding it in the proposal. Built once in `fetchArchaeologyItems` and read
 * per museum in `processMuseum`, for the hold on a moved find's old link
 * (ADR-0044 decision 5): the museum it moved to may be written after the one it
 * left, so the writer cannot learn from the table alone that a new museum is
 * coming.
 */
let placedThisRun = new Map<string, Set<string>>();

/**
 * The finds this run places at another admitted museum and not at this one.
 * What the writer holds a visible link for while the new museum is unread.
 */
function placedElsewhereFor(museumQid: string): string[] {
  const elsewhere: string[] = [];
  for (const [find, venues] of placedThisRun) {
    if (!venues.has(museumQid) && venues.size > 0) elsewhere.push(find);
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

async function fetchArchaeologyItems(
  progress: SyncProgress,
  refreshCache: boolean,
): Promise<FetchResult<CollectedArchaeologyMuseum>> {
  // The lines first, because a run that cannot state its own fame lines has no
  // business sending a query: it would admit a different catalogue than the
  // panel says it does (ADR-0052), and the collector needs the numbers for its
  // very first decision. Two pairs here — the museums' and the finds' — because
  // a find carries fewer articles than the museum showing it (ADR-0058
  // decision 5); the collector falls back to the one line for a source that
  // states no second pair.
  const line = await readSourceLine(ARCHAEOLOGY_SOURCE_ID);
  const previousPlacements = await readPreviousPlacements(ARCHAEOLOGY_SOURCE_ID);
  imageCredits = new Map();
  storedCredits = await readStoredCredits(ARCHAEOLOGY_SOURCE_ID);
  storedTreasureCredits = await readStoredTreasureCredits();
  // What the source holds as admitted before the run, so the stay line of the
  // hysteretic tier has something to hold (ADR-0023).
  const admitted = await admittedExternalIds(ARCHAEOLOGY_SOURCE_ID);

  // One patience for the whole run, spent on whichever wiki asks for it: this
  // kind reads Wikidata and English Wikipedia in the same collection, and a
  // budget per door is a run that can wait twice as long as either number says
  // (#886).
  const waiting = new WaitBudget(SPARQL_WAIT_BUDGET_MS);

  const { items, fetched, filtered } = await collectArchaeologyMuseums({
    sparql: collectingSparql(progress, refreshCache, waiting),
    previousPlacements,
    admitted,
    line,
    categories: categoriesDoor(progress, waiting),
    categoryMembers: categoryMembersDoor(progress, waiting),
    onPhase: (message) => { progress.statusMessage = message; },
    checkCancel: () => {
      if (progress.cancel) throw new Error('Sync cancelled');
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // Whether the run saw enough of what the catalogue holds to be believed about
  // what left it (ADR-0044) — measured here, before a single museum is written,
  // over the same placements the collector's diff was measured against, and
  // handed to the orchestrator: it decides the run's status and reaches every
  // museum's writer through the run context, which is what keeps the order —
  // floor first, withdrawal second — out of this file's hands.
  const coverage = {
    stored: previousPlacements,
    admitted: items.map((m) => ({ qid: m.qid, works: m.treasures.map((t) => t.externalId) })),
  };
  placedThisRun = new Map();
  for (const venue of coverage.admitted) {
    for (const find of venue.works) {
      const venues = placedThisRun.get(find) ?? new Set<string>();
      venues.add(venue.qid);
      placedThisRun.set(find, venues);
    }
  }
  const measured = measureWorksCoverage(coverage);
  console.log(
    `${LOG_PREFIX} Find coverage: ${measured.seen} of ${measured.stored} finds offered at `
    + `the ${measured.museums} admitted museums placed again`,
  );
  const withdrawalSkippedReason = worksCoverageSkipReason(coverage, 'museums');

  // Whose photographs these are. Asked after the collection rather than during
  // it: only the admitted museums are worth crediting, which is a handful of
  // requests instead of one per candidate the pools ever named. The finds are
  // asked about in the same breath, so that the Rosetta Stone and the British
  // Museum cannot end up crediting the same file differently.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  imageCredits = await fetchCommonsCredits([
    ...items.map((m) => m.imageUrl),
    ...items.flatMap((m) => m.treasures.map((t) => t.imageUrl)),
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
 * Write one archaeology museum: the experience, its point, and what it holds.
 *
 * The type is a word a reader filters the kind by, and for this door it is
 * always `museum` — the kind's other type is the site (ADR-0058 decision 1),
 * which arrives through another door. The tag beside `archaeology` is the same
 * word rather than a second copy of it in metadata (#814).
 *
 * The signal the nature was read off (`natureWhy`) is not stored: on a held row
 * the sentence a curator reads carries it already (`admissionNote`), and on an
 * admitted one it is the run's own bookkeeping, re-derived every pass.
 */
async function processMuseum(
  item: CollectedArchaeologyMuseum,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const metadata = {
    wikidataQid: item.qid,
    // Every class the rule read, what English Wikipedia files the article
    // under, the nature those two answered with, and the question a held row
    // asks: the run's own notes about its pass, so they go past the gate and
    // past a claim and no card is ever raised about them
    // (`SYNC_OWNED_METADATA_KEYS`, #571). Wikipedia's editors re-file articles
    // constantly, and a curator asked to approve each re-filing would be
    // answering for the rule rather than about the museum.
    wikidataClasses: item.classes,
    wikipediaCategories: item.categories,
    archaeologyNature: item.nature,
    admissionNote: item.admissionNote,
    sitelinksCount: item.sitelinks,
    artworkCount: item.treasures.length,
    totalArtworkSitelinks: item.treasures.reduce((sum, t) => sum + t.sitelinksCount, 0),
    website: item.website,
    wikipediaUrl: item.articleUrl || null,
    // The picture comes from Commons and was taken by somebody, usually under a
    // licence that asks for them to be named. What goes here is what this run
    // fetched, or the row's own credit where the picture has not changed —
    // never the one from a different photograph. See `creditToWrite`.
    ...creditPatch(item.qid, item.imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    externalId: item.qid,
    name: item.label,
    nameLocal: { en: item.label },
    description: item.description,
    shortDescription: null,
    type: item.type,
    tags: ['archaeology', item.type],
    lon: item.lon,
    lat: item.lat,
    countryCodes: [],
    countryNames: item.countryLabel ? [item.countryLabel] : [],
    imageUrl: item.imageUrl,
    metadata,
    // The reason this membership exists, nameable: the most famous find the
    // museum holds, where a find is what carried it over the line. A museum
    // known in its own right is admitted for its own fame and names nothing.
    admittedFor: item.admittedFor ?? null,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // Undefined on a preview, which writes no point and so has none to report — as
  // against an empty delta, which says the question was asked (ADR-0026).
  let locations: ContentsDelta | undefined;
  let treasures: ContentsDelta | undefined;

  if (!context.dryRun) {
    // The must-see flag is not written here. The door is the world tier, so the
    // flag is a property of belonging to this kind rather than a field the
    // source proposes — and it is written where belonging is settled, after the
    // run's restore step (`markIconic`, admission.ts), so a cancelled run never
    // badges a row it did not re-admit (#760).
    const written = await upsertSingleLocation(
      experienceId, item.qid, item.lon, item.lat, { syncLogId: context.syncLogId },
    );
    // Registered here rather than returned: `upsertVenueTreasures` runs after
    // this and can throw, and a returned field would be lost with it while the
    // point had already moved on disk.
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    locations = written.delta;

    // The floor's verdict goes with the run's id: the writer marks a link only
    // where the collector, up in `fetchArchaeologyItems`, saw enough of the
    // finds to vouch for what left. Each find carries where it was dug up, and
    // the writer stores that beside its picture credit (ADR-0058 decision 3).
    treasures = await upsertVenueTreasures(
      experienceId,
      item.treasures,
      { fetched: imageCredits, stored: storedTreasureCredits },
      {
        syncLogId: context.syncLogId,
        withdrawalSkippedReason: context.withdrawalSkippedReason,
        sourceId: ARCHAEOLOGY_SOURCE_ID,
      },
      placedElsewhereFor(item.qid),
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
    // Both kinds a museum holds, from the two writers that touched them. The
    // recorder drops whichever did nothing, so a museum that only gained a find
    // carries no points key at all.
    contents: { locations, treasures },
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — collects the museums the world knows for their
 * archaeology, and the finds they hold.
 */
export function syncArchaeology(
  triggeredBy: number | null,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedArchaeologyMuseum>({
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    logPrefix: LOG_PREFIX,
    // A fame line over two pools, so absence from a run says a row fell below
    // it or stopped passing the rule — nothing about whether the museum still
    // opens its doors.
    sourceCompleteness: 'ranked',
    // It does, however, say the museum is not one of ours: every run recomputes
    // the whole membership from the whole pool rather than fetching a published
    // list, so absence from the admitted set is this source's own decision and
    // belongs on the admission axis (ADR-0024).
    recomputesMembership: true,
    // And belonging is the badge: a museum enters on its own fame or carries a
    // find that entered on its, and both lines are the world tier (ADR-0045
    // decision 5) — written once admission is settled, not per museum (#760).
    badgesAdmitted: true,
    // The one place the run's options reach the collection: the cache is a
    // property of *this* run rather than of the source.
    fetchItems: (progress) => fetchArchaeologyItems(progress, options.refreshCache === true),
    processItem: processMuseum,
    getItemName: (m) => m.label,
    getItemId: (m) => m.qid,
  }, triggeredBy, options);
}

/**
 * Get current archaeology sync status
 */
export function getArchaeologySyncStatus() {
  return getSyncStatus(ARCHAEOLOGY_SOURCE_ID);
}

/**
 * Cancel running archaeology sync
 */
export function cancelArchaeologySync() {
  return cancelSync(ARCHAEOLOGY_SOURCE_ID);
}

/**
 * This source's instance of the Wikidata picture repair
 * (`wikidataPictureRepair.ts`): the same mechanism as a run reaching for a
 * picture, started by hand from the admin panel against rows already stored
 * rather than during a sync pass.
 */
export const fixArchaeologyImages = makeWikidataPictureRepair(ARCHAEOLOGY_SOURCE_ID, LOG_PREFIX, {
  singular: 'museum',
  plural: 'museums',
});

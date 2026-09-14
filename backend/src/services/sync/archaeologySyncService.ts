/**
 * Archaeology Sync Service.
 *
 * The run around the collector. What an archaeology museum is, what a find is,
 * which classes and which Wikipedia categories count, and whether a museum
 * arrives admitted or held all live in `archaeology/` — one tested module per
 * rule, composed by `archaeology/pipeline.ts`. This file does what the museum
 * and worship services do for their own kinds: read what the last run left and
 * what the source row states, open the doors this run asks its questions
 * through, and hand the proposal to the orchestrator. **Writing a row is
 * `archaeology/writer.ts`** — one item at a time, once all of the above has
 * been decided — and what this file learned about the pass reaches it once,
 * before the first write (`rememberRun`).
 *
 * One door, two lines. A museum is here for what it is — Wikidata's class or
 * English Wikipedia's category — and never for a find it holds (ADR-0058
 * decision 2), but a find above the finds' own line carries a museum that
 * already passed that door and stands below the museums' line, which is how the
 * Archaeological Museum of Delphi enters at 15 sitelinks for the Charioteer.
 * Both lines are the source's own fame line (ADR-0045 decision 5), which is why
 * the run recomputes the whole membership every pass — but only one of them is
 * the must-see badge. A museum is badged for holding a find above the finds'
 * line, whichever line let it in: the British Museum enters on its own 109
 * articles and is badged for the Rosetta Stone, while the Bardo, whose whole
 * claim is what it is, stands in the kind without a badge.
 *
 * **The kind's other half is the site a traveller stands on** (ADR-0058
 * decision 1), and it is another door in the same run: `archaeology/sites.ts`
 * collects it, OpenStreetMap judges it where Wikidata's classes cannot
 * (ADR-0059), and the writer stores it with the outline OSM drew. One run,
 * because the orchestrator reads absence from a run's items as a withdrawal.
 *
 * The badge differs by door and says so: a site is badged for belonging — it is
 * one of the world's archaeological sites, which is the whole claim — and a
 * museum only for holding a find the world knows.
 */

import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult } from './syncOrchestrator.js';
import type { SyncProgress } from './types.js';
import { clearCache, withCache, type CacheDescriptor } from './wikidataCache.js';
import { admittedExternalIds } from './admission.js';
import { contentsLine, readSourceLine } from './sourceLine.js';
import {
  collectArchaeology,
  type CollectedArchaeologyItem,
  type CollectedArchaeologyMuseum,
} from './archaeology/pipeline.js';
import { qleverOsmDoor } from './osm/qleverOsm.js';
import { readOsmObjects } from './osm/readOsmObjects.js';
import { OsmAnswerFloorError, type OsmReader } from './archaeology/sites.js';
// One item at a time, once the run has decided: the writers and what they were
// told about this pass (`archaeology/writer.ts`).
import { processItem, rememberRun } from './archaeology/writer.js';
import { fetchWikipediaCategories } from './wikipediaCategories.js';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';
import { NATURE_CATEGORY, NATURE_CATEGORY_ROOT } from './archaeology/classes.js';
// The museum run's reader, taking the source as an argument since the day the
// floor was written: "where the catalogue offers each work" is the same
// question for any kind that hangs treasures off a venue, and asking it twice
// in two files is how the floor and the diff come to disagree.
import { readPreviousPlacements } from './museumSyncService.js';
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

/**
 * What OpenStreetMap maps at each site candidate, asked through the QLever
 * mirror and kept like every other answer this run pays for.
 *
 * **A batch that cannot be read ends the run**, for the reason the Wikipedia
 * readers end it: read as silence, a lost answer says "no OSM object carries
 * this item" for every site in it, which refuses precisely the sites the rule
 * exists to admit. The error travels out of the collection, the orchestrator
 * marks the run failed, and not a row is written.
 *
 * The wait budget is the run's, shared with Wikidata and Wikipedia (#886): this
 * run now waits on three services, and a budget per door is a run that waits
 * three times the number any one of them was held to.
 *
 * Which geometries are worth the wire is not decided here. `collectSitesByFame`
 * hands the keep rule in (`OSM_KEEP_WKT`), because it is the kind's line
 * through OSM's keys rather than a property of how the mirror is asked.
 */
function osmDoor(
  progress: SyncProgress, refreshCache: boolean, budget: WaitBudget,
): OsmReader {
  const door = qleverOsmDoor(progress, budget, LOG_PREFIX);
  const send = withCache(door.send, {
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
  return (qids, keep, run) => readOsmObjects({ ...door, send }, qids, keep, run);
}

// =============================================================================
// Fetch
// =============================================================================

/**
 * The collection, with one thing done on the way out: **a mirror that answered
 * about almost nothing has its answers dropped**.
 *
 * `collectSitesByFame` fails the run when too few of the candidates it asked
 * about came back with an OSM object at all, because an empty answer read as a
 * fact refuses the sites the rule exists to admit. The answers are cached for a
 * day (ADR-0030), so without this the next run — and every run until tomorrow —
 * would read the same emptiness out of our own table and fail for a reason that
 * has nothing to do with the mirror any more. Clearing is this file's to do
 * because the cache is this run's (`ARCHAEOLOGY_SOURCE_ID`), and only the `osm`
 * kind is dropped: what Wikidata answered is still true.
 *
 * Nothing else is caught. A transport failure has already thrown without
 * writing a cache row, and the orchestrator marks the run failed either way.
 */
async function collectWithTheMirrorHeldToAccount(
  deps: Parameters<typeof collectArchaeology>[0],
): ReturnType<typeof collectArchaeology> {
  try {
    return await collectArchaeology(deps);
  } catch (error) {
    if (error instanceof OsmAnswerFloorError) {
      const dropped = await clearCache(ARCHAEOLOGY_SOURCE_ID, 'osm');
      console.warn(
        `${LOG_PREFIX} ${error.message}; dropped ${dropped} cached OSM answer`
        + `${dropped === 1 ? '' : 's'} so the next run asks again`,
      );
    }
    throw error;
  }
}

async function fetchArchaeologyItems(
  progress: SyncProgress,
  refreshCache: boolean,
): Promise<FetchResult<CollectedArchaeologyItem>> {
  // The lines first, because a run that cannot state its own fame lines has no
  // business sending a query: it would admit a different catalogue than the
  // panel says it does (ADR-0052), and the collector needs the numbers for its
  // very first decision. Two pairs here — the museums' and the finds' — because
  // a find carries fewer articles than the museum showing it (ADR-0058
  // decision 5); the collector falls back to the one line for a source that
  // states no second pair.
  const line = await readSourceLine(ARCHAEOLOGY_SOURCE_ID);
  const findsLine = contentsLine(line);
  const previousPlacements = await readPreviousPlacements(ARCHAEOLOGY_SOURCE_ID);
  const storedCredits = await readStoredCredits(ARCHAEOLOGY_SOURCE_ID);
  const storedTreasureCredits = await readStoredTreasureCredits();
  // What the source holds as admitted before the run, so the stay line of the
  // hysteretic tier has something to hold (ADR-0023) — by door, since each
  // asks after its own rows and no others (`ArchaeologyPipelineDeps`).
  const [admittedMuseums, admittedSites] = await Promise.all([
    admittedExternalIds(ARCHAEOLOGY_SOURCE_ID, 'museum'),
    admittedExternalIds(ARCHAEOLOGY_SOURCE_ID, 'site'),
  ]);

  // One patience for the whole run, spent on whichever wiki asks for it: this
  // kind reads Wikidata and English Wikipedia in the same collection, and a
  // budget per door is a run that can wait twice as long as either number says
  // (#886).
  const waiting = new WaitBudget(SPARQL_WAIT_BUDGET_MS);

  const { items, fetched, filtered } = await collectWithTheMirrorHeldToAccount({
    sparql: collectingSparql(progress, refreshCache, waiting),
    previousPlacements,
    admittedMuseums,
    admittedSites,
    line,
    categories: categoriesDoor(progress, waiting),
    categoryMembers: categoryMembersDoor(progress, waiting),
    // The site door's second signal. Never a default inside the pipeline: a run
    // that silently read no map would refuse Troy and call it a verdict.
    osm: osmDoor(progress, refreshCache, waiting),
    onPhase: (message) => { progress.statusMessage = message; },
    checkCancel: () => {
      if (progress.cancel) throw new Error('Sync cancelled');
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // The works floor is a question about museums and their finds (ADR-0044). A
  // site holds none, so counting sites here would compare what the catalogue
  // offers at the admitted museums against a list that includes hundreds of
  // rows with nothing inside them — and read the difference as finds that had
  // left.
  const museums = items.filter(
    (item): item is CollectedArchaeologyMuseum => item.type === 'museum',
  );

  // Whether the run saw enough of what the catalogue holds to be believed about
  // what left it (ADR-0044) — measured here, before a single museum is written,
  // over the same placements the collector's diff was measured against, and
  // handed to the orchestrator: it decides the run's status and reaches every
  // museum's writer through the run context, which is what keeps the order —
  // floor first, withdrawal second — out of this file's hands.
  const coverage = {
    stored: previousPlacements,
    admitted: museums.map((m) => ({ qid: m.qid, works: m.treasures.map((t) => t.externalId) })),
  };
  const placedThisRun = new Map<string, Set<string>>();
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
  // it: only the rows this run will write are worth crediting — the museums and
  // the sites both, since a site's photograph is on its card and was taken by
  // somebody too — which is a handful of requests instead of one per candidate
  // the pools ever named. The finds are asked about in the same breath, so that
  // the Rosetta Stone and the British Museum cannot end up crediting the same
  // file differently.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const imageCredits = await fetchCommonsCredits([
    // Both doors' pictures: a site's photograph is shown on its card and was
    // taken by somebody, exactly as a museum's was. Only a museum holds finds.
    ...items.map((item) => item.imageUrl),
    ...museums.flatMap((m) => m.treasures.map((t) => t.imageUrl)),
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

  // What the writers are told about this pass, once, before the first row is
  // written (`archaeology/writer.ts`).
  rememberRun({
    imageCredits, storedCredits, storedTreasureCredits, placedThisRun, findsLine,
  });

  return { items, fetchedCount: fetched, filtered, withdrawalSkippedReason };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — collects the sites the world knows, the museums it knows
 * for their archaeology, and the finds those museums hold.
 */
export function syncArchaeology(
  triggeredBy: number | null,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedArchaeologyItem>({
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
    // Belonging is the badge for a site, and a find is the badge for a museum
    // (ADR-0045 decision 5, the world tier). A site is admitted for being one
    // of the world's archaeological sites, which is exactly what the badge
    // says; a museum is here for what it is, and wears the badge only for
    // holding a find the world knows (ADR-0058 decision 2). The British Museum
    // is badged for the Rosetta Stone, Pompeii for being Pompeii, and the Bardo
    // stands in the kind in full standing without one. Written once admission
    // is settled, not per item (#760).
    badgesAdmitted: (item) => item.type === 'site' || item.findsAboveLine > 0,
    // The one place the run's options reach the collection: the cache is a
    // property of *this* run rather than of the source.
    fetchItems: (progress) => fetchArchaeologyItems(progress, options.refreshCache === true),
    // One item at a time, dispatched on its type by `archaeology/writer.ts`.
    processItem,
    getItemName: (item) => item.label,
    getItemId: (item) => item.qid,
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
  // The sweep is over the source's rows, and from the site door on those are
  // not all museums: an admin reading "40 museums without images" about a list
  // holding Troy is being told something untrue about the catalogue. The
  // worship run's word, for the same reason.
  singular: 'place',
  plural: 'places',
});

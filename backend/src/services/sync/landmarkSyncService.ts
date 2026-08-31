/**
 * Landmark Sync Service
 *
 * Fetches notable outdoor sculptures and monuments from Wikidata.
 * Each item becomes a direct experience with its own map marker.
 * No grouping, no treasures — simpler than museums.
 */

import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import type { SyncProgress, WikidataLandmark, ErrorDetail, ContentsByKind } from './types.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import { foldLabel } from './labelFold.js';
import {
  extractQid,
  isQid,
  parseWktPoint,
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  LABEL_LANGS,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  waitMessage,
  type WikidataDoor,
  type SparqlBinding,
} from './wikidataUtils.js';
import {
  fetchCommonsCredits,
  readStoredCredits,
  creditToWrite,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';

const LANDMARK_CATEGORY_ID = 3;
const TARGET_COUNT = 200;

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

const LOG_PREFIX = '[Landmark Sync]';

/**
 * The landmarks one answer describes, one entry per landmark.
 *
 * **One per item, not one per row** (#720). The queries below carry five
 * OPTIONALs and a monument with several makers therefore arrives several times;
 * this used to push each row as a landmark of its own, so a monument's stored
 * creator was whichever of its duplicates won the upsert — the Fountain of
 * Cybele has seven, the Siegessäule six. Measured on 2026-08-31, the sculpture
 * query answers 130 rows for 80 items and `monument` 134 for 93 against a
 * `LIMIT 160`, so the duplicates were also spending a cap that counts rows.
 *
 * The first row of an item fixes everything single-valued about it, exactly as
 * the museum pool's parse does, and every row contributes its creator.
 *
 * Exported for its test: the grouping is the whole of what one answer becomes,
 * and nothing downstream can be asked whether it happened.
 */
export function bindingsToLandmarks(bindings: SparqlBinding[], type: 'sculpture' | 'monument'): WikidataLandmark[] {
  const landmarks = new Map<string, WikidataLandmark>();
  const seenCreators = new Map<string, Set<string>>();

  for (const b of bindings) {
    const coord = b.coord?.value ? parseWktPoint(b.coord.value) : null;
    if (!coord || !b.item) continue;

    const qid = extractQid(b.item.value);
    let landmark = landmarks.get(qid);
    if (!landmark) {
      landmark = {
        qid,
        label: b.itemLabel?.value || 'Unknown',
        description: b.itemDescription?.value || null,
        lat: coord.lat,
        lon: coord.lon,
        imageUrl: b.image?.value || null,
        creators: [],
        year: b.year?.value ? parseInt(b.year.value) : null,
        sitelinks: parseInt(b.sitelinks?.value || '0'),
        countryLabel: b.countryLabel?.value || null,
        type,
        articleUrl: b.article?.value || null,
        website: b.website?.value || null,
      };
      landmarks.set(qid, landmark);
      seenCreators.set(qid, new Set());
    }

    // Deduped by folded label: the same person can be reached through more than
    // one row, and the query binds no creator entity to tell two apart by.
    //
    // A label that *is* a QID is dropped, as the museum parse drops it: that is
    // the label service answering for an entity it has no name for in any of the
    // eight languages, and a QID on a card names nobody. Collecting every creator
    // rather than whichever won a race is what makes it reachable — an unlabelled
    // co-creator used to lose that race.
    const creator = b.creatorLabel?.value;
    const seen = seenCreators.get(qid)!;
    if (creator && !isQid(creator) && !seen.has(foldLabel(creator))) {
      seen.add(foldLabel(creator));
      landmark.creators.push(creator);
    }
  }

  return [...landmarks.values()];
}

/**
 * Fetch outdoor sculptures from Wikidata (famous sculptures with own coordinates, NOT in museum collections)
 */
async function fetchSculptures(
  progress: SyncProgress,
  sparql: WikidataDoor,
): Promise<WikidataLandmark[]> {
  progress.statusMessage = 'Fetching outdoor sculptures from Wikidata...';

  const query = `
    SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
    WHERE {
      ?item wdt:P31 wd:Q860861 .
      ?item wdt:P625 ?coord .
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks > 15)
      FILTER NOT EXISTS { ?item wdt:P195 ?coll . ?coll wdt:P31/wdt:P279* wd:Q33506 }
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P170 ?creator . FILTER(STRSTARTS(STR(?creator), "http://www.wikidata.org/entity/Q")) }
      OPTIONAL { ?item wdt:P571 ?inception }
      OPTIONAL { ?item wdt:P17 ?country }
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT 300
  `;

  const bindings = await sparql(query);
  const landmarks = bindingsToLandmarks(bindings, 'sculpture');

  console.log(`[Landmark Sync] Fetched ${landmarks.length} outdoor sculptures from Wikidata`);
  return landmarks;
}

/** Monument, memorial, war memorial, and the memorial-plaque-and-marker class. */
const MONUMENT_TYPE_QIDS = ['Q4989906', 'Q575759', 'Q721747', 'Q5003624'];

/** One type's worth: measured at 14 s and 135 rows for `monument` on 2026-08-21. */
const MONUMENT_LIMIT = 160;

function buildMonumentQuery(typeQid: string, limit: number): string {
  return `
    SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
    WHERE {
      ?item wdt:P31 wd:${typeQid} .
      ?item wdt:P625 ?coord .
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks > 20)
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P170 ?creator . FILTER(STRSTARTS(STR(?creator), "http://www.wikidata.org/entity/Q")) }
      OPTIONAL { ?item wdt:P571 ?inception }
      OPTIONAL { ?item wdt:P17 ?country }
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT ${limit}
  `;
}

/**
 * Fetch monuments from Wikidata: one query per type, merged by entity.
 *
 * There used to be a combined `VALUES ?type { … }` query with these four types tried first, and
 * the per-type queries existed as its fallback. Measured against the live endpoint on
 * 2026-08-21, the combined query does not answer at all — no response in 75 s, which means every
 * landmark run spent the service's whole sixty-second deadline on a question that could not
 * finish, and only then asked the four that could. The fallback was not a fallback; it was the
 * working path with a minute of somebody else's cluster wasted in front of it.
 *
 * So the four are the query now. A type that fails is logged and skipped rather than fatal —
 * `landmarks` is a breadth category with no admission rule reading its count, unlike the museum
 * pool (ADR-0024) — but a run that gets nothing from any of them still fails.
 */
async function fetchOneMonumentType(
  typeQid: string,
  progress: SyncProgress,
  sparql: WikidataDoor,
  into: Map<string, SparqlBinding[]>,
): Promise<boolean> {
  try {
    for (const b of await sparql(buildMonumentQuery(typeQid, MONUMENT_LIMIT))) {
      const key = b.item?.value;
      if (!key) continue;
      // **Every row of an item, not the first of them** (#720). This used to be
      // `if (!into.has(key)) into.set(key, b)`, which threw away exactly what a
      // monument with several makers arrives as — so grouping downstream had
      // nothing left to group, and a monument's creator stayed the planner's
      // pick of the first row of whichever of the four type queries answered
      // first. Measured on the run that found it: of 17 monuments proposing
      // creators, the 15 that also instance `sculpture` came through
      // `fetchSculptures` and 9 of those named several people; the 2 that only
      // ever arrive here named one each.
      //
      // Still first-*item*-wins across the four queries, which is what this map
      // is for: a memorial that is also a cenotaph is one monument.
      const rows = into.get(key);
      if (rows) rows.push(b); else into.set(key, [b]);
    }
    return true;
  } catch (error) {
    // A cancelled run is not a type that failed; carrying on would send the
    // next three queries after the stop was pressed.
    if (progress.cancel) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Landmark Sync] Monument query failed for ${typeQid}: ${message}`);
    return false;
  }
}

/**
 * The monuments four type queries between them offer, each with every row it
 * arrived on.
 *
 * Exported for its test: the collection across the four queries is where a
 * monument's rows were being thrown away, and `bindingsToLandmarks` cannot be
 * asked whether they reached it.
 */
export async function fetchMonuments(
  progress: SyncProgress,
  sparql: WikidataDoor,
): Promise<WikidataLandmark[]> {
  const collected = new Map<string, SparqlBinding[]>();
  let succeeded = 0;

  for (let i = 0; i < MONUMENT_TYPE_QIDS.length; i++) {
    progress.statusMessage =
      `Fetching monuments from Wikidata (type ${i + 1}/${MONUMENT_TYPE_QIDS.length})...`;
    if (await fetchOneMonumentType(MONUMENT_TYPE_QIDS[i], progress, sparql, collected)) {
      succeeded++;
    }
    await delay(SPARQL_DELAY_MS);
  }

  const landmarks = bindingsToLandmarks([...collected.values()].flat(), 'monument');
  if (succeeded === 0 || landmarks.length === 0) {
    throw new Error('Monument fetch failed: no type query answered');
  }
  console.log(
    `[Landmark Sync] Fetched ${landmarks.length} monuments from Wikidata `
    + `(${succeeded}/${MONUMENT_TYPE_QIDS.length} types answered)`,
  );
  return landmarks;
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
    creators: landmark.creators,
    year: landmark.year,
    sitelinksCount: landmark.sitelinks,
    type: landmark.type,
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
    category: landmark.type,
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

async function tryFetchSource(
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  sourceName: string,
  fetcher: () => Promise<WikidataLandmark[]>,
): Promise<WikidataLandmark[]> {
  if (progress.cancel) throw new Error('Sync cancelled');
  try {
    return await fetcher();
  } catch (error) {
    // A cancelled run is not a source that failed: swallowing it here would have
    // the run carry on to the next query with the stop already pressed.
    if (progress.cancel) throw error;
    const message = error instanceof Error ? error.message : String(error);
    progress.errors++;
    errorDetails.push({ externalId: `fetch-${sourceName}`, error: message });
    console.warn(`[Landmark Sync] ${sourceName} fetch failed: ${message}`);
    return [];
  }
}

function dedupeBySitelinks(...lists: WikidataLandmark[][]): WikidataLandmark[] {
  const seen = new Set<string>();
  const merged: WikidataLandmark[] = [];
  for (const item of lists.flat().sort((a, b) => b.sitelinks - a.sitelinks)) {
    if (!seen.has(item.qid)) {
      seen.add(item.qid);
      merged.push(item);
    }
  }
  return merged;
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
 * Fetch, merge, deduplicate, and disambiguate landmarks from Wikidata.
 */
async function fetchLandmarkItems(
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
): Promise<{ items: WikidataLandmark[]; fetchedCount: number }> {
  // One patience for the five SPARQL queries, spent by whichever of them needs it.
  // The Commons credit pass below allocates its own, like the museum collector:
  // by the time it runs this one is spent, and a run that waited out a bad
  // quarter-hour at Wikidata should still be able to ask who took the pictures.
  const sparql = wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX);
  imageCredits = new Map();
  storedCredits = await readStoredCredits(LANDMARK_CATEGORY_ID);

  const sculptures = await tryFetchSource(progress, errorDetails, 'sculptures',
    () => fetchSculptures(progress, sparql));
  await delay(SPARQL_DELAY_MS);
  const monuments = await tryFetchSource(progress, errorDetails, 'monuments',
    () => fetchMonuments(progress, sparql));

  if (sculptures.length === 0 && monuments.length === 0) {
    throw new Error('Landmark sync failed: no data fetched from Wikidata');
  }

  const allLandmarks = dedupeBySitelinks(sculptures, monuments);
  console.log(`[Landmark Sync] Total after dedup: ${allLandmarks.length} (${sculptures.length} sculptures, ${monuments.length} monuments)`);

  const landmarks = allLandmarks.slice(0, TARGET_COUNT);
  console.log(`[Landmark Sync] Processing top ${landmarks.length} landmarks`);

  disambiguateDuplicateNames(landmarks);

  // After the cut to TARGET_COUNT, so the credit pass asks about the 200 rows
  // that will exist rather than the 400 the two queries between them named.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  imageCredits = await fetchCommonsCredits(landmarks.map((l) => l.imageUrl), {
    userAgent: WIKIDATA_USER_AGENT,
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  return { items: landmarks, fetchedCount: allLandmarks.length };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — fetches outdoor sculptures and monuments from Wikidata
 */
export function syncLandmarks(
  triggeredBy: number | null,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  return orchestrateSync<WikidataLandmark>({
    categoryId: LANDMARK_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // Results are sorted by sitelinks and cut at TARGET_COUNT, so absence from a
    // run means "ranked lower", not "gone".
    sourceCompleteness: 'ranked',
    fetchItems: fetchLandmarkItems,
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

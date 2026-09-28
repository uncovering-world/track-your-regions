/**
 * The doors one pass of the Archaeology run asks its questions through:
 * Wikidata, English Wikipedia's categories and its category walk, the wiki a
 * tagged article is about, and OpenStreetMap — each with the run's cache and
 * the pass's wait budget composed over it.
 *
 * A pass is the whole collection through one OpenStreetMap door
 * (`osm/oneDoorPerRun.ts`). Built here, all at once, so a second pass on the
 * day the mirror fails is built exactly as the first was, with Overpass in the
 * mirror's place and a patience of its own, and so the pipeline receives the
 * same functions either way (`ArchaeologyPipelineDeps`).
 */

import type { SyncProgress } from '../types.js';
import { forgetCached, withCache, type CacheDescriptor } from '../wikidataCache.js';
import type { ArchaeologyPipelineDeps } from './pipeline.js';
import { qleverOsmDoor } from '../osm/qleverOsm.js';
import { overpassOsmDoor } from '../osm/overpassOsm.js';
import { readOsmDigs, readOsmObjects, type OsmDoor, type OsmReaderName } from '../osm/readOsmObjects.js';
import type { OsmReader, SiteEntrance } from './sites.js';
import { fetchWikipediaCategories } from '../wikipediaCategories.js';
import { resolveWikipediaArticles } from '../wikipediaArticles.js';
import { fetchCategoryMembers } from '../wikipediaCategoryMembers.js';
import { NATURE_CATEGORY, NATURE_CATEGORY_ROOT, OSM_DIG_TAGS } from './classes.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  waitMessage,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  type SparqlBinding,
} from '../wikidataUtils.js';

export const ARCHAEOLOGY_SOURCE_ID = 5;

export const LOG_PREFIX = '[Archaeology Sync]';

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
 * What OpenStreetMap maps at each site candidate, through the pass's door.
 * **A batch that cannot be read ends the pass**, for the reason the Wikipedia
 * readers end it: read as silence, a lost answer says "no OSM object carries
 * this item" for every site in it, which refuses precisely the sites the rule
 * exists to admit. The error travels out of the collection as
 * `OsmDoorFailedError`, which is what lets the run read the map again through
 * Overpass when the door was the mirror (`osm/oneDoorPerRun.ts`).
 *
 * Which geometries are worth the wire is not decided here. `collectSitesByFame`
 * hands the keep rule in (`OSM_KEEP_WKT`), because it is the kind's line
 * through OSM's keys rather than a property of how either door is asked.
 */
function osmReader(door: OsmDoor): OsmReader {
  return (qids, keep, run) => readOsmObjects(door, qids, keep, run);
}

/**
 * The site pool's second entrance (#895): every object OpenStreetMap tags as
 * a dig or as ruins, through the same door as the per-item read and kept a
 * day like it — asked once a pass, and an answer with nothing in it ends
 * the pass rather than reading as "the map holds no dig" (`readOsmDigs`).
 */
function osmDigsReader(door: OsmDoor): SiteEntrance['digs'] {
  return (run) => readOsmDigs(door, OSM_DIG_TAGS, run);
}

/**
 * The door a pass reads OpenStreetMap through, with the run's cache composed
 * over its `send` so every answer is kept like every other this run pays for —
 * and with a note of every question it answered from the cache or wrote into
 * it, so a door that turns out to be failing can have exactly those answers
 * taken back (`forget`) and the next run does not read them.
 */
function cachedOsmDoor(
  reader: OsmReaderName, progress: SyncProgress, refreshCache: boolean, budget: WaitBudget,
): { door: OsmDoor; forget: () => Promise<number> } {
  const door: OsmDoor = reader === 'overpass'
    ? overpassOsmDoor(progress, budget, LOG_PREFIX)
    : qleverOsmDoor(progress, budget, LOG_PREFIX);
  const cached = withCache(door.send, {
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
  // Only what the cache could have served or kept: a run started without it
  // neither reads nor writes a row, and taking back an earlier run's answers
  // on its behalf would drop what this run never touched.
  const touched: string[] = [];
  const send: OsmDoor['send'] = (query, descriptor) => {
    if (descriptor && !refreshCache) touched.push(query);
    return cached(query, descriptor);
  };
  return {
    door: { ...door, send },
    forget: () => forgetCached(ARCHAEOLOGY_SOURCE_ID, touched),
  };
}

/**
 * Which item a `wikipedia=lang:Title` tag is about, through that wiki's own
 * API (#895) — the category client's transport and patience, on the wiki the
 * tag names, drawn from the pass's one budget.
 */
function articlesDoor(
  progress: SyncProgress, budget: WaitBudget,
): SiteEntrance['resolveArticles'] {
  return (tags) => resolveWikipediaArticles(tags, {
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    budget,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikipedia', wait, budget); },
  });
}

/** What a pass hands the pipeline, and the door it read the map through. */
export interface PassDoors {
  deps: Pick<
    ArchaeologyPipelineDeps,
    'sparql' | 'categories' | 'categoryMembers' | 'osm' | 'osmDigs' | 'resolveArticles'
  >;
  osm: OsmDoor;
  /** Takes back the cached OpenStreetMap answers this pass's door touched. */
  forgetOsm: () => Promise<number>;
}

/**
 * Every door of one pass, sharing one wait budget: this pass waits on
 * Wikidata, two wikis' APIs and OpenStreetMap, and a budget per door is a pass
 * that waits four times the number any one of them was held to (#886). Built
 * once a pass and handed to both reads of the map, so the enumeration and the
 * per-item read cannot go through different doors.
 */
export function doorsForAPass(
  reader: OsmReaderName, progress: SyncProgress, refreshCache: boolean,
): PassDoors {
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  // Wikidata's first: each composes the run's cache over its send.
  const sparql = collectingSparql(progress, refreshCache, budget);
  const { door, forget } = cachedOsmDoor(reader, progress, refreshCache, budget);
  return {
    deps: {
      sparql,
      categories: categoriesDoor(progress, budget),
      categoryMembers: categoryMembersDoor(progress, budget),
      // The site door's second signal. Never a default inside the pipeline: a
      // run that silently read no map would refuse Troy and call it a verdict.
      osm: osmReader(door),
      osmDigs: osmDigsReader(door),
      resolveArticles: articlesDoor(progress, budget),
    },
    osm: door,
    forgetOsm: forget,
  };
}

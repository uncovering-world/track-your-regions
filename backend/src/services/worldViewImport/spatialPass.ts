/**
 * The automatic spatial pass after the name matcher (#622).
 *
 * The name matcher gives up where names diverge. Kabardino-Balkaria has no GADM
 * name it matches, yet its node carries Q5775, its own Wikidata item, in
 * `region_import_state.source_external_id`. The scorers that resolve such a node
 * already exist, but ran only behind the review's per-region buttons. This pass
 * runs them over what the name matcher left: every leaf still `no_candidates` or
 * `needs_review` that carries a Wikidata id.
 *
 * Per leaf, in order:
 * - **geoshape first** (`geoshapeMatchRegion`): the item's shape against GADM,
 *   with the same covering set, exclusions and status the Geoshape Match button
 *   writes;
 * - **point scorer only where no geoshape could be had** (`pointMatchRegion`),
 *   which is what the Point Match button is for;
 * - **similarity scoring** on every leaf it reaches, a single suggestion the name matcher left included
 *   (`computeGeoSimilarityIfNeeded`), which auto-accepts a perfect match under
 *   the IoU thresholds the buttons use.
 *
 * It changes when the scorers run, never how they decide. Rejected suggestions
 * and divisions already assigned stay out, because the scorers exclude them
 * themselves.
 *
 * It stays polite to the services behind it. The leaves are taken one at a time,
 * and after each one the pass waits as long as that leaf took (at most
 * `MAX_PAUSE_MS`), and at least `POINT_PAUSE_MS` after a point fallback. A shape
 * from the `wikidata_geoshapes` cache costs milliseconds and so waits almost
 * nothing. The work that leaves the machine waits its own length: a geoshape
 * fetched through `acquireFetchSlot`, a composite built from Wikidata and
 * Wikivoyage when the item has no shape (`tryBuildCompositeGeoshape`, whose
 * SPARQL query is not otherwise paced), and a point fallback's Wikivoyage page.
 * That is the query service's own rule: pause at least as long as the query took.
 *
 * A cancel during the pass stops the scoring and nothing else. The name
 * matcher's results are already written, so the run finishes as a completed one,
 * and the caller marks the import ready for review.
 */

import { pool } from '../../db/index.js';
import type { RegionImportStateRow, RegionsRow } from '../../db/schema.generated.js';
import { computeGeoSimilarityIfNeeded } from './geoshapeCache.js';
import { geoshapeMatchRegion } from './geoshapeCoverage.js';
import { pointMatchRegion } from './pointMatcher.js';
import type { ImportProgress } from './types.js';

/** The least pause after a point fallback, which made a Wikivoyage and a Wikidata request. */
export const POINT_PAUSE_MS = 1000;
/** The longest pause after a leaf, however long its scoring took. */
export const MAX_PAUSE_MS = 30_000;

export interface SpatialPassSummary {
  /** Leaves the name matcher left with a Wikidata id. */
  considered: number;
  /** Of those, how many the pass gave suggestions. */
  seeded: number;
  /** Of the leaves considered, how many it auto-accepted, whether or not it gave them suggestions. */
  accepted: number;
  /** How many it scored before a cancel stopped it, or null when it ran to the end. */
  stoppedAfter: number | null;
}

/** The scorers, injectable so the pass can be tested without the network. */
export interface SpatialScorers {
  geoshape: typeof geoshapeMatchRegion;
  point: typeof pointMatchRegion;
  similarity: typeof computeGeoSimilarityIfNeeded;
  pause: (ms: number) => Promise<void>;
}

const SCORERS: SpatialScorers = {
  geoshape: geoshapeMatchRegion,
  point: pointMatchRegion,
  similarity: computeGeoSimilarityIfNeeded,
  pause: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

/** The leaves the name matcher left without a match that carry a Wikidata id, in id order. */
async function leftoverLeaves(worldViewId: number): Promise<number[]> {
  const rows = await pool.query<Pick<RegionsRow, 'id'>>(
    `SELECT r.id FROM regions r
       JOIN region_import_state ris ON ris.region_id = r.id
      WHERE r.world_view_id = $1 AND r.is_leaf
        AND ris.match_status IN ('no_candidates', 'needs_review')
        AND ris.source_external_id ~ '^Q[0-9]+$'
      ORDER BY r.id`,
    [worldViewId],
  );
  return rows.rows.map(row => row.id);
}

async function statusOf(regionId: number): Promise<RegionImportStateRow['match_status'] | null> {
  const row = await pool.query<Pick<RegionImportStateRow, 'match_status'>>(
    'SELECT match_status FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  return row.rows[0]?.match_status ?? null;
}

/**
 * Score one leaf: the geoshape, the point fallback where no shape could be had,
 * similarity on every leaf it reaches. Answers the least pause it owes, or null
 * for a leaf an admin has matched since the list was read.
 */
async function scoreLeaf(
  worldViewId: number,
  regionId: number,
  scorers: SpatialScorers,
  summary: SpatialPassSummary,
): Promise<number | null> {
  // The list was read at the start and the pass can run for hours while the
  // review stays editable: a leaf an admin has matched since is not scored.
  const before = await statusOf(regionId);
  if (before !== 'no_candidates' && before !== 'needs_review') return null;
  const shape = await scorers.geoshape(worldViewId, regionId);
  let found = shape.found;
  let floor = 0;
  if (shape.geoshapeUnavailable) {
    found = (await scorers.point(worldViewId, regionId)).found;
    floor = POINT_PAUSE_MS;
  }
  if (found > 0) summary.seeded += 1;
  // Scored whether or not the pass added to it: a single suggestion the name
  // matcher left is accepted when it is a perfect match (#1629), and the
  // similarity step returns at once for a leaf that holds none.
  await scorers.similarity(regionId);
  if (await statusOf(regionId) === 'auto_matched') summary.accepted += 1;
  return floor;
}

/**
 * Run both scorers over what the name matcher left, reporting through the match
 * phase's own counters (`matchTotal`, `matchDone`) and stopping on `cancel`.
 */
export async function runSpatialPass(
  worldViewId: number,
  progress: ImportProgress,
  scorers: SpatialScorers = SCORERS,
): Promise<SpatialPassSummary> {
  const leaves = await leftoverLeaves(worldViewId);
  const summary: SpatialPassSummary = { considered: leaves.length, seeded: 0, accepted: 0, stoppedAfter: null };
  progress.matchTotal = leaves.length;
  progress.matchDone = 0;

  for (const regionId of leaves) {
    if (progress.cancel) {
      summary.stoppedAfter = progress.matchDone;
      break;
    }
    progress.statusMessage = `Spatial pass: ${progress.matchDone + 1} of ${leaves.length} leaves with a Wikidata id`;
    const started = Date.now();
    let floor: number | null = 0;
    try {
      floor = await scoreLeaf(worldViewId, regionId, scorers, summary);
    } catch (err) {
      // One leaf's failure (a page that will not parse, a shape that will not
      // fetch) leaves it as the name matcher left it, and the pass goes on.
      console.warn('[Spatial Pass] Region %d failed:', regionId, err instanceof Error ? err.message : err);
    }
    progress.matchDone += 1;
    if (floor !== null) await scorers.pause(Math.min(MAX_PAUSE_MS, Math.max(floor, Date.now() - started)));
  }
  console.log(`[Spatial Pass] World view ${worldViewId}: ${summary.considered} leaves, ${summary.seeded} given suggestions, ${summary.accepted} auto-accepted`);
  return summary;
}

/** The pass's outcome as the sentence a completion message carries. */
export function spatialSentence(summary: SpatialPassSummary): string {
  if (summary.considered === 0) return '';
  const stopped = summary.stoppedAfter === null ? '' : ` (cancelled after ${summary.stoppedAfter})`;
  return ` Spatial pass: ${summary.seeded} of ${summary.considered} leaves with a Wikidata id given suggestions, ${summary.accepted} auto-accepted${stopped}.`;
}

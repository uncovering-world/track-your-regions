/**
 * WorldView Import Matcher — Legacy Leaf-Level Matching
 *
 * Matches every leaf region independently against all GADM divisions.
 * Kept for backward compatibility; new imports use matchCountryLevel().
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchStatus } from './types.js';
import { computeGeoSimilarityForRegion } from './geoshapeCache.js';
import {
  getNameVariants,
  getPath,
  loadGADMData,
  type GADMData,
} from './matcherUtils.js';

/**
 * Match all leaf regions in a WorldView to GADM divisions (LEGACY).
 * Kept for backward compatibility. New imports use matchCountryLevel().
 */
export async function matchLeafRegions(
  worldViewId: number,
  progress: ImportProgress,
): Promise<void> {
  progress.status = 'matching';
  const startTime = Date.now();

  // Phase 1: Pre-load GADM data
  progress.statusMessage = 'Loading GADM divisions into memory...';
  console.log('[WV Matcher] Loading all divisions into memory...');
  const gadm = await loadGADMData();
  console.log(`[WV Matcher] Loaded ${gadm.divisionsById.size} divisions, ${gadm.countryIds.size} countries`);

  // Phase 2: Load all regions + ancestor paths
  progress.statusMessage = 'Loading regions and ancestor paths...';

  const regionResult = await pool.query(`
    SELECT id, name, is_leaf FROM regions
    WHERE world_view_id = $1
    ORDER BY id
  `, [worldViewId]);
  const allRegions = regionResult.rows as Array<{ id: number; name: string; is_leaf: boolean }>;

  const ancestorResult = await pool.query(`
    WITH RECURSIVE region_ancestors AS (
      SELECT id, name, parent_region_id, id AS region_id
      FROM regions
      WHERE world_view_id = $1
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, ra.region_id
      FROM regions r
      JOIN region_ancestors ra ON r.id = ra.parent_region_id
    )
    SELECT region_id, array_agg(name ORDER BY id) AS ancestor_names
    FROM region_ancestors
    GROUP BY region_id
  `, [worldViewId]);

  const ancestorsByRegionId = new Map<number, string[]>();
  for (const row of ancestorResult.rows) {
    ancestorsByRegionId.set(row.region_id as number, row.ancestor_names as string[]);
  }

  const leafCount = allRegions.filter(r => r.is_leaf).length;
  progress.totalCountries = leafCount; // legacy: use totalCountries for leaf count
  progress.statusMessage = `Matching ${allRegions.length} regions (${leafCount} leaves)...`;
  console.log(`[WV Matcher] Pre-loading complete. Found ${allRegions.length} regions (${leafCount} leaves) to match`);

  // Phase 3: Match each region
  const updates: Array<{ id: number; matchStatus: MatchStatus; suggestions: MatchSuggestion[]; divisionId?: number }> = [];

  for (let i = 0; i < allRegions.length; i++) {
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Matching cancelled';
      return;
    }

    const region = allRegions[i];
    progress.matchedRegions = i + 1;
    if ((i + 1) % 200 === 0) {
      progress.statusMessage = `Matching regions... ${i + 1}/${allRegions.length}`;
    }

    // Find country context from ancestors (in-memory)
    const ancestorNames = ancestorsByRegionId.get(region.id) ?? [region.name];
    let countryId: number | null = null;
    for (const name of ancestorNames) {
      const variants = getNameVariants(name);
      for (const variant of variants) {
        const ids = gadm.gadmCountries.get(variant);
        if (ids && ids.length > 0) {
          countryId = ids[0]; // Use first match for country context
          break;
        }
      }
      if (countryId) break;
    }

    const descendantSet = countryId ? gadm.countryDescendants.get(countryId) ?? null : null;

    // Find candidates
    const candidates = await findCandidatesOptimized(
      region.name, countryId, descendantSet, gadm,
    );

    // Determine match status
    if (region.is_leaf) {
      if (candidates.length === 1 && candidates[0].score >= 700) {
        progress.countriesMatched++;
        updates.push({ id: region.id, matchStatus: 'auto_matched', suggestions: candidates, divisionId: candidates[0].divisionId });
      } else if (candidates.length > 0) {
        updates.push({ id: region.id, matchStatus: 'needs_review', suggestions: candidates });
      } else {
        progress.noCandidates++;
        updates.push({ id: region.id, matchStatus: 'no_candidates', suggestions: [] });
      }
    } else {
      if (candidates.length > 0) {
        updates.push({ id: region.id, matchStatus: 'suggested', suggestions: candidates });
      }
    }
  }

  // Phase 4: Batch-write results to relational tables
  progress.statusMessage = 'Writing match results...';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const update of updates) {
      // Update match status in region_import_state
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );

      // Insert suggestions into region_match_suggestions
      for (const suggestion of update.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [update.id, suggestion.divisionId, suggestion.name, suggestion.path, suggestion.score],
        );
      }

      if (update.divisionId) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [update.id, update.divisionId],
        );
      }

    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Geo comparison — runs after match transaction commits
  const geoUpdates = updates.filter(u =>
    u.suggestions.length > 1 && (u.matchStatus === 'needs_review' || u.matchStatus === 'suggested'),
  );
  if (geoUpdates.length > 0) {
    const geoClient = await pool.connect();
    try {
      for (const update of geoUpdates) {
        try {
          await computeGeoSimilarityForRegion(geoClient, update.id, update.suggestions);
        } catch (err) {
          console.warn(`[WV Matcher] Geo similarity failed for region ${update.id}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      geoClient.release();
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: auto=${progress.countriesMatched}, none=${progress.noCandidates}`);
}

/**
 * Find candidate divisions using in-memory lookups + DB fallback for trigram.
 */
async function findCandidatesOptimized(
  regionName: string,
  countryDivisionId: number | null,
  descendantSet: Set<number> | null,
  gadm: GADMData,
): Promise<MatchSuggestion[]> {
  const nameVariants = getNameVariants(regionName);
  const candidates = new Map<number, MatchSuggestion>();

  for (const variant of nameVariants) {
    // Exact match (in-memory)
    const exactMatches = gadm.divisionsByNormalizedName.get(variant);
    if (exactMatches) {
      for (const entry of exactMatches) {
        if (candidates.has(entry.id)) continue;
        let score = 400;
        if (descendantSet?.has(entry.id)) score += 300;
        candidates.set(entry.id, {
          divisionId: entry.id, name: entry.name, path: '', score,
        });
      }
    }

    // Trigram similarity (DB with GIN index)
    if (candidates.size < 5) {
      const trigramResult = await pool.query(`
        SELECT id, name, similarity(name_normalized, $1) AS sim
        FROM administrative_divisions
        WHERE name_normalized % $1
          AND similarity(name_normalized, $1) > 0.4
        ORDER BY sim DESC
        LIMIT 10
      `, [variant]);

      for (const row of trigramResult.rows) {
        const id = row.id as number;
        if (candidates.has(id)) continue;
        let score = Math.round((row.sim as number) * 100);
        if (descendantSet?.has(id)) score += 300;
        candidates.set(id, {
          divisionId: id, name: row.name as string, path: '', score,
        });
      }
    }
  }

  // Prefer candidates within the country
  let candidateList = Array.from(candidates.values());
  if (countryDivisionId && descendantSet) {
    const inCountry = candidateList.filter(c => descendantSet.has(c.divisionId));
    if (inCountry.length > 0) {
      if (inCountry.length === 1) inCountry[0].score += 50;
      candidateList = inCountry;
    }
  }

  if (candidateList.length === 1) candidateList[0].score += 50;

  // Fill in paths
  for (const c of candidateList) {
    c.path = getPath(c.divisionId, gadm.pathCache, gadm.divisionsById);
  }

  return candidateList.sort((a, b) => b.score - a.score).slice(0, 5);
}

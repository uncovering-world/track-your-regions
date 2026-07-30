/**
 * Legacy leaf-level matching policy
 *
 * Matches every leaf region independently against all GADM divisions. Kept for
 * backward compatibility; new imports use the country-based or hierarchical
 * policy instead. Shared name and GADM machinery lives in `matcherUtils.ts`.
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchUpdate } from './types.js';
import {
  getNameVariants,
  getPath,
  loadGADMData,
  type GADMData,
} from './matcherUtils.js';

// ─── Legacy leaf-level matcher ───────────────────────────────────────────────

interface RegionRow { id: number; name: string; is_leaf: boolean }

async function loadRegionsAndAncestors(worldViewId: number): Promise<{
  allRegions: RegionRow[];
  ancestorsByRegionId: Map<number, string[]>;
}> {
  const regionResult = await pool.query(`
    SELECT id, name, is_leaf FROM regions
    WHERE world_view_id = $1
    ORDER BY id
  `, [worldViewId]);

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
  return {
    allRegions: regionResult.rows as RegionRow[],
    ancestorsByRegionId,
  };
}

function findCountryFromAncestors(ancestorNames: string[], gadm: GADMData): number | null {
  for (const name of ancestorNames) {
    const variants = getNameVariants(name);
    for (const variant of variants) {
      const ids = gadm.gadmCountries.get(variant);
      if (ids && ids.length > 0) return ids[0];
    }
  }
  return null;
}

function classifyLeafCandidates(
  region: RegionRow,
  candidates: MatchSuggestion[],
  progress: ImportProgress,
): MatchUpdate {
  if (candidates.length === 1 && candidates[0].score >= 700) {
    progress.countriesMatched++;
    return {
      id: region.id,
      matchStatus: 'auto_matched',
      suggestions: candidates,
      divisionId: candidates[0].divisionId,
    };
  }
  if (candidates.length > 0) {
    return { id: region.id, matchStatus: 'needs_review', suggestions: candidates };
  }
  progress.noCandidates++;
  return { id: region.id, matchStatus: 'no_candidates', suggestions: [] };
}

async function writePlainMatchUpdates(updates: MatchUpdate[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of updates) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );
      for (const s of update.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [update.id, s.divisionId, s.name, s.path, s.score],
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
}

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

  progress.statusMessage = 'Loading GADM divisions into memory...';
  console.log('[WV Matcher] Loading all divisions into memory...');
  const gadm = await loadGADMData();
  console.log(`[WV Matcher] Loaded ${gadm.divisionsById.size} divisions, ${gadm.countryIds.size} countries`);

  progress.statusMessage = 'Loading regions and ancestor paths...';
  const { allRegions, ancestorsByRegionId } = await loadRegionsAndAncestors(worldViewId);

  const leafCount = allRegions.filter(r => r.is_leaf).length;
  progress.totalCountries = leafCount; // legacy: use totalCountries for leaf count
  progress.statusMessage = `Matching ${allRegions.length} regions (${leafCount} leaves)...`;
  console.log(`[WV Matcher] Pre-loading complete. Found ${allRegions.length} regions (${leafCount} leaves) to match`);

  const updates: MatchUpdate[] = [];

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

    const ancestorNames = ancestorsByRegionId.get(region.id) ?? [region.name];
    const countryId = findCountryFromAncestors(ancestorNames, gadm);
    const descendantSet = countryId ? gadm.countryDescendants.get(countryId) ?? null : null;
    const candidates = await findCandidatesOptimized(region.name, countryId, descendantSet, gadm);

    if (region.is_leaf) {
      updates.push(classifyLeafCandidates(region, candidates, progress));
    } else if (candidates.length > 0) {
      updates.push({ id: region.id, matchStatus: 'suggested', suggestions: candidates });
    }
  }

  progress.statusMessage = 'Writing match results...';
  await writePlainMatchUpdates(updates);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: auto=${progress.countriesMatched}, none=${progress.noCandidates}`);
}

function addExactMatchCandidates(
  variant: string,
  descendantSet: Set<number> | null,
  gadm: GADMData,
  candidates: Map<number, MatchSuggestion>,
): void {
  const exactMatches = gadm.divisionsByNormalizedName.get(variant);
  if (!exactMatches) return;
  for (const entry of exactMatches) {
    if (candidates.has(entry.id)) continue;
    let score = 400;
    if (descendantSet?.has(entry.id)) score += 300;
    candidates.set(entry.id, { divisionId: entry.id, name: entry.name, path: '', score });
  }
}

async function addTrigramMatchCandidates(
  variant: string,
  descendantSet: Set<number> | null,
  candidates: Map<number, MatchSuggestion>,
): Promise<void> {
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
    candidates.set(id, { divisionId: id, name: row.name as string, path: '', score });
  }
}

function preferInCountryCandidates(
  candidateList: MatchSuggestion[],
  descendantSet: Set<number> | null,
): MatchSuggestion[] {
  if (!descendantSet) return candidateList;
  const inCountry = candidateList.filter(c => descendantSet.has(c.divisionId));
  if (inCountry.length === 0) return candidateList;
  if (inCountry.length === 1) inCountry[0].score += 50;
  return inCountry;
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
  const candidates = new Map<number, MatchSuggestion>();

  for (const variant of getNameVariants(regionName)) {
    addExactMatchCandidates(variant, descendantSet, gadm, candidates);
    if (candidates.size < 5) {
      await addTrigramMatchCandidates(variant, descendantSet, candidates);
    }
  }

  let candidateList = Array.from(candidates.values());
  if (countryDivisionId) {
    candidateList = preferInCountryCandidates(candidateList, descendantSet);
  }
  if (candidateList.length === 1) candidateList[0].score += 50;

  for (const c of candidateList) {
    c.path = getPath(c.divisionId, gadm.pathCache, gadm.divisionsById);
  }

  return candidateList.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * WorldView Import — DB-Based Search Matching
 *
 * Trigram similarity search against GADM divisions using PostgreSQL's pg_trgm.
 * No AI involved — purely database-driven fuzzy matching.
 */

import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus } from './types.js';

/**
 * Search GADM divisions by trigram similarity.
 * Returns multiple candidates sorted by similarity.
 */
export async function trigramSearch(
  regionName: string,
  limit = 5,
): Promise<Array<{ divisionId: number; name: string; path: string; similarity: number }>> {
  const normalized = regionName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\([^)]*\)$/, '') // strip parenthetical like "(Cape Verde)"
    .toLowerCase()
    .trim();

  const result = await pool.query(`
    SELECT ad.id, ad.name,
           similarity(ad.name_normalized, $1) AS sim,
           (
             WITH RECURSIVE div_ancestors AS (
               SELECT ad.id, ad.name, ad.parent_id
               UNION ALL
               SELECT d.id, d.name, d.parent_id
               FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
             )
             SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
           ) AS path
    FROM administrative_divisions ad
    WHERE ad.name_normalized % $1
      AND similarity(ad.name_normalized, $1) > 0.3
    ORDER BY sim DESC
    LIMIT $2
  `, [normalized, limit]);

  return result.rows.map(row => ({
    divisionId: row.id as number,
    name: row.name as string,
    path: row.path as string,
    similarity: row.sim as number,
  }));
}

/**
 * Try matching a single region using trigram similarity (no AI).
 * Returns the best candidate if found with sufficient similarity.
 */
export async function tryTrigramMatch(
  regionName: string,
): Promise<{ divisionId: number; name: string; path: string; similarity: number } | null> {
  const candidates = await trigramSearch(regionName, 1);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Search for a single region using DB trigram similarity only (no AI).
 * Used for the per-region "DB Search" button in the tree UI.
 */
export async function dbSearchSingleRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: MatchSuggestion[] }> {
  // Load the region with import state and suggestions
  const result = await pool.query(`
    SELECT r.id, r.name, r.is_leaf,
      ris.match_status,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id,
        'name', rms.name,
        'path', rms.path,
        'score', rms.score
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT COALESCE(json_agg(rms.division_id), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = true) AS rejected_ids
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (result.rows.length === 0) {
    throw new Error('Region not found in this world view');
  }

  const row = result.rows[0];
  const regionName = row.name as string;
  const isLeaf = row.is_leaf as boolean;
  const rejectedIds = new Set<number>((row.rejected_ids as number[]) ?? []);
  const existingSuggestions = (row.suggestions as MatchSuggestion[]) ?? [];

  // Load already-assigned member division IDs
  const membersResult = await pool.query(
    `SELECT division_id FROM region_members WHERE region_id = $1`,
    [regionId],
  );
  const assignedIds = new Set<number>(membersResult.rows.map(r => r.division_id as number));

  // Search using trigram similarity
  const candidates = await trigramSearch(regionName, 5);

  // Filter out rejected, already-suggested, and already-assigned divisions
  const existingIds = new Set(existingSuggestions.map(s => s.divisionId));
  const newCandidates = candidates
    .filter(c => !rejectedIds.has(c.divisionId) && !existingIds.has(c.divisionId) && !assignedIds.has(c.divisionId));

  if (newCandidates.length === 0) {
    return { found: 0, suggestions: [] };
  }

  // Build suggestion objects
  const newSuggestions: MatchSuggestion[] = newCandidates.map(c => ({
    divisionId: c.divisionId,
    name: c.name,
    path: c.path,
    score: Math.round(c.similarity * 1000),
  }));

  // Write new suggestions to region_match_suggestions and update status
  const newStatus: MatchStatus = !isLeaf ? 'suggested' : 'needs_review';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  for (const s of newSuggestions) {
    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [regionId, s.divisionId, s.name, s.path, s.score],
    );
  }

  return { found: newCandidates.length, suggestions: newSuggestions };
}

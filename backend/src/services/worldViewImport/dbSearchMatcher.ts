/**
 * WorldView Import — DB-Based Search Matching
 *
 * Trigram similarity search against GADM divisions using PostgreSQL's pg_trgm.
 * No AI involved — purely database-driven fuzzy matching.
 */

import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus } from './types.js';

/**
 * Strip a trailing parenthetical annotation (e.g. "Praia (Cape Verde)" → "Praia").
 * Linear-time, because the regex `\s*\([^)]*\)$` is potentially super-linear
 * (sonarjs/slow-regex).
 * Behavior: if the trimmed name ends with ")" and contains a matching "(",
 * and the content between them contains no other ")", the parenthetical
 * (along with preceding whitespace) is removed.
 */
function stripTrailingParenthetical(name: string): string {
  const trimmed = name.trimEnd();
  if (!trimmed.endsWith(')')) return trimmed;
  const openIdx = trimmed.lastIndexOf('(');
  if (openIdx < 0) return trimmed;
  const inside = trimmed.slice(openIdx + 1, -1);
  if (inside.includes(')')) return trimmed;
  return trimmed.slice(0, openIdx).trimEnd();
}

/**
 * Search GADM divisions by trigram similarity.
 * Returns multiple candidates sorted by similarity.
 *
 * `within` is the only divisions it may answer (`descendantSearchScopes`). A
 * region inside a matched container is a part of that place, so a candidate
 * from elsewhere is a namesake, not a match: "Northern Benin" searched
 * worldwide finds Sudan's Northern state (#1035).
 */
export async function trigramSearch(
  regionName: string,
  limit = 5,
  within?: number[],
): Promise<Array<{ divisionId: number; name: string; path: string; similarity: number }>> {
  const normalized = stripTrailingParenthetical(regionName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // The scope filters what the trigram index found, so a search inside a
  // country costs about what a worldwide one does.
  const scoped = within !== undefined;
  const params: unknown[] = scoped ? [normalized, limit, within] : [normalized, limit];
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
      ${scoped ? 'AND ad.id = ANY($3::int[])' : ''}
    ORDER BY sim DESC
    LIMIT $2
  `, params);

  return result.rows.map(row => ({
    divisionId: row.id as number,
    name: row.name as string,
    path: row.path as string,
    similarity: row.sim as number,
  }));
}

/**
 * For each region, the divisions its name is searched among: the members of
 * its nearest ancestor that has any, and everything GADM holds under them
 * (#1035). The walk goes up past ancestors with no members, so a leaf under an
 * unmatched intermediate is still scoped by the matched container above it. A
 * region with no matched ancestor is left out of the map, since there is
 * nothing to scope it by.
 *
 * Each ancestor's subtree is walked once and shared by the regions under it:
 * France's is some forty thousand divisions, too many to walk per leaf.
 */
export async function descendantSearchScopes(regionIds: number[]): Promise<Map<number, number[]>> {
  if (regionIds.length === 0) return new Map();
  const nearest = await pool.query<{ region_id: number; ancestor_id: number }>(`
    WITH RECURSIVE up AS (
      SELECT r.id AS region_id, r.parent_region_id AS ancestor_id
      FROM regions r WHERE r.id = ANY($1::int[])
      UNION ALL
      SELECT up.region_id, a.parent_region_id
      FROM up JOIN regions a ON a.id = up.ancestor_id
      WHERE NOT EXISTS (SELECT 1 FROM region_members m WHERE m.region_id = a.id)
    )
    SELECT up.region_id, up.ancestor_id FROM up
    WHERE EXISTS (SELECT 1 FROM region_members m WHERE m.region_id = up.ancestor_id)
  `, [regionIds]);
  const ancestorIds = [...new Set(nearest.rows.map(r => r.ancestor_id))];
  if (ancestorIds.length === 0) return new Map();

  const subtrees = await pool.query<{ ancestor_id: number; division_ids: number[] }>(`
    WITH RECURSIVE scope AS (
      SELECT m.region_id AS ancestor_id, m.division_id AS id
      FROM region_members m WHERE m.region_id = ANY($1::int[])
      UNION
      SELECT s.ancestor_id, d.id
      FROM administrative_divisions d JOIN scope s ON d.parent_id = s.id
    )
    SELECT ancestor_id, array_agg(id) AS division_ids FROM scope GROUP BY ancestor_id
  `, [ancestorIds]);
  const byAncestor = new Map(subtrees.rows.map(r => [r.ancestor_id, r.division_ids]));

  const scopes = new Map<number, number[]>();
  for (const { region_id, ancestor_id } of nearest.rows) {
    const divisions = byAncestor.get(ancestor_id);
    if (divisions) scopes.set(region_id, divisions);
  }
  return scopes;
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

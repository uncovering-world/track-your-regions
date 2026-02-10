/**
 * Division search operations
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import type { AdministrativeDivisionWithPath } from './types.js';

/**
 * Search for regions by name with optional fuzzy matching
 * First tries regular ILIKE search (with accent-insensitive fallback),
 * then falls back to trigram similarity if no results
 *
 * Ranking (higher = better):
 * - Exact name match: +1000 points
 * - Name starts with query: +500 points
 * - Name contains query: +300 points
 * - All terms in path: +200 points
 * - Shorter hierarchy path: +100 points (countries rank higher than cities)
 * - Shorter names: +0-100 points
 * - Trigram similarity (fuzzy fallback only): +0-400 points
 */
export async function searchDivisions(req: Request, res: Response): Promise<void> {
  const inputQuery = String(req.query.query ?? '').trim();
  const limit = parseInt(String(req.query.limit ?? '50'));

  if (inputQuery.length < 2) {
    res.json([]);
    return;
  }

  // Split into terms for multi-word search
  const queryTerms = inputQuery.split(/\s+/).filter(t => t.length > 0);

  // Build parameters: $1 = full query, $2, $3, ... = %term% patterns
  const params: string[] = [inputQuery];
  const nameMatchClauses: string[] = [];
  const nameMatchClausesUnaccent: string[] = [];
  const pathMatchClauses: string[] = [];
  const pathMatchClausesUnaccent: string[] = [];

  queryTerms.forEach((term, i) => {
    const paramIndex = i + 2; // $2, $3, $4...
    params.push(`%${term}%`);
    nameMatchClauses.push(`name ILIKE $${paramIndex}`);
    nameMatchClausesUnaccent.push(`unaccent(name) ILIKE unaccent($${paramIndex})`);
    pathMatchClauses.push(`path ILIKE $${paramIndex}`);
    pathMatchClausesUnaccent.push(`unaccent(path) ILIKE unaccent($${paramIndex})`);
  });

  // Helper function to build and execute search query
  const executeSearch = async (mode: 'regular' | 'unaccent' | 'fuzzy') => {
    let matchCondition: string;
    let filterCondition: string;
    let fuzzyScoring: string;

    if (mode === 'regular') {
      matchCondition = `(${nameMatchClauses.join(' OR ')})`;
      filterCondition = `(${pathMatchClauses.join(' AND ')})`;
      fuzzyScoring = '0';
    } else if (mode === 'unaccent') {
      matchCondition = `(${nameMatchClausesUnaccent.join(' OR ')})`;
      filterCondition = `(${pathMatchClausesUnaccent.join(' AND ')})`;
      fuzzyScoring = '0';
    } else {
      // fuzzy mode
      matchCondition = `similarity(unaccent(name), unaccent($1)) > 0.3`;
      filterCondition = `similarity(unaccent(name), unaccent($1)) > 0.3`;
      fuzzyScoring = `(similarity(unaccent(name), unaccent($1)) * 400)::int`;
    }

    const query = `
      WITH RECURSIVE path_cte AS (
        SELECT
          id, name, parent_id, has_children,
          name::text AS path,
          id AS target_id,
          1 AS depth
        FROM administrative_divisions
        WHERE ${matchCondition}

        UNION ALL

        SELECT
          p.id, p.name, p.parent_id, p.has_children,
          p.name || ' > ' || c.path,
          c.target_id,
          c.depth + 1
        FROM administrative_divisions p
        JOIN path_cte c ON p.id = c.parent_id
      ),
      full_paths AS (
        SELECT
          target_id,
          path,
          depth,
          (SELECT name FROM administrative_divisions WHERE id = target_id) as name,
          (SELECT parent_id FROM administrative_divisions WHERE id = target_id) as parent_id,
          (SELECT has_children FROM administrative_divisions WHERE id = target_id) as has_children
        FROM path_cte
        WHERE parent_id IS NULL
      ),
      scored AS (
        SELECT
          target_id,
          path,
          depth,
          name,
          parent_id,
          has_children,
          (
            -- Exact name match (case insensitive, accent insensitive): +1000
            CASE WHEN LOWER(unaccent(name)) = LOWER(unaccent($1)) THEN 1000 ELSE 0 END
            +
            -- Name starts with query: +500
            CASE WHEN unaccent(name) ILIKE unaccent($1) || '%' THEN 500 ELSE 0 END
            +
            -- Trigram similarity score (only for fuzzy search): +0-400
            ${fuzzyScoring}
            +
            -- Exact match in path: +300
            CASE WHEN unaccent(path) ILIKE '%' || unaccent($1) || '%' THEN 300 ELSE 0 END
            +
            -- Name contains query: +200
            CASE WHEN unaccent(name) ILIKE '%' || unaccent($1) || '%' THEN 200 ELSE 0 END
            +
            -- All terms match in path: +100
            CASE WHEN ${pathMatchClausesUnaccent.join(' AND ')} THEN 100 ELSE 0 END
            +
            -- Shorter hierarchy paths rank higher (countries before cities): +100 - depth*10
            CASE WHEN depth <= 10 THEN (10 - depth) * 10 ELSE 0 END
            +
            -- Shorter names are more relevant: +0-50
            CASE WHEN LENGTH(name) < 20 THEN (20 - LENGTH(name)) * 2 ELSE 0 END
          ) as relevance_score
        FROM full_paths
        WHERE ${filterCondition}
      )
      SELECT DISTINCT ON (target_id)
        target_id as id,
        name,
        parent_id,
        has_children,
        path,
        relevance_score
      FROM scored
      ORDER BY target_id, relevance_score DESC
    `;

    return pool.query(query, params);
  };

  // Use accent-insensitive search as default (unaccent is a no-op on ASCII,
  // so this is a strict superset of regular ILIKE with no downside)
  let result = await executeSearch('unaccent');

  // If still no results, try fuzzy search (catches typos)
  if (result.rows.length === 0) {
    result = await executeSearch('fuzzy');
  }

  // Sort by relevance and limit
  const sorted = result.rows
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);

  // Get worldViewId for usage counting (optional)
  const worldViewId = parseInt(String(req.query.worldViewId ?? req.query.hierarchyId ?? '0'));

  // If worldViewId is provided and valid, fetch usage counts for these divisions
  const usageCounts: Record<number, number> = {};
  const usedAsSubdivisionCount: Record<number, number> = {};
  const hasUsedSubdivisions: Record<number, boolean> = {};

  if (worldViewId > 0 && sorted.length > 0) {
    const divisionIds = sorted.map(d => d.id);

    // Get direct usage counts
    const usageResult = await pool.query(`
      SELECT
        rm.division_id,
        COUNT(DISTINCT rm.region_id) as usage_count
      FROM region_members rm
      JOIN regions r ON rm.region_id = r.id
      WHERE r.world_view_id = $1
        AND rm.division_id = ANY($2::int[])
      GROUP BY rm.division_id
    `, [worldViewId, divisionIds]);

    for (const row of usageResult.rows) {
      usageCounts[row.division_id] = parseInt(row.usage_count);
    }

    // Check if this division is a descendant of any division that's included in a region
    // (i.e., used as a subdivision of another included division)
    const usedAsSubdivisionResult = await pool.query(`
      WITH RECURSIVE ancestors AS (
        -- Start with the searched divisions
        SELECT id, parent_id, id as original_id
        FROM administrative_divisions
        WHERE id = ANY($2::int[])

        UNION ALL

        -- Recursively get all ancestors (go up the tree)
        SELECT parent.id, parent.parent_id, a.original_id
        FROM administrative_divisions parent
        JOIN ancestors a ON parent.id = a.parent_id
        WHERE a.parent_id IS NOT NULL
      )
      SELECT
        a.original_id as division_id,
        COUNT(DISTINCT rm.region_id) as ancestor_usage_count
      FROM ancestors a
      JOIN region_members rm ON rm.division_id = a.id
      JOIN regions r ON rm.region_id = r.id
      WHERE r.world_view_id = $1
        AND a.id != a.original_id  -- Exclude self (direct usage is counted separately)
      GROUP BY a.original_id
    `, [worldViewId, divisionIds]);

    for (const row of usedAsSubdivisionResult.rows) {
      usedAsSubdivisionCount[row.division_id] = parseInt(row.ancestor_usage_count);
    }

    // Check if any subdivisions (at any level) are used
    const subdivisionUsageResult = await pool.query(`
      WITH RECURSIVE all_subdivisions AS (
        -- Direct children of the searched divisions
        SELECT id, parent_id
        FROM administrative_divisions
        WHERE parent_id = ANY($2::int[])

        UNION ALL

        -- Recursively get all descendants
        SELECT ad.id, ad.parent_id
        FROM administrative_divisions ad
        JOIN all_subdivisions s ON ad.parent_id = s.id
      )
      SELECT DISTINCT
        -- Find the root parent from our search results
        (
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM administrative_divisions WHERE id = sub.id
            UNION ALL
            SELECT ad.id, ad.parent_id
            FROM administrative_divisions ad
            JOIN ancestors a ON ad.id = a.parent_id
          )
          SELECT id FROM ancestors WHERE id = ANY($2::int[]) LIMIT 1
        ) as root_division_id
      FROM all_subdivisions sub
      WHERE EXISTS (
        SELECT 1 FROM region_members rm
        JOIN regions r ON rm.region_id = r.id
        WHERE r.world_view_id = $1 AND rm.division_id = sub.id
      )
    `, [worldViewId, divisionIds]);

    for (const row of subdivisionUsageResult.rows) {
      if (row.root_division_id) {
        hasUsedSubdivisions[row.root_division_id] = true;
      }
    }
  }

  const divisionList: AdministrativeDivisionWithPath[] = sorted.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    hasChildren: d.has_children,
    path: d.path,
    usageCount: usageCounts[d.id] || 0,
    usedAsSubdivisionCount: usedAsSubdivisionCount[d.id] || 0,
    hasUsedSubdivisions: hasUsedSubdivisions[d.id] || false,
  }));

  res.json(divisionList);
}

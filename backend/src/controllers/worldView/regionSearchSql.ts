/**
 * The one statement of how a region is found by name (#1920): what
 * `searchRegions` has matched with since the region search landed, with the
 * scope it searches in handed in rather than spelled twice. Two callers: the
 * world view's own search (`regionCrud.ts`, one world view) and the review
 * feed's Region chip (`reviewRegionSearchController.ts`, every public world
 * view at once).
 *
 * Three passes, each tried only if the one before found nothing: the names as
 * typed (`regular`), with accents dropped on both sides (`unaccent`), then by
 * trigram similarity (`fuzzy`). Every match carries its path from the root
 * ("Europe > Germany > Berlin"), which the scoring reads and the callers show.
 */

import type { Pool } from 'pg';

export type RegionSearchMode = 'regular' | 'unaccent' | 'fuzzy';

/** Where the search looks: a predicate over `regions r` (and `world_views w`, joined), and what it binds. */
export interface RegionSearchScope {
  /** A SQL predicate; `$1` is the query text, scope params follow it from `$2`. */
  predicate: string;
  params: readonly unknown[];
  /** Columns a caller wants beside the row's own, read off `r` or `w`. */
  extraColumns?: string;
}

/** A matching region as the three passes return it, before a caller's mapping. */
export interface RegionSearchRowBase {
  id: number;
  name: string;
  parent_region_id: number | null;
  description: string | null;
  color: string | null;
  uses_hull: boolean | null;
  focus_bbox: unknown;
  anchor_point: unknown;
  has_subregions: boolean;
  path: string;
  relevance_score: number;
}

/**
 * Run the passes for `inputQuery` within `scope`, best match first, at most
 * `limit`. The query is trimmed by the caller; two characters is the floor
 * the route's schema holds it to.
 */
export async function runRegionSearch<Row extends RegionSearchRowBase>(
  pool: Pick<Pool, 'query'>,
  inputQuery: string,
  scope: RegionSearchScope,
  limit: number,
): Promise<Row[]> {
  const queryTerms = inputQuery.split(/\s+/).filter(t => t.length > 0);
  const params: unknown[] = [inputQuery, ...scope.params];
  const nameMatchClauses: string[] = [];
  const nameMatchClausesUnaccent: string[] = [];
  const pathMatchClausesUnaccent: string[] = [];

  queryTerms.forEach((term) => {
    params.push(`%${term}%`);
    const at = `$${params.length}`;
    nameMatchClauses.push(`r.name ILIKE ${at}`);
    nameMatchClausesUnaccent.push(`unaccent(r.name) ILIKE unaccent(${at})`);
    pathMatchClausesUnaccent.push(`unaccent(path) ILIKE unaccent(${at})`);
  });

  const executeSearch = async (mode: RegionSearchMode) => {
    let matchCondition: string;
    let fuzzyScoring: string;

    if (mode === 'regular') {
      matchCondition = `(${nameMatchClauses.join(' OR ')})`;
      fuzzyScoring = '0';
    } else if (mode === 'unaccent') {
      matchCondition = `(${nameMatchClausesUnaccent.join(' OR ')})`;
      fuzzyScoring = '0';
    } else {
      matchCondition = `similarity(unaccent(r.name), unaccent($1)) > 0.3`;
      fuzzyScoring = `(similarity(unaccent(r.name), unaccent($1)) * 400)::int`;
    }

    const query = `
      WITH RECURSIVE path_cte AS (
        SELECT
          r.id, r.name, r.parent_region_id,
          r.name::text AS path,
          r.id AS target_id,
          1 AS depth
        FROM regions r
        JOIN world_views w ON w.id = r.world_view_id
        WHERE ${scope.predicate} AND ${matchCondition}

        UNION ALL

        SELECT
          p.id, p.name, p.parent_region_id,
          p.name || ' > ' || c.path,
          c.target_id,
          c.depth + 1
        FROM regions p
        JOIN path_cte c ON p.id = c.parent_region_id
      ),
      full_paths AS (
        SELECT
          target_id,
          path,
          depth
        FROM path_cte
        WHERE parent_region_id IS NULL
      ),
      scored AS (
        SELECT
          fp.target_id,
          fp.path,
          fp.depth,
          r.name,
          r.parent_region_id,
          r.description,
          r.color,
          r.uses_hull,
          r.focus_bbox,
          r.anchor_point,
          r.world_view_id,
          (
            CASE WHEN LOWER(unaccent(r.name)) = LOWER(unaccent($1)) THEN 1000 ELSE 0 END
            + CASE WHEN unaccent(r.name) ILIKE unaccent($1) || '%' THEN 500 ELSE 0 END
            + ${fuzzyScoring}
            + CASE WHEN unaccent(fp.path) ILIKE '%' || unaccent($1) || '%' THEN 300 ELSE 0 END
            + CASE WHEN unaccent(r.name) ILIKE '%' || unaccent($1) || '%' THEN 200 ELSE 0 END
            + CASE WHEN ${pathMatchClausesUnaccent.join(' AND ')} THEN 100 ELSE 0 END
            + CASE WHEN fp.depth <= 10 THEN (10 - fp.depth) * 10 ELSE 0 END
            + CASE WHEN LENGTH(r.name) < 20 THEN (20 - LENGTH(r.name)) * 2 ELSE 0 END
          ) as relevance_score
        FROM full_paths fp
        JOIN regions r ON r.id = fp.target_id
      )
      SELECT DISTINCT ON (target_id)
        target_id as id,
        name,
        parent_region_id,
        description,
        color,
        uses_hull,
        CASE WHEN focus_bbox IS NOT NULL
          THEN json_build_array(focus_bbox[1], focus_bbox[2], focus_bbox[3], focus_bbox[4])
        END as focus_bbox,
        CASE WHEN anchor_point IS NOT NULL
          THEN json_build_array(ST_X(anchor_point), ST_Y(anchor_point))
        END as anchor_point,
        EXISTS (SELECT 1 FROM regions WHERE parent_region_id = target_id) as has_subregions,
        path,
        relevance_score${scope.extraColumns ? `,\n        ${scope.extraColumns}` : ''}
      FROM scored
      ORDER BY target_id, relevance_score DESC
    `;

    return pool.query<Row>(query, params);
  };

  let result = await executeSearch('regular');
  if (result.rows.length === 0) {
    result = await executeSearch('unaccent');
  }
  if (result.rows.length === 0) {
    result = await executeSearch('fuzzy');
  }

  return result.rows
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
}

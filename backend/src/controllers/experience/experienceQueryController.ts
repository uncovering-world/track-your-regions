/**
 * Experience Query Controller
 *
 * Public browsing endpoints: list, get, search, region counts, categories.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import {
  hideLostSql, hideRefusedSql, hidePendingSql, lifecycleSelectSql, includeLost,
  offeredLocationSql, publishedContentSql, readerPositionSql,
} from './experienceLifecycle.js';
import { buildRegionQueries } from './experienceRegionQuery.js';
import { maySeeUnreadExperience } from './experienceScope.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

interface ListExperiencesFilters {
  conditions: string[];
  params: (string | number)[];
}

function buildExperiencesFilters(query: Request['query']): ListExperiencesFilters {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  // Unconditional unless asked: a caller that forgets a filter should get less
  // than it wanted, never a demolished building offered as somewhere to go.
  if (!includeLost(query)) conditions.push(hideLostSql());
  // Unconditional full stop: `includeLost` is a reader asking to see what is
  // gone, and a row the category's own rule turned down was never theirs to
  // miss (ADR-0024).
  conditions.push(hideRefusedSql());
  // Unconditional, and with no toggle at all: unlike `includeLost`, there is
  // no "show me the unread ones too" affordance for a list. The only
  // relaxation `curation_state` gets is on the three by-id reads (ADR-0025).
  conditions.push(hidePendingSql());

  if (query.categoryId) {
    conditions.push(`e.category_id = $${paramIndex++}`);
    params.push(parseInt(String(query.categoryId)));
  }
  if (query.category) {
    conditions.push(`e.category = $${paramIndex++}`);
    params.push(String(query.category));
  }
  if (query.regionId) {
    conditions.push(`e.id IN (
      SELECT er.experience_id FROM experience_regions er
      WHERE er.region_id = $${paramIndex++}
    )`);
    params.push(parseInt(String(query.regionId)));
  }
  if (query.country) {
    conditions.push(`$${paramIndex++} = ANY(e.country_codes)`);
    params.push(String(query.country).toUpperCase());
  }
  if (query.search) {
    conditions.push(`e.name ILIKE $${paramIndex++}`);
    params.push(`%${String(query.search)}%`);
  }
  if (query.bbox) {
    const [west, south, east, north] = String(query.bbox).split(',').map(Number);
    if ([west, south, east, north].every(n => !isNaN(n))) {
      // A box asks where an object is, and this catalogue answers that with
      // places: region membership is derived from `experience_location_regions`
      // rather than from the object's own coordinate, and ADR-0028 says the same
      // of a pin. So the box matches a place this caller may see, and falls back
      // to the object's own coordinate only where no such place exists -- which
      // is `readerPositionSql`'s COALESCE asked as a filter instead of a column.
      //
      // Matching the anchor was the contradiction: 222 objects have one that is
      // not any of their places, so a box around 144.97,-15.65 matched Wet
      // Tropics of Queensland and answered with a pin 191 km away at Lake
      // Barrin, while a box drawn around Lake Barrin -- the part a reader is
      // actually shown -- did not match it at all.
      //
      // What one coordinate per row still cannot say: a serial site matched on a
      // part inside the box is answered with the part nearest its anchor, which
      // can be outside it -- four of the 47 objects an Alps-sized box holds, the
      // starkest being the Ancient and Primeval Beech Forests, matched on a part
      // in the Alps and answered at 22.19, 48.92 in the Carpathians. Drawing
      // every part is #558's question, not a filter's.
      const [w, s, e, n] = [paramIndex++, paramIndex++, paramIndex++, paramIndex++];
      // `west > east` is a box drawn across the antimeridian, the convention
      // `focus_bbox` already uses (CLAUDE.md § Antimeridian Handling). One
      // envelope cannot hold it: `ST_MakeEnvelope(170, -10, -170, 10)` does not
      // fail, it silently normalises to xmin -170 / xmax 170 — the whole planet
      // *except* the strip asked for. Measured on the catalogue: that box matches
      // 290 places between 10°S and 10°N where one is truly in it. So the two
      // halves are drawn as two envelopes, meeting at the line.
      const envelopes = west > east
        ? [`ST_MakeEnvelope($${w}, $${s}, 180, $${n}, 4326)`,
          `ST_MakeEnvelope(-180, $${s}, $${e}, $${n}, 4326)`]
        : [`ST_MakeEnvelope($${w}, $${s}, $${e}, $${n}, 4326)`];
      const inBox = (column: string) =>
        envelopes.map(envelope => `ST_Intersects(${column}, ${envelope})`).join(' OR ');
      const visiblePlaces = `SELECT 1 FROM experience_locations el
        WHERE el.experience_id = e.id
          AND ${offeredLocationSql()} AND ${publishedContentSql('el')}`;
      conditions.push(`(EXISTS (${visiblePlaces} AND (${inBox('el.location')}))
        OR (NOT EXISTS (${visiblePlaces}) AND (${inBox('e.location')})))`);
      params.push(west, south, east, north);
    }
  }
  return { conditions, params };
}

/**
 * List experiences with filtering and pagination
 * GET /api/experiences
 *
 * Query params:
 * - sourceId: Filter by source
 * - category: Filter by category (cultural, natural, mixed)
 * - regionId: Filter by region
 * - search: Search by name
 * - limit: Max results (default 50, max 5000)
 * - offset: Pagination offset
 * - bbox: Bounding box filter "west,south,east,north"
 */
export async function listExperiences(req: Request, res: Response): Promise<void> {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 5000);
  const offset = parseInt(String(req.query.offset)) || 0;
  const { conditions, params } = buildExperiencesFilters(req.query);
  const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const query = `
    SELECT
      e.id,
      e.external_id,
      e.name,
      e.short_description,
      e.category,
      e.country_codes,
      e.country_names,
      e.image_url,
      e.metadata->>'dateInscribed' as date_inscribed,
      e.metadata->>'inDanger' as in_danger,
      ${readerPositionSql('e')},
      s.name as category_name,
      s.display_priority as category_priority
    FROM experiences e
    JOIN experience_categories s ON e.category_id = s.id
    ${whereClause}
    ORDER BY e.name LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(query, [...params, limit, offset]);

  const countQuery = `SELECT COUNT(*) FROM experiences e JOIN experience_categories s ON e.category_id = s.id${whereClause}`;
  const countResult = await pool.query(countQuery, params);

  res.json({
    experiences: result.rows.map(row => ({
      ...row,
      in_danger: row.in_danger === 'true',
    })),
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

/**
 * Get single experience by ID
 * GET /api/experiences/:id
 *
 * optionalAuth: two different things can 404 the row itself now — a refused
 * admission (ADR-0024) and an unread `pending` row a caller's scope does not
 * reach (ADR-0025, relaxed by `maySeeUnreadExperience` below) — before this
 * row/no-row question is even reached, its region/world-view assignments are
 * filtered by visibility separately — admins see every assignment, everyone
 * else only assignments whose world view is both active and public. The
 * predicate matches `getWorldViews` (worldViewCrud.ts) exactly so the two
 * cannot drift apart.
 */
export async function getExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseInt(String(req.params.id));
  const isAdmin = req.user?.role === 'admin';
  // Resolved before the row is fetched, because it has to be a parameter
  // inside that query's WHERE — see `maySeeUnreadExperience` for why this is
  // the one place the pending gate opens (ADR-0025).
  const maySeeUnread = await maySeeUnreadExperience(req.user?.id, req.user?.role, id);

  const result = await pool.query(`
    SELECT
      e.id,
      e.category_id,
      e.external_id,
      e.name,
      e.name_local,
      e.description,
      e.short_description,
      e.category,
      e.tags,
      e.country_codes,
      e.country_names,
      e.image_url,
      e.metadata,
      e.created_at,
      e.updated_at,
      ${lifecycleSelectSql()},
      ${readerPositionSql('e', '$2')},
      ST_AsGeoJSON(e.boundary)::json as boundary_geojson,
      e.area_km2,
      s.name as category_name,
      s.description as category_description
    FROM experiences e
    JOIN experience_categories s ON e.category_id = s.id
    WHERE e.id = $1
      -- A by-id read does not offer a *set* to go through, which is what the
      -- lost predicate protects, but it does still offer somewhere to go
      -- (ADR-0024) — so a refused row answers 404 rather than handing back a card
      -- for something this category has turned down. An object judged lost is
      -- deliberately not filtered here and never was: that gap predates this
      -- axis, and closing it would be a separate decision about a different
      -- question.
      AND ${hideRefusedSql()}
      -- Unread stays hidden for everyone except a curator or admin whose scope
      -- reaches this experience (ADR-0025) -- the one relaxation this predicate
      -- gets. $2 is read twice: here, and by the position rule in the select
      -- list, so the places a curator is positioned by are the same rows this
      -- gate let them have.
      AND ($2::boolean OR ${hidePendingSql()})
  `, [id, maySeeUnread]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Get assigned regions, filtered to world views visible to this caller.
  const regionsResult = await pool.query(`
    SELECT r.id, r.name, r.world_view_id, wv.name as world_view_name
    FROM experience_regions er
    JOIN regions r ON er.region_id = r.id
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE er.experience_id = $1
      AND wv.is_active = true
      AND ($2::boolean OR wv.is_public = true)
    ORDER BY wv.name, r.name
  `, [id, isAdmin]);

  res.json({
    ...result.rows[0],
    regions: regionsResult.rows,
  });
}

/**
 * Get experiences by region
 * GET /api/experiences/by-region/:regionId
 *
 * Uses optionalAuth: curators see rejected items marked with is_rejected,
 * regular users have them filtered out entirely.
 */
export async function getExperiencesByRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const includeChildren = req.query.includeChildren !== 'false';
  // Ceiling raised to match `listExperiences` above. At 500 a region's list was
  // silently truncated rather than paginated: the ordering is `e.name`, so the
  // cut fell mid-alphabet and simply removed everything after it — 658 in Europe
  // meant no museum past "G", and the map builds its markers from this same
  // array, so those pins vanished too. Callers that want a page still get one by
  // passing `limit`; the default of 100 is unchanged.
  const limit = Math.min(parseInt(String(req.query.limit)) || 100, 5000);
  const offset = parseInt(String(req.query.offset)) || 0;

  // Determine if the user is a curator with scope for this region
  const userRole = req.user?.role;
  const userId = req.user?.id;
  const showRejected = userId && userRole && (userRole === 'curator' || userRole === 'admin')
    ? await import('../../middleware/auth.js').then(m => m.checkCuratorScope(userId, userRole, regionId))
    : false;

  const { query, countQuery, params } = buildRegionQueries({
    regionId, includeChildren, showRejected, includeLostRows: includeLost(req.query), limit, offset, userId,
  });

  const result = await pool.query(query, params);
  // Counted rather than measured. `total` used to be `result.rows.length` — the
  // size of the page, which equals the match count only while nothing is cut
  // off, and silently agrees with itself the moment something is, so a region
  // at the ceiling reported a confident, wrong total.
  //
  // Against a real count, `offset + experiences.length < total` says one thing:
  // rows remain beyond this window. What that means is the caller's to decide —
  // truncation for one that started at offset 0 and asked for the whole region,
  // which is both callers today, and plain `hasMore` for one that is paging.
  // The server cannot tell those apart, because the difference is intent rather
  // than response shape.
  const countResult = await pool.query(countQuery, [regionId]);

  // Get region info
  const regionResult = await pool.query(`
    SELECT r.id, r.name, wv.name as world_view_name
    FROM regions r
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE r.id = $1
  `, [regionId]);

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  res.json({
    region: regionResult.rows[0],
    experiences: result.rows.map(row => ({
      ...row,
      in_danger: row.in_danger === 'true',
    })),
    total: countResult.rows[0].total,
    // How many this region holds that no longer exist *and is not showing*.
    // Zero for almost every region, which is the point: the page offers the
    // "show them" affordance only where there is something behind it, rather
    // than a permanent control for a rare state. Zero also once they are being
    // shown — nothing is hidden then, and a field that still counted them
    // would have the page offering to reveal what is already on screen.
    lostHidden: includeLost(req.query) ? 0 : countResult.rows[0].lost_hidden,
    limit,
    offset,
  });
}

/**
 * List experience categories
 * GET /api/experiences/categories
 */
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const result = await pool.query(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.is_active,
      s.last_sync_at,
      s.last_sync_status,
      s.display_priority,
      -- The same predicates every list under this heading carries. Without them
      -- the API reported 128 art museums where the catalogue offers 101 — the
      -- 27 rows this category's own rule turned down (#503).
      --
      -- Unconditional rather than includeLost-aware: this number labels a
      -- category, not a page, and no caller passes that parameter here.
      (SELECT COUNT(*) FROM experiences e
        WHERE e.category_id = s.id
          AND ${hideLostSql()}
          AND ${hideRefusedSql()}
          AND ${hidePendingSql()}) as experience_count
    FROM experience_categories s
    WHERE s.is_active = true
    ORDER BY s.display_priority, s.name
  `);

  res.json(result.rows);
}

/**
 * Search experiences with full-text search
 * GET /api/experiences/search
 */
export async function searchExperiences(req: Request, res: Response): Promise<void> {
  const query = req.query.q ? String(req.query.q) : '';
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);

  if (!query || query.length < 2) {
    res.status(400).json({ error: 'Search query must be at least 2 characters' });
    return;
  }

  const result = await pool.query(`
    SELECT
      e.id,
      e.name,
      e.short_description,
      e.category,
      e.country_names,
      e.image_url,
      ${readerPositionSql('e')},
      similarity(e.name, $1) as relevance
    FROM experiences e
    -- The two name matches are alternatives to each other, not to the
    -- lifecycle filter: without the brackets, OR would re-admit every lost
    -- object whose name happens to match by trigram.
    WHERE (e.name ILIKE $2 OR e.name % $1)
      AND ${hideLostSql()}
      AND ${hideRefusedSql()}
      AND ${hidePendingSql()}
    ORDER BY
      CASE WHEN e.name ILIKE $2 THEN 0 ELSE 1 END,
      similarity(e.name, $1) DESC
    LIMIT $3
  `, [query, `%${query}%`, limit]);

  res.json({
    query,
    results: result.rows,
    total: result.rows.length,
  });
}

/**
 * Get experience counts per region per source for a world view
 * GET /api/experiences/region-counts
 *
 * Query params:
 * - worldViewId: Required. The world view to get counts for
 * - parentRegionId: Optional. If provided, returns counts for subregions only
 *
 * Returns an array of { region_id, region_name, has_subregions, category_counts: { [categoryId]: count } }
 * Only returns direct assignment counts (not recursive children).
 */
export async function getExperienceRegionCounts(req: Request, res: Response): Promise<void> {
  const worldViewId = req.query.worldViewId ? parseInt(String(req.query.worldViewId)) : null;
  const parentRegionId = req.query.parentRegionId ? parseInt(String(req.query.parentRegionId)) : null;

  if (!worldViewId) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  // Get counts broken down by source for regions at the requested level.
  // Rejected and lost are both excluded: these counts say how much there is to
  // go and see in a region, and neither is. A `lost` object someone already
  // visited is not lost to them — that lives in their visit history, which
  // does not filter, so the count shrinking cannot erase a visit.
  const result = await pool.query(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      r.color as region_color,
      EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
      e.category_id,
      COUNT(DISTINCT er.experience_id) as count
    FROM regions r
    JOIN experience_regions er ON r.id = er.region_id
    JOIN experiences e ON er.experience_id = e.id
    LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = r.id
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
      AND rej.id IS NULL
      AND ${hideLostSql()}
      AND ${hideRefusedSql()}
      AND ${hidePendingSql()}
    GROUP BY r.id, r.name, r.color, e.category_id
    ORDER BY r.name
  `, parentRegionId ? [worldViewId, parentRegionId] : [worldViewId]);

  // Also get regions with zero experiences at this level (for complete tree)
  const allRegionsResult = await pool.query(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      r.color as region_color,
      EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions
    FROM regions r
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
    ORDER BY r.name
  `, parentRegionId ? [worldViewId, parentRegionId] : [worldViewId]);

  // Aggregate into { regionId -> { categoryId -> count } }
  const countMap = new Map<number, Record<number, number>>();
  for (const row of result.rows) {
    const rid = row.region_id;
    if (!countMap.has(rid)) countMap.set(rid, {});
    countMap.get(rid)![row.category_id] = parseInt(row.count);
  }

  const response = allRegionsResult.rows.map(row => ({
    region_id: row.region_id,
    region_name: row.region_name,
    region_color: row.region_color,
    has_subregions: row.has_subregions,
    category_counts: countMap.get(row.region_id) || {},
  }));

  res.json(response);
}

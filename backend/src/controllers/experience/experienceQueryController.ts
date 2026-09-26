/**
 * Experience Query Controller
 *
 * Public browsing endpoints: get, search, region counts, kinds.
 */

import type { z } from 'zod/v4';
import type {
  ExperienceDetail, ExperienceKinds, ExperienceSearch, ExperiencesByRegionResponse, RegionExperienceCounts,
  ExperienceRegionRef,
} from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import type { ExperienceKindsRow } from '../../db/schema.generated.js';
import {
  hideLostSql,
  hideRefusedSql,
  hidePendingSql,
  lifecycleSelectSql,
  readerPositionSql,
  readerRegionMembershipSql,
} from '../../db/readerPredicates.js';
import { includeLost } from './includeLost.js';
import { KINDS, MEMBERSHIPS, rowKindJoinSql, rowKindSelectSql } from '../../db/membership.js';
import { countedMembershipSql, countedMembershipsSql, kindCountSql } from './experienceCounts.js';
import { buildRegionQueries } from './experienceRegionQuery.js';
import { maySeeUnreadExperience } from './experienceScope.js';
import { readerRegionsJsonSql } from './readerRegions.js';
import { withDangerFields } from './experienceDanger.js';
import {
  experienceDetailOf, experienceOf, searchResultOf, type ExperienceDetailRow, type ExperienceListRow, type SearchRow,
} from './experienceAnswerRows.js';
import { checkCuratorScope } from '../../middleware/auth.js';
import { notFound } from '../../middleware/errorHandler.js';
import type {
  experienceRegionCountsQuerySchema, experienceSearchQuerySchema, experiencesByRegionQuerySchema,
  idParamSchema, regionIdParamSchema,
} from '../../types/index.js';

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
export async function getExperience(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User | undefined },
): Promise<ExperienceDetail> {
  const isAdmin = caller?.role === 'admin';
  // Resolved before the row is fetched, because it has to be a parameter
  // inside that query's WHERE — see `maySeeUnreadExperience` for why this is
  // the one place the pending gate opens (ADR-0025).
  const maySeeUnread = await maySeeUnreadExperience(caller?.id, caller?.role, id);

  const result = await pool.query<ExperienceDetailRow>(`
    SELECT
      e.id,
      e.source_id,
      e.external_id,
      e.name,
      e.name_local,
      e.description,
      e.short_description,
      e.type,
      -- No tags: labels the import derives from facts the row already carries by
      -- name, rendered by nothing, and since #570 written past the curation gate
      -- -- which they can be only while no reader-facing read returns them.
      e.country_codes,
      e.country_names,
      e.image_url,
      e.metadata,
      e.created_at,
      e.updated_at,
      ${lifecycleSelectSql()},
      ${readerPositionSql('e', '$2')},
      -- Stored whole, cut on the way out. An OSM relation traced finely enough
      -- can carry tens of thousands of vertices, which is a megabyte of JSON
      -- for an outline drawn two pixels wide — so what the catalogue holds is
      -- what OpenStreetMap drew, and what a browser is asked to draw is what a
      -- browser can draw. 0.0002° is about 20 m at the equator: invisible at
      -- any zoom that shows a whole site, and PreserveTopology so the result is
      -- still a valid polygon rather than a self-crossing one.
      --
      -- The threshold is a count rather than a byte size because vertices are
      -- what cost the renderer, and it is asked of the stored geometry so a
      -- small extent is handed over untouched.
      --
      -- 5,000 is headroom rather than a measured ceiling. The largest outline
      -- the site door draws in the whole world-tier pool is the Nasca and Palpa
      -- protected zone, relation/2729059, at 1,764 vertices (counted on the dev
      -- database on 2026-09-14), so nothing the catalogue holds today reaches
      -- this arm at all. It is here for the relation somebody traces next year.
      ST_AsGeoJSON(CASE WHEN ST_NPoints(e.boundary) > 5000
                        THEN ST_SimplifyPreserveTopology(e.boundary, 0.0002)
                        ELSE e.boundary END)::json as boundary_geojson,
      e.area_km2,
      ${rowKindSelectSql()},
      -- The source that brought the row, beside the kind it is shown under:
      -- a curator's screen names both (#819).
      s.name as source_name,
      s.description as source_description
    FROM experiences e
    ${rowKindJoinSql('e')}
    JOIN experience_sources s ON e.source_id = s.id
    WHERE e.id = $1
      -- A by-id read does not offer a *set* to go through, which is what the
      -- lost predicate protects, but it does still offer somewhere to go
      -- (ADR-0024) — so a refused row answers 404 rather than handing back a card
      -- for something its kind has turned down. An object judged lost is
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

  if (result.rows.length === 0) throw notFound('Experience not found');

  // Get assigned regions, filtered to world views visible to this caller.
  const regionsResult = await pool.query<ExperienceRegionRef>(`
    SELECT r.id, r.name, r.world_view_id, wv.name as world_view_name
    FROM experience_regions er
    JOIN regions r ON er.region_id = r.id
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE er.experience_id = $1
      AND wv.is_active = true
      AND ($2::boolean OR wv.is_public = true)
      -- Named to a reader only where a point they may see put the object there
      -- (#521). This list is a claim a reader acts on — Discover's detail panel
      -- offers each region as somewhere to go — so it has to name the regions
      -- whose own lists will hold the object, not the ones the roll-up holds.
      -- Relaxed on the same boolean as the row itself, and for the ADR's own
      -- reason: a curator reading a queue item has to be shown where publishing
      -- will put it, which is the one thing an unrelaxed list could never say.
      AND ($3::boolean OR ${readerRegionMembershipSql('er.experience_id')})
    ORDER BY wv.name, r.name
  `, [id, isAdmin, maySeeUnread]);

  return experienceDetailOf(result.rows[0], regionsResult.rows);
}

/**
 * Get experiences by region
 * GET /api/experiences/by-region/:regionId
 *
 * Uses optionalAuth: curators see rejected items marked with is_rejected,
 * regular users have them filtered out entirely.
 */
export async function getExperiencesByRegion(
  { params: { regionId }, query: q, caller }: {
    params: z.output<typeof regionIdParamSchema>;
    query: z.output<typeof experiencesByRegionQuerySchema>;
    caller: Express.User | undefined;
  },
): Promise<ExperiencesByRegionResponse> {
  const includeChildren = q.includeChildren !== 'false';
  // The number the client asks for, up to the whole region
  // (`WHOLE_REGION_LIMIT`, the schema's ceiling): a region is read whole or
  // truncated mid-alphabet, never paged. The default is 100.
  const { limit, offset } = q;

  // Determine if the user is a curator with scope for this region
  const userRole = caller?.role;
  const userId = caller?.id;
  const showRejected = userId && userRole && (userRole === 'curator' || userRole === 'admin')
    ? await checkCuratorScope(userId, userRole, regionId)
    : false;

  const { query, countQuery, params } = buildRegionQueries({
    regionId, includeChildren, showRejected, includeLostRows: includeLost(q), limit, offset, userId,
  });

  const result = await pool.query(query, params);
  // Counted rather than measured: `result.rows.length` is the size of the
  // page, which equals the match count only while nothing is cut off and
  // silently agrees with itself the moment something is, so a region at the
  // ceiling would report a confident, wrong total.
  //
  // Against a real count, `offset + experiences.length < total` says one thing:
  // rows remain beyond this window. What that means is the caller's to decide —
  // truncation for one that started at offset 0 and asked for the whole region,
  // which is both callers today, and plain `hasMore` for one that is paging.
  // The server cannot tell those apart, because the difference is intent rather
  // than response shape.
  const countResult = await pool.query(countQuery, [regionId]);

  // Get region info
  const regionResult = await pool.query<{ id: number; name: string; world_view_name: string }>(`
    SELECT r.id, r.name, wv.name as world_view_name
    FROM regions r
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE r.id = $1
  `, [regionId]);

  if (regionResult.rows.length === 0) throw notFound('Region not found');

  const region = regionResult.rows[0];
  return {
    region: { id: region.id, name: region.name, world_view_name: region.world_view_name },
    // The driver's rows, read as the columns `buildRegionQueries` selects.
    experiences: result.rows.map(row => experienceOf(withDangerFields(row) as ExperienceListRow)),
    total: countResult.rows[0].total,
    // How many this region holds that no longer exist *and is not showing*.
    // Zero for almost every region, which is the point: the page offers the
    // "show them" affordance only where there is something behind it, rather
    // than a permanent control for a rare state. Zero also once they are being
    // shown — nothing is hidden then, and a field that still counted them
    // would have the page offering to reveal what is already on screen.
    lostHidden: includeLost(q) ? 0 : countResult.rows[0].lost_hidden,
    limit,
    offset,
  };
}

/**
 * List the kinds a traveller browses by (ADR-0045 decision 1; #819)
 * GET /api/experiences/kinds
 *
 * A kind is offered only while a source fills it (decision 2): one whose
 * every source an admin has switched off leaves the pills and the group
 * headers, the way the source row's own `is_active` took it off this list
 * when the two were one row.
 */
export async function listKinds(): Promise<ExperienceKinds> {
  const result = await pool.query<Pick<ExperienceKindsRow, 'id' | 'name' | 'display_priority'> & { experience_count: string }>(`
    SELECT
      k.id,
      k.name,
      k.display_priority,
      -- A kind's count is of memberships (ADR-0046 decision 8, #822): the
      -- memberships the kind offers, each once — the same three questions
      -- every list under this heading asks. Without them the API reported 128
      -- art museums where the catalogue offers 101 — the 27 rows the kind's
      -- own rule turned down (#503).
      --
      -- Unconditional rather than includeLost-aware: this number labels a
      -- kind, not a page, and no caller passes that parameter here.
      ${kindCountSql('k.id')} as experience_count
    FROM ${KINDS} k
    WHERE EXISTS (SELECT 1 FROM experience_sources s WHERE s.kind_id = k.id AND s.is_active = true)
    ORDER BY k.display_priority, k.name
  `);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    display_priority: row.display_priority,
    experience_count: row.experience_count,
  }));
}

/**
 * Search experiences with full-text search
 * GET /api/experiences/search
 *
 * Answers about the whole catalogue, and says of each answer where it can be
 * opened: `regions` carries the regions that name the object to a reader, in
 * every world view a visitor may see, most specific first. The visitor's search
 * (#592) opens a result at its region in the world view the reader is already
 * in and offers the rest without a link, rather than hiding them — a catalogue
 * that holds the Great Barrier Reef must not answer "no results" for it because
 * no region has claimed it yet (#469, #470).
 */
export async function searchExperiences(
  { query: { q: query, limit } }: { query: z.output<typeof experienceSearchQuerySchema> },
): Promise<ExperienceSearch> {
  const result = await pool.query<SearchRow>(`
    -- The match and its LIMIT first, the region context after it. A scalar
    -- subquery in the select list of the matching query would be carried
    -- through the sort, so the placement lookup would run for every row whose
    -- name matched rather than for the twenty that are returned.
    WITH matches AS (
      SELECT
        e.id,
        e.name,
        e.short_description,
        e.type,
        -- The kind, off the row's membership (#819). Its own aliases, since
        -- m outside is this CTE.
        ${rowKindSelectSql('em', 'ek')},
        e.country_names,
        e.image_url,
        -- Beside the picture here too. The curator's "search and assign" dialog
        -- draws each result's photograph at 40 px, and a small picture is still
        -- the picture being shown. The visitor's search draws none, so the
        -- field travels for the one caller that does.
        e.metadata->'imageCredit' as image_credit,
        ${lifecycleSelectSql('e')},
        ${readerPositionSql('e')},
        similarity(e.name, $1) as relevance,
        -- Named rather than repeated: the order is stated twice — once here,
        -- once outside, since a join does not carry a CTE's order — and two
        -- spellings of one rule are two things to keep in step.
        (e.name ILIKE $2) as name_contains
      FROM experiences e
      ${rowKindJoinSql('e', 'em', 'ek')}
      -- The two name matches are alternatives to each other, not to the
      -- lifecycle filter: without the brackets, OR would re-admit every lost
      -- object whose name happens to match by trigram.
      WHERE (e.name ILIKE $2 OR e.name % $1)
        AND ${hideLostSql()}
        AND ${hideRefusedSql()}
        AND ${hidePendingSql()}
      -- A name that contains the query outranks one the trigram index merely
      -- thought similar; name_contains is never null, so DESC puts those
      -- first exactly as the CASE it replaces did.
      ORDER BY name_contains DESC, relevance DESC
      LIMIT $3
    )
    SELECT
      m.id,
      m.name,
      m.short_description,
      m.type,
      m.kind_id,
      m.kind_name,
      m.kind_priority,
      m.country_names,
      m.image_url,
      m.image_credit,
      m.source_membership,
      m.existence,
      m.missing_since,
      m.longitude,
      m.latitude,
      m.relevance,
      -- Where this object can be opened. Published world views only: an
      -- unpublished one is not a place to send a reader, and this route carries
      -- no session, so "visible" can mean nothing else here. The list is the
      -- one every link from one card to another sends (readerRegions.ts).
      ${readerRegionsJsonSql('m.id')} as regions
    FROM matches m
    -- A join does not carry the CTE's order.
    ORDER BY m.name_contains DESC, m.relevance DESC
  `, [query, `%${query}%`, limit]);

  return {
    query,
    results: result.rows.map(searchResultOf),
    total: result.rows.length,
  };
}

/**
 * Get experience counts per region per kind for a world view
 * GET /api/experiences/region-counts
 *
 * Query params:
 * - worldViewId: Required. The world view to get counts for
 * - parentRegionId: Optional. If provided, returns counts for subregions only
 *
 * Returns an array of { region_id, region_name, has_subregions, kind_counts: { [kindId]: count } }
 * Only returns direct assignment counts (not recursive children).
 */
export async function getExperienceRegionCounts(
  { query: { worldViewId, parentRegionId } }: { query: z.output<typeof experienceRegionCountsQuerySchema> },
): Promise<RegionExperienceCounts> {
  // Get counts broken down by kind for regions at the requested level.
  // Rejected and lost are both excluded: these counts say how much there is to
  // go and see in a region, and neither is. A `lost` object someone already
  // visited is not lost to them — that lives in their visit history, which
  // does not filter, so the count shrinking cannot erase a visit.
  //
  // A kind's count is of memberships (ADR-0046 decision 8, #822): a place in
  // two kinds is in both lists and counts once in each. The membership's own
  // admission and gate are asked, the way the list under each header asks
  // them.
  const result = await pool.query<{ region_id: number; kind_id: number; count: string }>(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      r.color as region_color,
      EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
      m.kind_id,
      ${countedMembershipsSql('m')} as count
    FROM regions r
    JOIN experience_regions er ON r.id = er.region_id
    JOIN experiences e ON er.experience_id = e.id
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
    LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = r.id
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
      AND rej.id IS NULL
      AND ${countedMembershipSql('m', 'e')}
      -- Counted the way the region's own list counts them (#521): a number on
      -- the tree that includes an object placed here by a point nobody may see
      -- sends a reader into a region to find one fewer thing than the tree
      -- promised, or none at all.
      AND ${readerRegionMembershipSql()}
    GROUP BY r.id, r.name, r.color, m.kind_id
    ORDER BY r.name
  `, parentRegionId ? [worldViewId, parentRegionId] : [worldViewId]);

  // Also get regions with zero experiences at this level (for complete tree)
  const allRegionsResult = await pool.query<{
    region_id: number; region_name: string; region_color: string | null; has_subregions: boolean;
  }>(`
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

  // Aggregate into { regionId -> { kindId -> count } }
  const countMap = new Map<number, Record<number, number>>();
  for (const row of result.rows) {
    const rid = row.region_id;
    if (!countMap.has(rid)) countMap.set(rid, {});
    countMap.get(rid)![row.kind_id] = parseInt(row.count);
  }

  const response = allRegionsResult.rows.map(row => ({
    region_id: row.region_id,
    region_name: row.region_name,
    region_color: row.region_color,
    has_subregions: row.has_subregions,
    kind_counts: countMap.get(row.region_id) || {},
  }));

  return response;
}

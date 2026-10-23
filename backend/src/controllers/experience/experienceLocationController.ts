/**
 * Experience Location Controller
 *
 * Multi-location support and batch location fetching for experiences.
 */

import type { z } from 'zod/v4';
import {
  type ExperienceLocationsResponse,
  type RegionExperienceLocationsResponse,
  type ExperienceLocation,
  type ExperienceLocationWithState,
  type RegionExperienceLocation,
} from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { overPlacePoints, placePointsSql } from '../../db/placePoints.js';
import type { CheckValue, ExperienceLocationsRow, ExperiencesRow } from '../../db/schema.generated.js';
import {
  hideLostSql,
  experienceOfferedToReaderSql,
  readableByIdSql,
  offeredLocationSql,
  publishedContentSql,
  readerRegionMembershipSql,
} from '../../db/readerPredicates.js';
import { includeLost } from './includeLost.js';
import { maySeeUnreadExperience } from './experienceScope.js';
import { notFound } from '../../middleware/errorHandler.js';
import type {
  experienceLocationsQuerySchema, idParamSchema, regionIdParamSchema, regionLocationsQuerySchema,
} from '../../types/index.js';

/**
 * A point as both location reads select it.
 *
 * `pg` hands over float8 as a number and a timestamp as a `Date`. The claims
 * column is JSONB, which the generated row types leave `unknown`: it is an array
 * of column names by its NOT NULL default and by every writer.
 */
type LocationRow = Pick<ExperienceLocationsRow, 'id' | 'experience_id' | 'name' | 'external_ref' | 'ordinal' | 'created_at' | 'image_url'> & {
  approximate: ExperienceLocation['approximate'];
  image_credit: ExperienceLocation['image_credit'];
  longitude: number;
  latitude: number;
  in_region: boolean;
  curated_fields: string[];
};

/**
 * The keys both reads send, from a row either one selects.
 *
 * Mapped key by key rather than passed through. A column a SELECT gains is not
 * a key the response gains until this function names it, and the schema has to
 * name it too.
 */
function locationOf(row: LocationRow): ExperienceLocation {
  return {
    id: row.id,
    experience_id: row.experience_id,
    name: row.name,
    external_ref: row.external_ref,
    ordinal: row.ordinal,
    longitude: row.longitude,
    latitude: row.latitude,
    approximate: row.approximate ?? null,
    created_at: row.created_at?.toISOString() ?? null,
    curated_fields: row.curated_fields,
    in_region: row.in_region,
    image_url: row.image_url,
    image_credit: row.image_credit ?? null,
  };
}

// =============================================================================
// Batch Location Fetching (eliminates N+1 for experience lists/markers)
// =============================================================================

/**
 * Get all locations for all experiences in a region (batch)
 * GET /api/experiences/by-region/:regionId/locations
 *
 * Single query returning all locations grouped by experience_id.
 * Used by ExperienceMarkers and ExperienceList to avoid N+1 calls.
 */
export async function getRegionExperienceLocations(
  { params: { regionId }, query: q }: {
    params: z.output<typeof regionIdParamSchema>;
    query: z.output<typeof regionLocationsQuerySchema>;
  },
): Promise<RegionExperienceLocationsResponse> {
  const includeChildren = q.includeChildren !== 'false';

  // Follows the list. These are the markers for exactly the rows the list is
  // showing, so a reader who asked to see what no longer exists would
  // otherwise get the rows without their locations — no pins, and a
  // "0 locations" count on every one of them.
  //
  // The unread half has no toggle: the map feed is a set, like the list it
  // follows, and the curator relaxation (ADR-0025) stops at the three by-id
  // reads so the two never disagree on what is being shown. One question of
  // the memberships, as the list asks it (`experienceOfferedToReaderSql`, #1275).
  const lifecycleFilter = `AND ${experienceOfferedToReaderSql()} `
    + (includeLost(q) ? '' : `AND ${hideLostSql()}`);

  let query: string;
  const params: number[] = [regionId];

  if (includeChildren) {
    query = `
      WITH RECURSIVE descendant_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendant_regions dr ON r.parent_region_id = dr.id
      ),
      -- The places the region lists, asked once for both arms of the points
      -- (ADR-0100) rather than once per arm. The same membership the list
      -- uses (#521): this batch answers for the rows the list is showing, so
      -- the two ask the question the same way or the feed starts carrying an
      -- object the list dropped.
      region_places AS MATERIALIZED (
        SELECT DISTINCT er.experience_id FROM experience_regions er
        WHERE er.region_id IN (SELECT id FROM descendant_regions)
          AND ${readerRegionMembershipSql('er.experience_id')}
      )
      ${overPlacePoints(({ from, placeId }) => `
      SELECT
        el.id,
        ${placeId} AS experience_id,
        el.name,
        el.external_ref,
        el.ordinal,
        el.approximate,
        ST_X(el.location) as longitude,
        ST_Y(el.location) as latitude,
        el.created_at,
        el.curated_fields,
        el.image_url,
        el.metadata -> 'imageCredit' AS image_credit,
        EXISTS(
          SELECT 1 FROM experience_location_regions elr
          WHERE elr.location_id = el.id AND elr.region_id IN (SELECT id FROM descendant_regions)
        ) as in_region,
        leaf_r.region_path
      FROM ${from}
      LEFT JOIN LATERAL (
        WITH RECURSIVE
        leaf AS (
          SELECT r.id, r.name, r.parent_region_id
          FROM experience_location_regions elr
          JOIN regions r ON elr.region_id = r.id
          WHERE elr.location_id = el.id
            AND r.is_leaf = true
            AND r.world_view_id = (SELECT world_view_id FROM regions WHERE id = $1)
          LIMIT 1
        ),
        ancestors AS (
          SELECT id, name, parent_region_id, 0 as depth FROM leaf
          UNION ALL
          SELECT r.id, r.name, r.parent_region_id, a.depth + 1
          FROM regions r
          JOIN ancestors a ON r.id = a.parent_region_id
        )
        SELECT string_agg(name, ' > ' ORDER BY depth DESC) as region_path
        FROM ancestors
      ) leaf_r ON true
      WHERE e.id IN (SELECT experience_id FROM region_places)
        AND ${offeredLocationSql()}
        AND ${publishedContentSql('el')}
        ${lifecycleFilter}
      `)}
      ORDER BY experience_id, ordinal, id
    `;
  } else {
    query = `
      -- As on the other branch: the places the region lists, asked once.
      WITH region_places AS MATERIALIZED (
        SELECT er.experience_id FROM experience_regions er
        WHERE er.region_id = $1
          AND ${readerRegionMembershipSql('er.experience_id')}
      )
      ${overPlacePoints(({ from, placeId }) => `
      SELECT
        el.id,
        ${placeId} AS experience_id,
        el.name,
        el.external_ref,
        el.ordinal,
        el.approximate,
        ST_X(el.location) as longitude,
        ST_Y(el.location) as latitude,
        el.created_at,
        el.curated_fields,
        el.image_url,
        el.metadata -> 'imageCredit' AS image_credit,
        EXISTS(
          SELECT 1 FROM experience_location_regions elr
          WHERE elr.location_id = el.id AND elr.region_id = $1
        ) as in_region,
        leaf_r.region_path
      FROM ${from}
      LEFT JOIN LATERAL (
        WITH RECURSIVE
        leaf AS (
          SELECT r.id, r.name, r.parent_region_id
          FROM experience_location_regions elr
          JOIN regions r ON elr.region_id = r.id
          WHERE elr.location_id = el.id
            AND r.is_leaf = true
            AND r.world_view_id = (SELECT world_view_id FROM regions WHERE id = $1)
          LIMIT 1
        ),
        ancestors AS (
          SELECT id, name, parent_region_id, 0 as depth FROM leaf
          UNION ALL
          SELECT r.id, r.name, r.parent_region_id, a.depth + 1
          FROM regions r
          JOIN ancestors a ON r.id = a.parent_region_id
        )
        SELECT string_agg(name, ' > ' ORDER BY depth DESC) as region_path
        FROM ancestors
      ) leaf_r ON true
      WHERE e.id IN (SELECT experience_id FROM region_places)
        AND ${offeredLocationSql()}
        AND ${publishedContentSql('el')}
        ${lifecycleFilter}
      `)}
      ORDER BY experience_id, ordinal, id
    `;
  }

  const result = await pool.query<LocationRow & { region_path: string | null }>(query, params);

  // Keyed by the object id, which JSON carries as a string key.
  const locationsByExperience: Record<string, RegionExperienceLocation[]> = {};
  for (const row of result.rows) {
    const points = locationsByExperience[row.experience_id] ?? [];
    points.push({ ...locationOf(row), region_path: row.region_path });
    locationsByExperience[row.experience_id] = points;
  }

  return { locationsByExperience };
}

// =============================================================================
// Multi-Location Support
// =============================================================================

/**
 * Get locations for an experience
 * GET /api/experiences/:id/locations
 * Query params:
 *   - regionId: Filter to show which locations are in this region
 */
export async function getExperienceLocations(
  { params: { id: experienceId }, query, caller }: {
    params: z.output<typeof idParamSchema>;
    query: z.output<typeof experienceLocationsQuerySchema>;
    caller: Express.User | undefined;
  },
): Promise<ExperienceLocationsResponse> {
  const regionId = query.regionId ?? null;
  // Resolved once, ahead of both queries below, and reused by both: the
  // existence gate needs it to decide 404 vs. 200, and the list needs it so a
  // curator who was let through the gate is not then handed an empty list of
  // its (also pending) locations. See `maySeeUnreadExperience` (ADR-0025).
  const maySeeUnread = await maySeeUnreadExperience(caller?.id, caller?.role, experienceId);

  // Verify the experience exists *and* is one this catalogue still offers.
  //
  // Without the second half this read answered 200 with a refused museum's name
  // and coordinates while `GET /:id` answered 404 for the same row — measured
  // live on the British Museum (id 6205). `existence` is deliberately not
  // filtered, matching `getExperience`: that gap predates the admission axis and
  // closing it is a separate decision about a different question.
  const expResult = await pool.query<Pick<ExperiencesRow, 'id' | 'name'>>(
    `SELECT e.id, e.name FROM experiences e
     WHERE e.id = $1 AND ${readableByIdSql('$2::boolean')}`,
    [experienceId, maySeeUnread],
  );
  if (expResult.rows.length === 0) throw notFound('Experience not found');

  // Get locations with region membership info. `maySeeUnread` is bound as the
  // last parameter regardless of whether `regionId` is present, so the two
  // shapes of this query don't have to agree on a fixed slot for it.
  const params: (number | boolean)[] = regionId ? [experienceId, regionId] : [experienceId];
  const maySeeUnreadIdx = params.length + 1;
  params.push(maySeeUnread);

  const result = await pool.query<LocationRow & Pick<ExperienceLocationsRow, 'refused_at' | 'description' | 'wikidata_item'> & {
    curation_state: CheckValue<'experience_locations', 'curation_state'>;
  }>(`
    SELECT
      el.id,
      -- The place asked about, which shows the point: a site's part's point is
      -- the site's here, as on the map (ADR-0100).
      pp.place_id AS experience_id,
      el.name,
      el.external_ref,
      el.ordinal,
      el.approximate,
      ST_X(el.location) as longitude,
      ST_Y(el.location) as latitude,
      el.created_at,
      -- Which of its fields a curator has claimed (migration 027), so a row can
      -- say it is corrected rather than letting a moved pin read as the source's.
      el.curated_fields,
      -- Whether a reader sees the place yet. A curator is served the unread rows
      -- (the relaxation below), and the screen that corrects one has to say that
      -- a moved pin is still shown to nobody until it is published (#583).
      el.curation_state,
      -- And whether a curator turned it down, which the state cannot say: a
      -- refused point stays pending (ADR-0053), so a screen reading the state
      -- alone calls it unread and offers publishing as the way to show it --
      -- which the publish refuses, since it composes unreadPointSql and that
      -- carries the mark. The mark is what tells the two apart (#859).
      el.refused_at,
      el.image_url,
      el.metadata -> 'imageCredit' AS image_credit,
      el.description,
      el.wikidata_item,
      ${regionId ? `EXISTS(
        SELECT 1 FROM experience_location_regions elr
        WHERE elr.location_id = el.id AND elr.region_id = $2
      ) as in_region` : 'true as in_region'}
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    WHERE pp.place_id = $1
      AND ${offeredLocationSql()}
      AND ($${maySeeUnreadIdx}::boolean OR ${publishedContentSql('el')})
    ORDER BY el.ordinal, el.id
  `, params);

  const locations: ExperienceLocationWithState[] = result.rows.map((row) => ({
    ...locationOf(row),
    curation_state: row.curation_state,
    refused_at: row.refused_at?.toISOString() ?? null,
    description: row.description,
    wikidata_item: row.wikidata_item,
  }));

  return {
    experienceId,
    experienceName: expResult.rows[0].name,
    locations,
    totalLocations: locations.length,
    regionId,
  };
}

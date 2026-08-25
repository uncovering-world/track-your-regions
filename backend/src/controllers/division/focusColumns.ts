/**
 * A division's stored focus, in the shape a region already answers with:
 * `[west, south, east, north]` with west > east for an antimeridian crossing,
 * and the centre of that frame. Written by trigger_division_focus_data from
 * geometry_focus() and read here -- never measured on the way out (#674).
 *
 * Every read that can become a `selectedDivision` carries them: the roots, one
 * by id, the children, the ancestors (the breadcrumbs), the siblings and the
 * search results. A producer without them would hand the map nothing to frame.
 *
 * The two columns are PostGIS-derived and not in the Drizzle schema, so they
 * are raw SQL inside a select, the way regionCrud.ts reads a region's: once as
 * Drizzle columns, once as a fragment for the raw queries.
 */

import { sql } from 'drizzle-orm';

export const focusColumns = {
  focusBbox: sql<[number, number, number, number] | null>`
    CASE WHEN focus_bbox IS NOT NULL
      THEN json_build_array(focus_bbox[1], focus_bbox[2], focus_bbox[3], focus_bbox[4])
      ELSE NULL END`,
  anchorPoint: sql<[number, number] | null>`
    CASE WHEN anchor_point IS NOT NULL
      THEN json_build_array(ST_X(anchor_point), ST_Y(anchor_point))
      ELSE NULL END`,
};

/** The same two columns for a raw query, aliased for its row mapper. */
export const FOCUS_JSON_COLUMNS = `
      CASE WHEN focus_bbox IS NOT NULL
        THEN json_build_array(focus_bbox[1], focus_bbox[2], focus_bbox[3], focus_bbox[4])
        ELSE NULL END AS focus_bbox_json,
      CASE WHEN anchor_point IS NOT NULL
        THEN json_build_array(ST_X(anchor_point), ST_Y(anchor_point))
        ELSE NULL END AS anchor_point_json`;

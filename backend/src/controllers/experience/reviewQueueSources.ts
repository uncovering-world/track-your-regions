/**
 * The review queue's card for a place two data sources describe differently
 * (#1246): one card per place, a row per field the sources contradict, each
 * row every standing source's view of it.
 *
 * Which fields are asked is `openViewFieldsSql` (`db/sourceViews.ts`), the one
 * rule the keys phase (`sourcesOpenSql`) and the answer
 * (`viewChoiceController.ts`) read too. Each view says whether it is the one
 * readers see now (`shown`), so the card preselects what the place holds. The
 * fields not asked are named with why — the sources agree, only one source
 * reports the field, or a curator already chose — so the card can say what it
 * is not asking. A view names the record it comes from, and the point, asked
 * or not, says how far apart its views stand (#2158).
 *
 * Hydrated by the page's ids alone: the keys phase decided scope, which for
 * this kind is every source the place's views come from.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { KINDS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import {
  contestedViewFieldsSql, openViewFieldsSql, placeViewsSql, placeViewValueSql, viewValueSql, VIEW_FIELDS,
} from '../../db/sourceViews.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { sourcesOpenSql } from './reviewQueuePredicates.js';

const FIELD_ORDER = `ARRAY[${VIEW_FIELDS.map(field => "'" + field + "'").join(', ')}]::text[]`;

/**
 * Every standing, non-empty view of field `f` of place `e`, as a jsonb array;
 * on a part of a serial site, the site's view of the component among them,
 * under the site's membership (`placeViewsSql`).
 */
const VIEWS_OF_FIELD = `(SELECT jsonb_agg(jsonb_build_object(
           'membership_id', m.membership_id,
           'kind_name', k.name,
           'source_name', s.name,
           'external_id', m.external_id,
           'component', m.component,
           -- Where the record lives: a membership's on the place's own page. A
           -- component's row is in the list's table of its property's parts, which
           -- the card builds from the reference (worldHeritagePartsHref, #2183);
           -- this is the property's page, the fallback where the reference gives
           -- no table.
           'source_page', CASE WHEN m.component
                               THEN (SELECT site.metadata->>'unescoUrl' FROM experiences site WHERE site.id = m.site_id)
                               ELSE COALESCE(e.metadata->>'unescoUrl', e.metadata->>'website') END,
           'value', CASE WHEN f IN ('name', 'subtitle', 'wikipediaUrl') THEN ${viewValueSql('f', 'm')} END,
           'image_url', CASE WHEN f = 'imageUrl' THEN m.reported_image_url END,
           'image_credit', CASE WHEN f = 'imageUrl' THEN m.reported_image_credit END,
           'latitude', CASE WHEN f = 'location' THEN ST_Y(m.reported_location) END,
           'longitude', CASE WHEN f = 'location' THEN ST_X(m.reported_location) END,
           'shown', ${viewValueSql('f', 'm')} IS NOT DISTINCT FROM ${placeViewValueSql('f')})
         ORDER BY k.display_priority, m.membership_id)
       FROM ${placeViewsSql('e.id', 'm')}
       JOIN ${KINDS} k ON k.id = m.kind_id
       JOIN experience_sources s ON s.id = m.source_id
      WHERE NULLIF(${viewValueSql('f', 'm')}, '') IS NOT NULL)`;

/** How far apart the two farthest standing views of the place's point stand, in whole metres. */
const POINTS_APART = `(WITH v AS (SELECT * FROM ${placeViewsSql('e.id', 'pv')})
  SELECT round(max(ST_Distance(a.reported_location::geography, b.reported_location::geography)))::int
    FROM v a JOIN v b ON a.membership_id < b.membership_id)`;

/** How many standing views report field `f`, and for a point how far apart the two farthest stand. */
const QUIET_FIELDS = `(SELECT jsonb_agg(jsonb_build_object(
           'field', q.f,
           'why', CASE WHEN q.f = ANY(${contestedViewFieldsSql('e.id')}::text[]) THEN 'answered'
                       WHEN q.reporting = 1 THEN 'one_source'
                       ELSE 'agree' END,
           'metres', q.metres)
         ORDER BY array_position(${FIELD_ORDER}, q.f))
       FROM (
         SELECT f,
                (SELECT count(*) FROM ${placeViewsSql('e.id', 'm')}
                  WHERE NULLIF(${viewValueSql('f', 'm')}, '') IS NOT NULL)::int AS reporting,
                CASE WHEN f = 'location' THEN ${POINTS_APART} END AS metres
           FROM unnest(${FIELD_ORDER}) AS f
          WHERE NOT f = ANY(${openViewFieldsSql('e.id')}::text[])
       ) q
      WHERE q.reporting > 0)`;

export async function querySources(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'sources' AS kind, NULL::jsonb AS proposed,
           (SELECT jsonb_agg(jsonb_build_object('field', f, 'views', ${VIEWS_OF_FIELD},
                                                'metres', CASE WHEN f = 'location' THEN ${POINTS_APART} END)
                    ORDER BY array_position(${FIELD_ORDER}, f))
              FROM unnest(${openViewFieldsSql('e.id')}) AS f) AS source_views,
           COALESCE(${QUIET_FIELDS}, '[]'::jsonb) AS quiet_fields
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND ${sourcesOpenSql('e')}
     ORDER BY e.id
  `, [ids]);
}

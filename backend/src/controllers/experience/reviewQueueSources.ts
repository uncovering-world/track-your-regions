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
 * is not asking.
 *
 * Hydrated by the page's ids alone: the keys phase decided scope, which for
 * this kind is every source the place's views come from.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import {
  contestedViewFieldsSql, openViewFieldsSql, placeViewValueSql, viewStandsSql, viewValueSql, VIEW_FIELDS,
} from '../../db/sourceViews.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { sourcesOpenSql } from './reviewQueuePredicates.js';

const FIELD_ORDER = `ARRAY[${VIEW_FIELDS.map(field => "'" + field + "'").join(', ')}]::text[]`;

/** Every standing, non-empty view of field `f` of place `e`, as a jsonb array. */
const VIEWS_OF_FIELD = `(SELECT jsonb_agg(jsonb_build_object(
           'membership_id', m.id,
           'kind_name', k.name,
           'source_name', s.name,
           'value', CASE WHEN f IN ('name', 'description') THEN ${viewValueSql('f', 'm')} END,
           'image_url', CASE WHEN f = 'imageUrl' THEN m.reported_image_url END,
           'image_credit', CASE WHEN f = 'imageUrl' THEN m.reported_image_credit END,
           'latitude', CASE WHEN f = 'location' THEN ST_Y(m.reported_location) END,
           'longitude', CASE WHEN f = 'location' THEN ST_X(m.reported_location) END,
           'shown', ${viewValueSql('f', 'm')} IS NOT DISTINCT FROM ${placeViewValueSql('f')})
         ORDER BY k.display_priority, m.id)
       FROM ${MEMBERSHIPS} m
       JOIN ${KINDS} k ON k.id = m.kind_id
       JOIN experience_sources s ON s.id = m.source_id
      WHERE m.experience_id = e.id AND ${viewStandsSql('m')}
        AND NULLIF(${viewValueSql('f', 'm')}, '') IS NOT NULL)`;

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
                (SELECT count(*) FROM ${MEMBERSHIPS} m
                  WHERE m.experience_id = e.id AND ${viewStandsSql('m')}
                    AND NULLIF(${viewValueSql('f', 'm')}, '') IS NOT NULL)::int AS reporting,
                CASE WHEN f = 'location' THEN (
                  SELECT round(max(ST_Distance(a.reported_location::geography, b.reported_location::geography)))::int
                    FROM ${MEMBERSHIPS} a JOIN ${MEMBERSHIPS} b ON b.experience_id = a.experience_id AND a.id < b.id
                   WHERE a.experience_id = e.id AND ${viewStandsSql('a')} AND ${viewStandsSql('b')}) END AS metres
           FROM unnest(${FIELD_ORDER}) AS f
          WHERE NOT f = ANY(${openViewFieldsSql('e.id')}::text[])
       ) q
      WHERE q.reporting > 0)`;

export async function querySources(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, e.source_id, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'sources' AS kind, NULL::jsonb AS proposed,
           (SELECT jsonb_agg(jsonb_build_object('field', f, 'views', ${VIEWS_OF_FIELD})
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

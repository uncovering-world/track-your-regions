/**
 * A source's view of a place, and when two views disagree (ADR-0084, #1246).
 *
 * No source owns a place's name, description, picture or coordinate. Each
 * membership records what its source last reported of them (`reported_*`), and
 * where two sources of one place report different values the place keeps the
 * one it holds. The rule for "different" is stated here once, as SQL over two
 * views given as expressions, so the run's upsert asks it of its incoming
 * values against every other view of the place (`services/sync/sourceView.ts`)
 * and a read comparing two stored views asks the same expression.
 *
 * In `db/` for the reason `membership.ts` gives: a sync service and a
 * controller both compose it.
 */

import { LOCATION_UNCHANGED_METERS } from '@tyr/shared/moves';
import { MEMBERSHIPS } from './membership.js';

/**
 * The fields a view holds, in the words a run's change set and the review
 * queue's other cards use for them; `claimKeyFor` (`changeSet.ts`) names the
 * place's column and the claim on it.
 */
export const VIEW_FIELDS = ['name', 'description', 'imageUrl', 'location'] as const;
export type ViewField = (typeof VIEW_FIELDS)[number];

/** One side of the comparison: an SQL expression per field. */
export interface ViewSql {
  name: string;
  description: string;
  imageUrl: string;
  /** A `geometry(Point, 4326)` expression. */
  location: string;
}

/** A membership's stored view, under `alias`. */
export function membershipViewSql(alias = 'm'): ViewSql {
  return {
    name: `${alias}.reported_name`,
    description: `${alias}.reported_description`,
    imageUrl: `${alias}.reported_image_url`,
    location: `${alias}.reported_location`,
  };
}

/**
 * The membership's view counts: its source still lists the place. A source
 * that stopped listing it has stopped saying anything about it, and a view left
 * from then contradicts nobody.
 */
export function viewStandsSql(alias = 'm'): string {
  return `${alias}.missing_since IS NULL AND ${alias}.source_membership = 'present'`;
}

/**
 * The fields on which two views disagree, as a `text[]` of `VIEW_FIELDS` words.
 *
 * A field either side leaves empty is no disagreement: a source with no picture
 * of the Gol Stave Church does not contradict the one that has a winter
 * photograph of it. Text is compared as stored, the run having tidied names
 * before either view was written. Two coordinates within ADR-0027's ten metres
 * are one place, by `ST_DWithin` as the point writers pair them.
 */
export function viewDisagreementsSql(a: ViewSql, b: ViewSql): string {
  const text = (field: ViewField, left: string, right: string) =>
    `CASE WHEN NULLIF(${left}, '') IS NOT NULL AND NULLIF(${right}, '') IS NOT NULL
               AND ${left} <> ${right} THEN '${field}' END`;
  return `array_remove(ARRAY[
      ${text('name', a.name, b.name)},
      ${text('description', a.description, b.description)},
      ${text('imageUrl', a.imageUrl, b.imageUrl)},
      CASE WHEN ${a.location} IS NOT NULL AND ${b.location} IS NOT NULL
                AND NOT ST_DWithin(${a.location}::geography, ${b.location}::geography, ${LOCATION_UNCHANGED_METERS})
           THEN 'location' END
    ]::text[], NULL)`;
}

/**
 * The fields `a` leaves empty where `b` reports a value, as a `text[]` of
 * `VIEW_FIELDS` words.
 *
 * Not a disagreement — nobody is asked about it — but not a value either: a
 * run of Places of worship that reports no picture of the Gol Stave Church
 * says nothing about Archaeology's winter photograph, and writing its empty
 * value would take the picture away until Archaeology's next run put it back.
 */
export function viewSilencesSql(a: ViewSql, b: ViewSql): string {
  const text = (field: ViewField, left: string, right: string) =>
    `CASE WHEN NULLIF(${left}, '') IS NULL AND NULLIF(${right}, '') IS NOT NULL THEN '${field}' END`;
  return `array_remove(ARRAY[
      ${text('name', a.name, b.name)},
      ${text('description', a.description, b.description)},
      ${text('imageUrl', a.imageUrl, b.imageUrl)},
      CASE WHEN ${a.location} IS NULL AND ${b.location} IS NOT NULL THEN 'location' END
    ]::text[], NULL)`;
}

/**
 * One field of a membership's view as a comparable text value, the field
 * named by an SQL expression yielding a `VIEW_FIELDS` word. A coordinate
 * compares as its WKT: a run that reports the same point writes the same text.
 */
export function viewValueSql(fieldExpr: string, alias = 'm'): string {
  return `CASE ${fieldExpr}
            WHEN 'name' THEN ${alias}.reported_name
            WHEN 'description' THEN ${alias}.reported_description
            WHEN 'imageUrl' THEN ${alias}.reported_image_url
            WHEN 'location' THEN ST_AsText(${alias}.reported_location)
          END`;
}

/**
 * The standing views of one field of a place, as a `jsonb` object from
 * membership id to value, empty views left out. What a curator's choice
 * records (`experience_view_choices.views`) and what the open question
 * compares it with: the same expression on both sides, so an answer stands
 * exactly while every source keeps sending what it sent.
 */
export function viewsOfFieldSql(placeExpr: string, fieldExpr: string): string {
  return `(SELECT COALESCE(jsonb_object_agg(v.id::text, ${viewValueSql(fieldExpr, 'v')}), '{}'::jsonb)
             FROM ${MEMBERSHIPS} v
            WHERE v.experience_id = ${placeExpr} AND ${viewStandsSql('v')}
              AND NULLIF(${viewValueSql(fieldExpr, 'v')}, '') IS NOT NULL)`;
}

/**
 * The fields two standing views of the place under different ids disagree on
 * (ADR-0085: under one id they read one item and are never asked), as a
 * `text[]` of `VIEW_FIELDS` words in that order.
 */
export function contestedViewFieldsSql(placeExpr: string): string {
  return `(SELECT COALESCE(array_agg(DISTINCT field), '{}'::text[])
             FROM ${MEMBERSHIPS} a
             JOIN ${MEMBERSHIPS} b ON b.experience_id = a.experience_id AND a.id < b.id
                                  AND a.external_id <> b.external_id AND ${viewStandsSql('b')}
            CROSS JOIN LATERAL unnest(${viewDisagreementsSql(membershipViewSql('a'), membershipViewSql('b'))}) AS field
            WHERE a.experience_id = ${placeExpr} AND ${viewStandsSql('a')})`;
}

/**
 * The contested fields of a place a curator has not answered for the views as
 * they stand (#1246), as a `text[]` in `VIEW_FIELDS` order. Empty once every
 * one is answered; a field whose views change after the answer is open again.
 */
export function openViewFieldsSql(placeExpr: string): string {
  const words = VIEW_FIELDS.map(field => "'" + field + "'").join(', ');
  const order = `ARRAY[${words}]::text[]`;
  return `(SELECT COALESCE(array_agg(f ORDER BY array_position(${order}, f)), '{}'::text[])
             FROM unnest(${contestedViewFieldsSql(placeExpr)}) AS f
            WHERE NOT EXISTS (
              SELECT 1 FROM experience_view_choices c
               WHERE c.experience_id = ${placeExpr} AND c.field = f
                 AND c.views = ${viewsOfFieldSql(placeExpr, 'f')}))`;
}

/**
 * The place's own value of a field named by an SQL expression, comparable with
 * `viewValueSql`: which view, if any, readers are shown now.
 */
export function placeViewValueSql(fieldExpr: string, alias = 'e'): string {
  return `CASE ${fieldExpr}
            WHEN 'name' THEN ${alias}.name
            WHEN 'description' THEN ${alias}.description
            WHEN 'imageUrl' THEN ${alias}.image_url
            WHEN 'location' THEN ST_AsText(${alias}.location)
          END`;
}

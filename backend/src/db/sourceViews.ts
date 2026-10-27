/**
 * A source's view of a place, and when two views disagree (ADR-0084, #1246).
 *
 * No source owns a place's name, subtitle, picture, coordinate or Wikipedia
 * article (#1975). Each
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

import { SHORT_MOVE_METERS } from '@tyr/shared/moves';
import { MEMBERSHIPS, realKindSql } from './membership.js';
import { foldedPointsSql } from './placePoints.js';

/**
 * The fields a view holds, in the words a run's change set and the review
 * queue's other cards use for them; `claimKeyFor` (`changeSet.ts`) names the
 * place's column and the claim on it.
 */
export const VIEW_FIELDS = ['name', 'subtitle', 'imageUrl', 'location', 'wikipediaUrl'] as const;
export type ViewField = (typeof VIEW_FIELDS)[number];

/** One side of the comparison: an SQL expression per field. */
export interface ViewSql {
  name: string;
  subtitle: string;
  imageUrl: string;
  /** A `geometry(Point, 4326)` expression. */
  location: string;
  wikipediaUrl: string;
}

/** A membership's stored view, under `alias`. */
export function membershipViewSql(alias = 'm'): ViewSql {
  return {
    name: `${alias}.reported_name`,
    subtitle: `${alias}.reported_subtitle`,
    imageUrl: `${alias}.reported_image_url`,
    location: `${alias}.reported_location`,
    wikipediaUrl: `${alias}.reported_wikipedia_url`,
  };
}

/**
 * Every standing view of a place, as rows under `alias`: each membership's
 * (`reported_*`), and, on a part of a serial site, the view the site's source
 * holds of the component (#2061, #2063), read off the point under the
 * relation's reference: the part's own, or the one a merge folded into a
 * point the part shows (`foldedPointsSql`), which the site's run keeps
 * pairing and writing — Karnak's "Temple of Karnak" is that, folded into the
 * Archaeology point of the temple.
 *
 * A part carries no membership for its site's kind (ADR-0100 decision 2), so
 * the component view is keyed by the membership of the site that placed the
 * part: `membership_id` names the membership whose source holds the view, the
 * part's own or its site's, and a curator's choice, a suggestion and the
 * snapshot of a field's views (`viewsOfFieldSql`) all name a view by it. Only
 * the name and the coordinate of a component are the site's source's: the
 * point's picture and article are read from its Wikidata item, which a run of
 * that item reads itself (ADR-0085). `external_id` is the id the source knows
 * the place by, the component's reference for a component view.
 */
export function placeViewsSql(placeExpr: string, alias = 'v'): string {
  return `(SELECT m.id AS membership_id, m.kind_id, m.source_id, m.external_id::text AS external_id,
                  false AS component, m.reported_name, m.reported_subtitle, m.reported_image_url,
                  m.reported_image_credit, m.reported_location, m.reported_wikipedia_url
             FROM ${MEMBERSHIPS} m
            WHERE m.experience_id = ${placeExpr} AND ${viewStandsSql('m')} AND ${realKindSql('m')}
           UNION ALL
           SELECT w.id, w.kind_id, w.source_id, p.external_ref, true, pt.name::text, NULL::text, NULL::text,
                  NULL::jsonb, pt.location, NULL::text
             FROM experience_parts p
             JOIN ${MEMBERSHIPS} w ON w.id = p.membership_id
            CROSS JOIN LATERAL (
              SELECT c.name, c.location FROM (
                SELECT own.id, own.name, own.location, own.missing_since, own.source_membership, false AS folded
                  FROM experience_locations own
                 WHERE own.experience_id = p.part_id AND own.external_ref = p.external_ref
                   AND own.merged_into_id IS NULL
                UNION ALL
                SELECT f.id, f.name, f.location, f.missing_since, f.source_membership, true
                  FROM experience_locations f
                 WHERE f.id = ANY(ARRAY(SELECT ff.id FROM ${foldedPointsSql('ARRAY[p.part_id]')} ff))
                   AND f.external_ref = p.external_ref) c
               WHERE ${viewStandsSql('c')}
               ORDER BY c.folded, c.id LIMIT 1) pt
            WHERE p.part_id = ${placeExpr} AND p.reason = 'component' AND ${viewStandsSql('w')}) AS ${alias}`;
}

/**
 * The sources a question about a place's views is a question about, as an
 * `int[]` in id order: every source the place holds a membership of, and the
 * source of a serial site whose view of the place as its component stands.
 * A curator answers it only for each of them (`resolveEverySourceScope`).
 */
export function placeViewSourcesSql(placeExpr: string): string {
  return `(SELECT COALESCE(array_agg(DISTINCT s.source_id ORDER BY s.source_id), '{}'::int[])
             FROM (SELECT m.source_id FROM ${MEMBERSHIPS} m
                    WHERE m.experience_id = ${placeExpr} AND ${realKindSql('m')}
                   UNION ALL
                   SELECT v.source_id FROM ${placeViewsSql(placeExpr)} WHERE v.component) s)`;
}

/**
 * Every standing view of a place a run's record is compared with, as rows
 * under `alias` with the membership's `reported_*` columns: each view under
 * another id than the run's (ADR-0085), the component view included.
 *
 * Without the component view a kind's run reaching a part through its point's
 * Wikidata item met no other view and wrote its own: Archaeology would have
 * renamed Köln-Praetorium, the Roman governor's palace under Cologne's city
 * hall, after the whole Roman city, whose item carries the component's number.
 * The site's own run is not compared with its own view.
 */
export function otherViewsSql(
  placeExpr: string, externalIdExpr: string, sourceIdExpr: string, alias = 'm',
): string {
  return `(SELECT v.reported_name, v.reported_subtitle, v.reported_image_url, v.reported_location,
                  v.reported_wikipedia_url
             FROM ${placeViewsSql(placeExpr)}
            WHERE v.external_id <> ${externalIdExpr} AND NOT (v.component AND v.source_id = ${sourceIdExpr})) AS ${alias}`;
}

/**
 * A view counts while its row, a membership or a component point, is still
 * listed by its source. A source that stopped listing it has stopped saying
 * anything about it, and a view left from then contradicts nobody.
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
 * before either view was written. Two coordinates within `metres` of each
 * other are one place, by `ST_DWithin`: ADR-0027's ten metres where a run
 * decides which coordinate to keep, `SHORT_MOVE_METERS` where a curator is
 * asked (ADR-0140), since two views a few dozen metres apart stand on the same
 * building and the place keeps the one it holds.
 */
export function viewDisagreementsSql(a: ViewSql, b: ViewSql, metres: number): string {
  const text = (field: ViewField, left: string, right: string) =>
    `CASE WHEN NULLIF(${left}, '') IS NOT NULL AND NULLIF(${right}, '') IS NOT NULL
               AND ${left} <> ${right} THEN '${field}' END`;
  return `array_remove(ARRAY[
      ${text('name', a.name, b.name)},
      ${text('subtitle', a.subtitle, b.subtitle)},
      ${text('imageUrl', a.imageUrl, b.imageUrl)},
      CASE WHEN ${a.location} IS NOT NULL AND ${b.location} IS NOT NULL
                AND NOT ST_DWithin(${a.location}::geography, ${b.location}::geography, ${metres})
           THEN 'location' END,
      ${text('wikipediaUrl', a.wikipediaUrl, b.wikipediaUrl)}
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
      ${text('subtitle', a.subtitle, b.subtitle)},
      ${text('imageUrl', a.imageUrl, b.imageUrl)},
      CASE WHEN ${a.location} IS NULL AND ${b.location} IS NOT NULL THEN 'location' END,
      ${text('wikipediaUrl', a.wikipediaUrl, b.wikipediaUrl)}
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
            WHEN 'subtitle' THEN ${alias}.reported_subtitle
            WHEN 'imageUrl' THEN ${alias}.reported_image_url
            WHEN 'location' THEN ST_AsText(${alias}.reported_location)
            WHEN 'wikipediaUrl' THEN ${alias}.reported_wikipedia_url
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
  return `(SELECT COALESCE(jsonb_object_agg(v.membership_id::text, ${viewValueSql(fieldExpr, 'v')}), '{}'::jsonb)
             FROM ${placeViewsSql(placeExpr)}
            WHERE NULLIF(${viewValueSql(fieldExpr, 'v')}, '') IS NOT NULL)`;
}

/**
 * The fields two standing views of the place under different ids disagree on
 * (ADR-0085: under one id they read one item and are never asked), as a
 * `text[]` of `VIEW_FIELDS` words in that order.
 */
export function contestedViewFieldsSql(placeExpr: string): string {
  return `(WITH v AS (SELECT * FROM ${placeViewsSql(placeExpr, 'pv')})
           SELECT COALESCE(array_agg(DISTINCT field), '{}'::text[])
             FROM v a
             JOIN v b ON a.membership_id < b.membership_id AND a.external_id <> b.external_id
            CROSS JOIN LATERAL unnest(${viewDisagreementsSql(membershipViewSql('a'), membershipViewSql('b'), SHORT_MOVE_METERS)}) AS field)`;
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
            WHEN 'subtitle' THEN ${alias}.subtitle
            WHEN 'imageUrl' THEN ${alias}.image_url
            WHEN 'location' THEN ST_AsText(${alias}.location)
            WHEN 'wikipediaUrl' THEN ${alias}.metadata->>'wikipediaUrl'
          END`;
}

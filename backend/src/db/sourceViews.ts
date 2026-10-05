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

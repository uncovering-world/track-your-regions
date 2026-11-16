/**
 * A line of a site's list is one place: its record and its point stand on the
 * same one (#2123, found on #2527). The points go with #2124, and with them
 * what this compares.
 */

import { MEMBERSHIPS, WORLD_HERITAGE_SOURCE_ID, componentRecordSql, kindRecordSql } from '../../../db/membership.js';
import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';

/**
 * A list line whose record is on one place and whose point is on another.
 *
 * The site counts the place that holds the line's record and draws the place
 * that holds its point. A line's point is the one the site's World Heritage
 * membership places under the line's reference; a row is such a point on a
 * place that holds no record of the site under that reference, which is the
 * line read onto the wrong place. A record whose line has no point is no row:
 * a curator who gives a line to another place moves its record and leaves the
 * point it had (#2527). On the development catalogue on 2026-11-16,
 * Thessaloniki's Rotunda (456-002): its record is on the Arch of Galerius and
 * Rotunda, and its point on a place of its own that is no part of the site, at
 * UNESCO's coordinate 1.6 km from the Rotunda the catalogue holds; #2527's
 * reads counted 68 such records. The check on the parts' gate reads a record
 * against the points of its own place, so it reads such a record as clean.
 */
const partLineOnAnotherPlace: CatalogueAssertion = {
  id: 'part-line-on-another-place',
  area: 'places',
  title: 'A line of a site\'s list whose record is on one place and whose point is on another',
  kind: 'invariant',
  meaning:
    'The site counts the place holding this line\'s record and draws the place holding its point. '
    + 'On the site\'s card, a curator gives the line to the place it names. '
    + 'A place left holding only the point is merged into the place it stands for.',
  sql: `SELECT whole.id AS whole_id, whole.name AS whole_name, rec.external_id AS reference,
               holder.id AS record_place_id, holder.name AS record_place_name,
               el.id AS point_id, stray.id AS point_place_id, stray.name AS point_place_name
          FROM ${MEMBERSHIPS} rec
          JOIN ${MEMBERSHIPS} site ON site.experience_id = rec.whole_id
                                  AND site.source_id = ${WORLD_HERITAGE_SOURCE_ID} AND ${kindRecordSql('site')}
          JOIN experience_location_placements pl ON pl.membership_id = site.id
          JOIN experience_locations el ON el.id = pl.location_id AND el.merged_into_id IS NULL
                                      AND lower(el.external_ref) = lower(rec.external_id)
                                      AND el.experience_id <> rec.experience_id
          JOIN experiences whole ON whole.id = rec.whole_id
          JOIN experiences holder ON holder.id = rec.experience_id
          JOIN experiences stray ON stray.id = el.experience_id
         WHERE ${componentRecordSql('rec')}
           AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} same
                            WHERE same.whole_id = rec.whole_id AND same.experience_id = el.experience_id
                              AND ${componentRecordSql('same')} AND lower(same.external_id) = lower(rec.external_id))
         ORDER BY whole.name, rec.external_id, el.id`,
  describe: (row: AssertionRow) => `${text(row, 'whole_name')}, ${text(row, 'reference')}: `
    + `its record is on ${text(row, 'record_place_name')} (#${count(row, 'record_place_id')}). `
    + `Its point ${count(row, 'point_id')} is on ${text(row, 'point_place_name')} (#${count(row, 'point_place_id')}).`,
};

/** A list line's record and point on one place. */
export const partLineAssertions: CatalogueAssertion[] = [partLineOnAnotherPlace];

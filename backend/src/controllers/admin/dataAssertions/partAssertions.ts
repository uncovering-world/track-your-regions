/**
 * What must be true of a whole's parts (ADR-0100, ADR-0198): one line of a
 * source's list is one part, and an item names one place.
 *
 * Both read the parts' records in their whole (`partRecordSql`), the column
 * that makes a place a part, rather than the relation derived from it.
 */

import { MEMBERSHIPS, partRecordSql, placeOfferedSql } from '../../../db/membership.js';
import { hideLostSql, offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';

/** How far apart two parts under one reference may stand and still be one line read twice. */
const ONE_SPOT_M = 10;
/** How far apart two parts carrying one item stand before the item cannot be both. */
const FAR_APART_M = 1000;

/**
 * A point of the part `part` that is still in the world and not turned down:
 * what keeps a copy of a line standing. A curator who turns the copy's point
 * down settles the row (ADR-0053).
 */
const standingPointSql = (part: string) => `EXISTS (
  SELECT 1 FROM experience_locations el
   WHERE el.experience_id = ${part}.id AND el.merged_into_id IS NULL
     AND ${hideLostSql('el')} AND el.refused_at IS NULL)`;

/**
 * Two parts of one whole under one reference, standing at one spot.
 *
 * The list gives each line a reference, and a run pairs a line it reads again
 * with the part already standing there (ADR-0137). Two parts at one spot under
 * one reference are that line read twice, so a row means a writer wrote a
 * line twice. Hidden copies count too, since they hide the part's reference
 * from the run's lookup (the registry holds a reference two places claim as
 * identifying neither).
 */
const partsOfOneWholeAtOneSpot: CatalogueAssertion = {
  id: 'parts-of-one-whole-at-one-spot',
  area: 'places',
  title: 'Two parts of one site under one reference, at one spot',
  kind: 'invariant',
  meaning:
    'One line of the site\'s list stands twice, as two parts at the same spot. '
    + 'A curator turns down the copy that waits unread on the site\'s card. '
    + 'A copy no card shows means a run wrote the line twice, so tell the admin who runs it.',
  sql: `SELECT w.id AS whole_id, w.name AS whole_name, ra.external_id AS reference,
               a.id AS first_id, a.name AS first_name, b.id AS second_id, b.name AS second_name,
               ST_Distance(a.location::geography, b.location::geography) AS metres
          FROM ${MEMBERSHIPS} ra
          JOIN ${MEMBERSHIPS} rb
            ON rb.source_id = ra.source_id AND rb.whole_id = ra.whole_id
           AND rb.external_id = ra.external_id AND rb.experience_id > ra.experience_id
           AND ${partRecordSql('rb')}
          JOIN experiences a ON a.id = ra.experience_id AND a.merged_into_id IS NULL
          JOIN experiences b ON b.id = rb.experience_id AND b.merged_into_id IS NULL
          JOIN experiences w ON w.id = ra.whole_id
         WHERE ${partRecordSql('ra')}
           AND ST_DWithin(a.location::geography, b.location::geography, ${ONE_SPOT_M})
           AND ${standingPointSql('a')} AND ${standingPointSql('b')}
         ORDER BY w.name, ra.external_id, a.id`,
  describe: (row: AssertionRow) => `${text(row, 'whole_name')} (#${count(row, 'whole_id')}), `
    + `${text(row, 'reference')}: ${text(row, 'first_name')} (#${count(row, 'first_id')}) and `
    + `${text(row, 'second_name')} (#${count(row, 'second_id')}), `
    + `${Math.round(count(row, 'metres'))} m apart`,
};

/**
 * One Wikidata item on parts of one whole that stand far apart.
 *
 * A list line's item is its part's (ADR-0200), and parts a kilometre or more
 * apart are not one place, so the item names one of them, or the whole they
 * make up. Measured on the development catalogue on 2026-11-13: 10 items on
 * parts a reader is shown, among them Masoala National Park on its six
 * parcels, 73 km apart, and the Daursky reserve on both Dauria parts, 78 km
 * apart. The registry already holds such an item as referring on every part,
 * so nothing is joined by it; what is wrong is the picture and article each
 * part takes from it. Only parts a reader is shown are asked about, since a
 * part no reader sees still waits for a curator who can settle its item then,
 * and a part a curator has answered the item on (`place_identifier_verdicts`)
 * is settled.
 */
const itemOnFarParts: CatalogueAssertion = {
  id: 'item-on-far-parts',
  area: 'places',
  title: 'One Wikidata item on parts of one site more than a kilometre apart',
  kind: 'invariant',
  meaning:
    'Parts this far apart are not one place, so the item names at most one of them. '
    + 'Under Identifiers on each part\'s card, a curator says which part it names. '
    + 'On the others it only refers to the place, or is taken off.',
  sql: `WITH carried AS (
          SELECT rec.whole_id, item, part.id AS part_id, part.name, part.location
            FROM ${MEMBERSHIPS} rec
            JOIN experiences part ON part.id = rec.experience_id AND part.merged_into_id IS NULL
            JOIN experiences whole ON whole.id = rec.whole_id
           CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
           WHERE ${partRecordSql('rec')} AND ${placeOfferedSql('whole')}
             AND EXISTS (SELECT 1 FROM experience_locations el
                          WHERE el.experience_id = part.id AND ${offeredLocationSql('el')}
                            AND ${publishedContentSql('el')})
             AND NOT EXISTS (SELECT 1 FROM place_identifier_verdicts v
                              WHERE v.experience_id = part.id AND v.scheme = 'wikidata' AND v.value = item
                                AND v.verdict IN ('refers', 'removed'))
        ), far AS (
          SELECT a.whole_id, a.item, max(ST_Distance(a.location::geography, b.location::geography)) AS metres
            FROM carried a
            JOIN carried b ON b.whole_id = a.whole_id AND b.item = a.item AND b.part_id <> a.part_id
           GROUP BY a.whole_id, a.item
          HAVING max(ST_Distance(a.location::geography, b.location::geography)) > ${FAR_APART_M}
        )
        SELECT far.whole_id, w.name AS whole_name, far.item, label.label, far.metres,
               array_agg(c.name || ' (#' || c.part_id || ')' ORDER BY c.name, c.part_id) AS parts
          FROM far
          JOIN experiences w ON w.id = far.whole_id
          JOIN carried c ON c.whole_id = far.whole_id AND c.item = far.item
          LEFT JOIN workbench.wikidata_labels label ON label.id = far.item AND label.language = 'en'
         GROUP BY far.whole_id, w.name, far.item, label.label, far.metres
         ORDER BY far.metres DESC, far.item`,
  describe: (row: AssertionRow) => {
    const label = text(row, 'label');
    const item = label ? `${text(row, 'item')} (${label})` : text(row, 'item');
    // Names come from outside; each is read as `text` reads a column.
    const parts = Array.isArray(row.parts) ? (row.parts as unknown[]).map(one => text({ one }, 'one')) : [];
    return `${text(row, 'whole_name')} (#${count(row, 'whole_id')}): ${item} on parts up to `
      + `${(count(row, 'metres') / 1000).toFixed(1)} km apart, ${parts.join(', ')}`;
  },
};

/** The parts' rules: one line, one part; one item, one place. */
export const partAssertions: CatalogueAssertion[] = [
  partsOfOneWholeAtOneSpot,
  itemOnFarParts,
];

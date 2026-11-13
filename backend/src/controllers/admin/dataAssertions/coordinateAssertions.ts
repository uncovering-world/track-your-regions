/**
 * What must be true of a place's coordinate (ADR-0204, #2119): the place
 * stands where its item says, and its pin stands where its row and card send
 * a reader.
 */

import { SHORT_MOVE_METERS } from '@tyr/shared/moves';
import { pool } from '../../../db/index.js';
import { MEMBERSHIPS, placeOfferedSql } from '../../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { BEST } from '../../../services/sync/subset/entities.js';
import { unreadPointSql } from '../../experience/waitingCounts.js';
import { chooseItemCoordinate, coordinateEvidence, itemPointsOf } from '../../../services/sync/itemCoordinate.js';
import { AssertionUnavailable, count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion, Collected, ComputedAssertion } from './assertion.js';

/** The place `alias` is shown to a reader: a kind offers it, or it is a part of a whole a kind offers. */
const shownPlaceSql = (alias: string) => `(${placeOfferedSql(alias)}
  OR EXISTS (SELECT 1 FROM experience_parts shown_part JOIN experiences shown_whole ON shown_whole.id = shown_part.whole_id
              WHERE shown_part.part_id = ${alias}.id AND ${placeOfferedSql('shown_whole')}))`;

/** Places whose item gives two or more coordinates at its best rank, the item with each. */
const ITEMS_OF_SEVERAL_POINTS_SQL = `
  SELECT DISTINCT e.id, e.name, rec.external_id AS item
    FROM experiences e
    JOIN ${MEMBERSHIPS} rec ON rec.experience_id = e.id AND rec.kind_id IS NOT NULL AND rec.external_id ~ '^Q[0-9]+$'
   WHERE e.merged_into_id IS NULL AND NOT e.cast_points
     AND NOT (e.curated_fields ? 'location')
     AND NOT EXISTS (SELECT 1 FROM experience_parts made_of WHERE made_of.whole_id = e.id)
     -- A move the run proposed is already a question on the review page.
     AND NOT EXISTS (SELECT 1 FROM experience_locations asked
                      WHERE asked.experience_id = e.id AND ${unreadPointSql('asked')} AND ${offeredLocationSql('asked')})
     AND ${placeOfferedSql('e')}
     AND (SELECT count(*) FROM wikidata_claims c
           WHERE c.subject = rec.external_id AND c.property = 'P625' AND c.rank >= 0 AND ${BEST('c')}
             AND c.value ? 'latitude') >= 2
   ORDER BY e.name, e.id`;

/**
 * The places whose item's coordinates nothing tells apart, by the run's own
 * rule (`chooseItemCoordinate`), asked of the place as the catalogue holds it.
 */
async function collectUndecided(): Promise<Collected> {
  const held = await pool.query('SELECT 1 FROM wikidata_claims LIMIT 1');
  if (held.rowCount === 0) {
    throw new AssertionUnavailable('The local copy of Wikidata is not built, so an item\'s coordinates cannot be read. Build it under Public Dumps.');
  }
  const places = await pool.query<{ id: number; name: string; item: string }>(ITEMS_OF_SEVERAL_POINTS_SQL);
  const rows: AssertionRow[] = [];
  for (const place of places.rows) {
    const points = await itemPointsOf(pool, place.item);
    if (points.length < 2) continue;
    const choice = chooseItemCoordinate(points, await coordinateEvidence(pool, place.id, place.item, points));
    if (choice.undecided) {
      rows.push({ experience_id: place.id, name: place.name, item: place.item, coordinates: points.length, spread_m: choice.spreadM });
    }
  }
  return { rows, context: [`${places.rows.length} places a reader is shown carry an item with several coordinates.`] };
}

/**
 * A place whose item gives coordinates far apart and nothing tells which.
 *
 * The run keeps the one it reported last, or the one the place shows, so it
 * proposes no move it cannot justify, and the place waits here for a person.
 * Only places a reader is shown are asked about. A place whose coordinate a
 * curator set is settled, and one whose move the run proposed is asked on the
 * review page instead.
 */
const itemCoordinatesDisagree: ComputedAssertion = {
  id: 'item-coordinates-disagree',
  area: 'places',
  title: 'A place whose Wikidata item gives coordinates far apart, with nothing to say which is right',
  kind: 'invariant',
  meaning:
    'Neither the place\'s outline nor another source says which of its item\'s coordinates it stands at. '
    + 'The place keeps the one it showed. A curator who knows it corrects the pin on the card, and the run keeps that.',
  collect: collectUndecided,
  describe: row => `${text(row, 'name')} (#${count(row, 'experience_id')}): ${text(row, 'item')} gives `
    + `coordinates up to ${(count(row, 'spread_m') / 1000).toFixed(1)} km apart`,
};

/**
 * A place whose pin stands away from the coordinate its row and card use.
 *
 * The map draws a place's point, while its row, its card and a flight to it
 * read the place's own coordinate. Two sources that disagree on where it
 * stands leave the two apart, and a reader who follows the row arrives
 * somewhere the pin is not. A difference within a short move is one place
 * written twice. A curator's correction of the pin moves both.
 */
const pinAwayFromItsPlace: CatalogueAssertion = {
  id: 'pin-away-from-its-place',
  area: 'places',
  title: 'A place whose pin stands away from where its row and card send a reader',
  kind: 'invariant',
  meaning:
    'The map\'s pin and the place\'s own coordinate disagree, so the row and the pin send a reader to two spots. '
    + 'A curator corrects the pin on the card, which moves both.',
  sql: `SELECT e.id AS experience_id, e.name,
               min(ST_Distance(e.location::geography, el.location::geography)) AS metres
          FROM experiences e
          JOIN experience_locations el ON el.experience_id = e.id
           AND ${offeredLocationSql('el')} AND ${publishedContentSql('el')}
         WHERE e.merged_into_id IS NULL AND NOT e.cast_points
           AND NOT EXISTS (SELECT 1 FROM experience_parts made_of WHERE made_of.whole_id = e.id)
           AND ${shownPlaceSql('e')}
         GROUP BY e.id, e.name
        HAVING min(ST_Distance(e.location::geography, el.location::geography)) > ${SHORT_MOVE_METERS}
         ORDER BY metres DESC, e.id`,
  describe: (row: AssertionRow) => `${text(row, 'name')} (#${count(row, 'experience_id')}): its pin stands `
    + `${(count(row, 'metres') / 1000).toFixed(1)} km from where its row and card send a reader`,
};

/** The pin's rule, a statement over the catalogue. */
export const coordinateAssertions: CatalogueAssertion[] = [pinAwayFromItsPlace];

/** The item's rule, which the run's own choice answers in code. */
export const itemCoordinateAssertions: ComputedAssertion[] = [itemCoordinatesDisagree];

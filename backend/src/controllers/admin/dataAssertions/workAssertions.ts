/**
 * Catalogue assertions about works: the paintings, sculptures and finds a
 * place holds (`treasures`, linked through `experience_treasures`).
 *
 * A kind's rule may refuse a place, and the refusal is right more often than
 * not — the Natural History Museum in Vienna is no art museum — but what the
 * place holds goes with it unless another kind holds the place (#1444). These
 * rules are how that becomes visible when a run does it, rather than when a
 * traveller looks for the Venus of Willendorf and finds nothing.
 */

import { MEMBERSHIPS, placeOfferedSql } from '../../../db/membership.js';
import { linkedForReaderSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { unreadLinkSql } from '../../experience/waitingCounts.js';
import { count, text, type AssertionRow, type CatalogueAssertion } from './assertion.js';

/**
 * A work no reader can reach: no place a reader is offered holds it through a
 * link a reader may see. The Venus of Willendorf, linked only to the Natural
 * History Museum, Vienna, which Art Museums refused and no other kind holds;
 * the Bamberg Horseman, which Public Art refused as standing in Bamberg
 * Cathedral and no venue holds at all.
 *
 * A watch rather than an invariant: a work a museum gave back is legitimately
 * on no card, and a work arrives before a curator has read its venue. The
 * number moving is the news — a run that refuses a museum takes its works
 * with it — and the rows say which works and where they are held, so the
 * refusal that lost them can be found.
 *
 * A work waiting for a curator's read is not lost, and is left out — the
 * work itself unread, or its link to an offered place; so is a work a reader
 * reaches as a place of its own — the Column of Phocas is an Archaeology
 * place, whatever holds it as a work. A work whose links are all marked
 * missing is listed, held by none. The sentence names what keeps each venue
 * from a reader: no kind offers it, or a curator refused the work there.
 */
const workNoOfferedPlaceHolds: CatalogueAssertion = {
  id: 'work-no-offered-place-holds',
  area: 'objects',
  title: 'Works no place a reader is offered holds',
  kind: 'watch',
  meaning:
    'A work is shown only on the card of a place that holds it. These are held by no place a reader is offered '
    + '— their only venue is refused by its kind and held by no other, a curator refused the work at the place '
    + 'that holds it, or no venue holds them at all — so no '
    + 'reader can find them. Watch the number: a run that refuses a museum takes its works with it (#1444).',
  sql: `SELECT t.id AS treasure_id,
               t.name AS work_name,
               t.external_id,
               t.sitelinks_count,
               (SELECT string_agg(v.name, '; ' ORDER BY v.name)
                  FROM experience_treasures held
                  JOIN experiences v ON v.id = held.experience_id
                 WHERE held.treasure_id = t.id AND held.missing_since IS NULL
                   AND NOT ${placeOfferedSql('v')}) AS held_by,
               (SELECT string_agg(v.name, '; ' ORDER BY v.name)
                  FROM experience_treasures held
                  JOIN experiences v ON v.id = held.experience_id
                 WHERE held.treasure_id = t.id AND held.missing_since IS NULL
                   AND held.refused_at IS NOT NULL AND ${placeOfferedSql('v')}) AS refused_at
          FROM treasures t
         WHERE ${publishedContentSql('t')}
           AND NOT EXISTS (SELECT 1 FROM experience_treasures et
                             JOIN experiences e ON e.id = et.experience_id
                            WHERE et.treasure_id = t.id AND ${linkedForReaderSql('e', 'et')})
           -- Waiting for a curator at a place a reader is offered.
           AND NOT EXISTS (SELECT 1 FROM experience_treasures wt
                             JOIN experiences we ON we.id = wt.experience_id
                            WHERE wt.treasure_id = t.id AND wt.missing_since IS NULL
                              AND ${unreadLinkSql('wt', 't')} AND ${placeOfferedSql('we')})
           -- A place of its own a reader is offered, known by the same item.
           AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own
                             JOIN experiences pe ON pe.id = own.experience_id
                            WHERE own.external_id = t.external_id AND ${placeOfferedSql('pe')})
         ORDER BY t.sitelinks_count DESC, t.id`,
  describe: (row: AssertionRow) => {
    const work = `${text(row, 'work_name')} (${text(row, 'external_id')}, ${count(row, 'sitelinks_count')} sitelinks)`;
    const holders = [
      ...(text(row, 'held_by') ? [`${text(row, 'held_by')}, which no kind offers a reader`] : []),
      ...(text(row, 'refused_at') ? [`${text(row, 'refused_at')}, where a curator refused it`] : []),
    ];
    return holders.length > 0 ? `${work} is held only by ${holders.join('; and ')}` : `${work} is held by no place`;
  },
};

export const workAssertions: CatalogueAssertion[] = [workNoOfferedPlaceHolds];

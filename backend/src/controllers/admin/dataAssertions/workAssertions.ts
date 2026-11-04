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
import { ICONIC_SITELINKS } from '../../../services/sync/museum/tier1.js';

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

/**
 * Whether a reader is offered the place a Wikidata item names: a membership
 * keyed by the item, or a place that item identifies in the registry
 * (`place_identifiers`), as a World Heritage site whose membership is keyed by
 * its listing is identified by its item.
 */
const itemOfferedSql = (item: string): string => `(
  EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
           WHERE m.external_id = ${item} AND ${placeOfferedSql('e')})
  OR EXISTS (SELECT 1 FROM place_identifiers pi JOIN experiences e ON e.id = pi.experience_id
              WHERE pi.scheme = 'wikidata' AND pi.value = ${item} AND pi.identifies AND ${placeOfferedSql('e')}))`;

/** A town or city (Q486972) and an administrative area (Q56061): where a statement put a work, not a place to visit. */
const HUMAN_SETTLEMENT = 'Q486972';
const ADMINISTRATIVE_AREA = 'Q56061';

/**
 * A place no kind offers that holds a famous work no kind shows (#1821).
 *
 * The rule above sees only the works some kind once wrote. The place pass
 * reads every kind's works once, and keeps where each famous one lies
 * whatever any kind then shows (`workbench.gathered_work_venues`,
 * `places/gatheredWorkVenues.ts`), so this sees the rest: the Voynich
 * manuscript at the Beinecke Library, the Book of Kells at Trinity College's
 * library, the Codex Gigas at the National Library of Sweden, places no kind
 * is drawn to hold. A work shown on an offered place's card, or offered as a
 * place of its own, is no loss; a venue that is a town or an administrative
 * area is where a statement put the work, not a place to visit, and is left
 * out. One row per place, its works named most famous first. Empty until a
 * place pass has read works.
 */
const worksInNoOfferedPlace: CatalogueAssertion = {
  id: 'works-in-no-offered-place',
  area: 'objects',
  title: 'Places no kind offers that hold a famous work no kind shows',
  kind: 'watch',
  meaning:
    `A work at ${ICONIC_SITELINKS} Wikipedia editions or more that no reader can find: no kind shows it on a `
    + 'place\'s card, and it is no place of its own. Each row is a place its collection or location statement '
    + 'names that no kind offers, a library, a gallery or a chapel no kind is drawn to hold. Watch the list: '
    + 'a place on it is a kind\'s gap, or a place a curator could add. Empty until a place pass has read works.',
  sql: `WITH unshown AS (
          SELECT DISTINCT g.work_qid, g.work_label, g.sitelinks, g.venue_qid
            FROM workbench.gathered_work_venues g
           WHERE g.sitelinks >= ${ICONIC_SITELINKS}
             AND NOT ${itemOfferedSql('g.work_qid')}
             AND NOT EXISTS (SELECT 1 FROM treasures t
                               JOIN experience_treasures et ON et.treasure_id = t.id
                               JOIN experiences e ON e.id = et.experience_id
                              WHERE t.external_id = g.work_qid AND ${publishedContentSql('t')}
                                AND ${linkedForReaderSql('e', 'et')}))
        SELECT u.venue_qid,
               COALESCE((SELECT w.entity->'labels'->>'en' FROM workbench.wikidata_entities w WHERE w.id = u.venue_qid),
                        u.venue_qid) AS venue_name,
               count(*)::int AS works,
               max(u.sitelinks) AS top_sitelinks,
               string_agg(u.work_label, '; ' ORDER BY u.sitelinks DESC, u.work_qid) AS work_names
          FROM (SELECT DISTINCT work_qid, work_label, sitelinks, venue_qid FROM unshown) u
         WHERE NOT ${itemOfferedSql('u.venue_qid')}
           AND NOT EXISTS (SELECT 1 FROM workbench.wikidata_claims c
                             JOIN workbench.wikidata_class_closure k ON k.class = c.value_item
                            WHERE c.subject = u.venue_qid AND c.property = 'P31' AND c.rank >= 0
                              AND k.ancestor IN ('${HUMAN_SETTLEMENT}', '${ADMINISTRATIVE_AREA}'))
         GROUP BY u.venue_qid
         ORDER BY max(u.sitelinks) DESC, u.venue_qid`,
  describe: row => `${text(row, 'venue_name')} (${text(row, 'venue_qid')}) holds ${count(row, 'works')} famous `
    + `work(s) no kind shows: ${text(row, 'work_names')}`,
};

export const workAssertions: CatalogueAssertion[] = [workNoOfferedPlaceHolds, worksInNoOfferedPlace];

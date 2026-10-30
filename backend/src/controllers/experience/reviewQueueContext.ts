/**
 * What a queue card shows about the object it is asking about.
 *
 * Its own module because two files build queue rows now — the handler and the
 * contents/withdrawn queries beside it — and these fragments are what stop the
 * cards drifting into showing different amounts about the same object. A
 * shared fragment imported by both is the only arrangement in which that cannot
 * happen; keeping it in either file would have made the other import a
 * controller, or copy it.
 */

import { offeredLinkSql, offeredLocationSql } from '../../db/readerPredicates.js';
import { descriptionAdaptedSql, descriptionSourceSql, MEMBERSHIPS } from '../../db/membership.js';
import { dangerSelectSql } from './experienceDanger.js';
import { partOfFactsSql, pointsShownSql } from '../../db/placePoints.js';
import { viewStandsSql } from '../../db/sourceViews.js';

/**
 * How many items a queue page holds by default.
 *
 * Here rather than in the handler because two modules now derive from it — the
 * handler's `limit` default and the cap on what a `contents` card lists — and a
 * page size defined in the file that only uses one of them makes the other a
 * second literal that agrees by luck.
 */
export const QUEUE_PAGE_SIZE = 25;

/**
 * A point that is one of the places an object is made of: offered, and not
 * the unread arrival of a move whose stored pin is still offered — a gated run
 * keeps the stored pin and writes the moved one as an arrival that names what
 * it replaces (locationWriter.ts), and for as long as the move waits the
 * object is still made of one place there. Only while the pin it replaces is
 * itself offered: a curator may declare that pin gone while the move waits,
 * and leaving both rows out would lose the place.
 *
 * What "made of N places" counts and what the component-items card draws as
 * the site's places (#1342), so the number and the pins cannot disagree.
 */
export function placeOfObjectSql(alias: string): string {
  return `${offeredLocationSql(alias)}
              AND NOT EXISTS (
                SELECT 1 FROM experience_locations replaced
                 WHERE replaced.id = ${alias}.withdrawal_deferred_for_location_id
                   AND ${offeredLocationSql('replaced')})`;
}

/**
 * What the object *is*, for a card that asks a question about it.
 *
 * Every kind here asks a curator to judge something — whether a site is gone, whether a
 * description is better, whether a museum should be visible — and until now none of them
 * showed the thing being judged: no picture, no coordinates, no way to open the source
 * page. Deciding meant leaving the queue.
 *
 * Carried on every kind through one fragment rather than added per query, so the queue's
 * cards cannot drift into showing different amounts about the same object. It costs each
 * query only columns off the row it already reads plus one region lookup; the regions are
 * a list because an object crosses them, and their names are what a curator recognises —
 * the ids on the object are not.
 */
export function objectContextSelectSql(alias = 'e'): string {
  return `${alias}.image_url,
          -- The danger listing, raw, through the same fragment the reader-facing
          -- reads use, so withDangerFields can turn it into "since 2003" for
          -- the card exactly as it does for the badge. A card proposing
          -- inDanger false -> true on Bamiyan is about a site listed since
          -- 2003; without the year it reads as this year's news (#570).
          ${dangerSelectSql(alias)},
          -- With the picture rather than after it: a curator's screen is where the
          -- catalogue is being worked on rather than published, and a licence
          -- naming its photographer does not stop asking because the audience is
          -- one person. It also answers a question only this screen raises — a
          -- curator deciding whether to replace a photograph needs to know whose
          -- it is.
          ${alias}.metadata->'imageCredit' AS image_credit,
          ST_Y(${alias}.location) AS latitude,
          ST_X(${alias}.location) AS longitude,
          ${alias}.metadata->>'website' AS website_url,
          ${alias}.metadata->>'unescoUrl' AS unesco_url,
          ${alias}.metadata->>'wikipediaUrl' AS wikipedia_url,
          -- What the object is, in a line: its subtitle, Wikidata's line
          -- ("museum in Saint Petersburg, Russia" for the Hermitage), else its
          -- description (UNESCO's paragraph, a curator's text). The card's
          -- header draws it (#1780).
          COALESCE(NULLIF(${alias}.subtitle, ''), NULLIF(${alias}.description, '')) AS object_description,
          -- Whose text that line is, where it is the description: the card
          -- credits UNESCO's paragraph as every other screen does (ADR-0149).
          CASE WHEN NULLIF(${alias}.subtitle, '') IS NULL AND NULLIF(${alias}.description, '') IS NOT NULL
               THEN ${descriptionSourceSql(alias)} END AS object_description_source,
          (NULLIF(${alias}.subtitle, '') IS NULL AND ${descriptionAdaptedSql(alias)}) AS object_description_adapted,
          -- The run's own question about a row it could not settle by its rule
          -- (ADR-0058): an art museum with an antiquities department is a
          -- judgement about the exposition that no classes answer, so the run
          -- writes down what it saw and holds the row. On the card, because
          -- this is where the answer is given -- and where a batch answer can dispose of the row without
          -- the object ever being opened (#852). Null on every row no run
          -- asked anything about, which is nearly all of them. Each kind's run
          -- asks on its own membership (ADR-0153), since a place two kinds hold
          -- must not lose one run's question to the other's, and the card reads
          -- every question there is, one after another. A membership its source
          -- no longer lists is never run again, so its question would stand for
          -- good: only a standing one asks.
          (SELECT NULLIF(string_agg(note_m.facts->>'admissionNote', ' ' ORDER BY note_m.source_id), '')
             FROM ${MEMBERSHIPS} note_m
            WHERE note_m.experience_id = ${alias}.id AND ${viewStandsSql('note_m')}) AS admission_note,
          (SELECT jsonb_agg(r.name ORDER BY r.name)
             FROM experience_regions er
             JOIN regions r ON r.id = er.region_id
            WHERE er.experience_id = ${alias}.id) AS region_names,
          -- The serial site the object is a component of, where it is one: a
          -- component's own name ("Zona nucleo 02") does not say it is one
          -- part of a property, and the property's page is where UNESCO maps
          -- its components (#2158).
          ${partOfFactsSql(`${alias}.id`)} AS part_of,
          -- How much the object holds, which is part of what it *is* and what every
          -- card here was missing: a text diff about one component of a serial site
          -- read as a diff about the site. UNESCO 1239 is the case — the source
          -- proposed a description of Waldsiedlung Zehlendorf, one of seven parts,
          -- and nothing on the card said the object had parts at all.
          --
          -- Both counts on every kind, reversing the narrower judgement the works
          -- total was added under ("only the two kinds whose text cites the count").
          -- That was right while the number served a refusal's sentence; it is the
          -- object's own shape now, and a fragment that answers "what is this"
          -- cannot answer it differently per card. Two indexed counts per row,
          -- 25 rows a page.
          -- Through the fragment, not spelled out: this count is what every card
          -- turns "made of N places" on, and a point a curator declared gone from the
          -- world is not one of them. Written by hand it would have counted one, which
          -- is the divergence reviewQueueContents.ts's own join already learned once,
          -- and says so where it composes the same fragment.
          --
          -- And a point is counted once while it moves (placeOfObjectSql):
          -- Ephesus, run 146, read "made of 2 places" over a 158 m correction.
          (SELECT count(*) FROM ${pointsShownSql(`${alias}.id`, 'off')}
            WHERE ${placeOfObjectSql('off')})::int
            AS offered_locations,
          (SELECT count(*) FROM experience_treasures et
            WHERE et.experience_id = ${alias}.id
              AND ${offeredLinkSql('et')})::int AS counted_works_total`;
}

/**
 * The famous works a refusal counted, named — and, below, how many there are in all.
 *
 * A refusal reads "0 of 5 famous works are paintings" and a curator's first question is
 * *which five*. They are in the catalogue already — the run imports a venue's works before
 * deciding about the venue — so the card can name them instead of asserting a number.
 * Ordered as the rule ordered them, by how widely known each work is, and capped at twelve:
 * the widest holding a refusal cites here is sixteen, so the cap almost never bites, and
 * where it does the card says how many it is not showing rather than quietly stopping.
 * `counted_works_total` is what makes that possible on a refusal whose sentence cites no
 * number of its own — a cathedral's does not, and the array alone cannot tell a holding of
 * twelve from the first twelve of thirty. It now lives in `objectContextSelectSql` above,
 * with the point count beside it: how much an object holds turned out to be part of what
 * the object *is*, needed by every card rather than by the two whose text cites it.
 *
 * The named array stays on those two kinds alone. UNESCO sites hold no works, and adding
 * the lookup to every kind would cost a join for an empty array on each one that holds
 * none.
 */
/** The best-known twelve of them, ranked, with what each one is. */
export function countedWorksSelectSql(alias = 'e'): string {
  // `row_number()` rather than `ORDER BY w->>'name'`: the aggregate imposes its own order on
  // what the subquery hands it, so sorting it by name would leave the LIMIT picking the
  // twelve best-known works and then present them alphabetically — and the card's own
  // headings ("less widely known", "the least widely known") would rank nothing.
  return `(SELECT jsonb_agg(w ORDER BY fame)
             FROM (SELECT jsonb_build_object(
                            'name', t.name, 'type', t.treasure_type, 'artists', t.artists,
                            'artistsCurated', t.curated_fields ? 'artists',
                            'imageUrl', t.image_url, 'year', t.year,
                            -- The works preview draws these at 48 px inside a tooltip,
                            -- with no enlargement to move the obligation onto -- unlike
                            -- the card above, which opens a dialog. So the credit has to
                            -- ride the row itself.
                            'imageCredit', t.metadata->'imageCredit',
                            -- The source's own id, so the preview can stop being a dead
                            -- end: a curator who does not recognise a work needs somewhere
                            -- to go, and this is where the work came from.
                            'externalId', t.external_id) AS w,
                          row_number() OVER (ORDER BY t.sitelinks_count DESC NULLS LAST) AS fame
                     FROM experience_treasures et
                     JOIN treasures t ON t.id = et.treasure_id
                    WHERE et.experience_id = ${alias}.id
                      -- What the run counted is what the museum holds now, and a
                      -- link the source has since stopped placing here is not
                      -- (ADR-0044) -- the same term as the total above.
                      AND ${offeredLinkSql('et')}
                    ORDER BY t.sitelinks_count DESC NULLS LAST
                    LIMIT 12) top) AS counted_works`;
}

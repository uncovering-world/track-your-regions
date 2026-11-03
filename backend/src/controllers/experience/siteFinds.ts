/**
 * What "a find of this site, on view" means, written once for the two reads
 * that ask it: the site's own list (`GET /:id/finds`, `experienceFindsController.ts`)
 * and the count a region's list carries on the site's row (`finds_count`,
 * `experienceRegionQuery.ts`, #907). The count is a promise about the list —
 * "3 finds on view" on Mycenae's row, three finds on Mycenae's card — so the
 * two are composed from these fragments and cannot disagree.
 *
 * A find is a treasure whose `metadata.foundAt` names the site's item exactly
 * (ADR-0058 decision 3), or one a curator confirmed comes from the site where
 * its item names no place of discovery (`find_site_links`, #2242), passed
 * globally (ADR-0025 decision 2), and shown at
 * a museum a reader may be sent to: the link still placed by the source
 * (ADR-0044) and passed by a curator, the museum admitted by a kind, passed
 * and still standing. A find no such museum holds is a find nobody can go and
 * see, and is neither listed nor counted.
 */

import { MEMBERSHIPS, membershipOfferedSql, rowKindJoinSql } from '../../db/membership.js';
import { WORLD_HERITAGE_KIND_ID } from '../../db/inscription.js';
import { ARCHAEOLOGY_KIND_ID } from '../../services/sync/findSiteProposals.js';
import {
  experienceOfferedToReaderSql, hideLostSql, offeredLinkSql, publishedContentSql,
} from '../../db/readerPredicates.js';

/**
 * The museums showing the treasure `find`, as a `FROM … WHERE` a caller
 * selects from: `sv` is the museum, `svk` its row's kind. The same rows are
 * the list's "shown at" and the count's evidence that the find is on view.
 */
export function venuesShowingSql(find: string): string {
  return `FROM experience_treasures sl
           JOIN experiences sv ON sv.id = sl.experience_id
           ${rowKindJoinSql('sv', 'svm', 'svk')}
           WHERE sl.treasure_id = ${find}.id
             -- The link: still placed by the source (ADR-0044) and passed by a
             -- curator (ADR-0025). Not widened for anyone: a link is a claim a
             -- reader acts on.
             AND ${offeredLinkSql('sl')}
             AND ${publishedContentSql('sl')}
             -- The museum: accepted by a kind, passed, and still standing.
             AND ${experienceOfferedToReaderSql('sv')}
             AND ${hideLostSql('sv')}`;
}

/**
 * The site `site` is where the treasure `find` was dug up, by the find's own
 * item: its place of discovery names the site's item exactly. A site by the
 * type only the Archaeology kind has — the item a find names is a place
 * somebody dug in, never a museum — so every other row has none. Both are
 * the Archaeology membership's: its type within the kind and the id its source
 * knows the place by, so a site another source wrote first keeps its finds
 * (ADR-0084). And that membership is offered itself: a place shown through
 * another kind is not a site a reader may be sent to for its finds.
 */
export function dugUpAtSql(site: string, find: string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} site_member
                 WHERE site_member.experience_id = ${site}.id
                   AND site_member.type = 'site'
                   AND site_member.external_id = ${find}.metadata->'foundAt'->>'qid'
                   AND ${membershipOfferedSql('site_member')})`;
}

/**
 * The treasures that are finds of the site `site` by either way (dug up there,
 * or confirmed as from there), as a set the planner joins through. A set and
 * not an `OR` of the two `EXISTS` above: Postgres pulls a sub-select up into a
 * semi-join only as a top-level `AND` term, and under an `OR` the count on a
 * region's rows scanned every treasure for every row — 10 ms became 2.9 s over
 * 3,000 rows of the development catalogue (2026-11-02). Each arm stays on its
 * index, `idx_treasures_found_at` and `idx_find_site_links_site`.
 */
function siteFindIdsSql(site: string): string {
  return `SELECT dug.id
            FROM ${MEMBERSHIPS} site_member
            JOIN treasures dug ON (dug.metadata->'foundAt'->>'qid') = site_member.external_id
           WHERE site_member.experience_id = ${site}.id
             AND site_member.type = 'site'
             AND ${membershipOfferedSql('site_member')}
          UNION
          SELECT fsl.treasure_id
            FROM find_site_links fsl
            JOIN treasures linked ON linked.id = fsl.treasure_id
           WHERE fsl.site_id = ${site}.id AND fsl.state = 'confirmed'
             -- A link stands only where the find's own item names no find
             -- spot, as on its museum's row (from_site): a spot a later run
             -- reads off the item is the find's own claim.
             AND linked.metadata->'foundAt' IS NULL`;
}

/**
 * The finds of the site `site`, as the conditions on a treasure `find`: dug
 * up there or confirmed as coming from there, passed, and shown somewhere a
 * reader may go.
 */
export function findOfSiteSql(site: string, find: string): string {
  return `${find}.id IN (${siteFindIdsSql(site)})
        AND ${publishedContentSql(find)}
        AND EXISTS (SELECT 1 ${venuesShowingSql(find)})`;
}

/**
 * The place `site` may be where a find came from (#2242): an offered World
 * Heritage membership, or an Archaeology one of type `site`. Never a museum,
 * which is where finds are shown, not where they came from — the Louvre is an
 * Archaeology museum. The client's `mayBeFindOrigin` (`utils/placeKinds.ts`)
 * decides on it whether the curation dialog asks; this is the server's word.
 */
export function mayBeFindOriginSql(site: string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} origin_member
                 WHERE origin_member.experience_id = ${site}.id
                   AND (origin_member.kind_id = ${WORLD_HERITAGE_KIND_ID}
                        OR (origin_member.kind_id = ${ARCHAEOLOGY_KIND_ID} AND origin_member.type = 'site'))
                   AND ${membershipOfferedSql('origin_member')})`;
}

/** How many finds of the site `site` are on view — the list's length, as a scalar. */
export function findsOnViewCountSql(site: string): string {
  return `(SELECT COUNT(*)::int FROM treasures sf WHERE ${findOfSiteSql(site, 'sf')})`;
}

/**
 * A find a link to a site may stand on (#2242): one a reader may see, passed
 * itself and shown by a museum a reader may be sent to, whose own item names no
 * find spot, since a link stands only there (`siteFindIdsSql`). What the place's
 * dialog lists and what the review page asks about (#2304) read it alike.
 */
export function linkableFindSql(find: string): string {
  return `${publishedContentSql(find)}
       AND EXISTS (SELECT 1 ${venuesShowingSql(find)})
       AND ${find}.metadata->'foundAt' IS NULL`;
}

/**
 * The run's proposals still open on the site `site`: a find whose own point
 * stands on it (`findSiteProposals.ts`) that no curator has answered, on a
 * place a find may come from. The review page's question (#2304), as a scalar.
 */
export function openFindProposalsSql(site: string): string {
  return `(SELECT COUNT(*)::int FROM find_site_links open_link
            JOIN treasures open_find ON open_find.id = open_link.treasure_id
           WHERE open_link.site_id = ${site}.id AND open_link.state = 'proposed'
             AND ${linkableFindSql('open_find')}
             AND ${mayBeFindOriginSql(site)})`;
}

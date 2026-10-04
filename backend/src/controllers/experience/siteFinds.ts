/**
 * What "a find of this site, on view" means, written once for the two reads
 * that ask it: the site's own list (`GET /:id/finds`, `experienceFindsController.ts`)
 * and the count a region's list carries on the site's row (`finds_count`,
 * `experienceRegionQuery.ts`, #907). The count is a promise about the list —
 * "3 finds on view" on Mycenae's row, three finds on Mycenae's card — so the
 * two are composed from these fragments and cannot disagree.
 *
 * A find is a treasure whose `metadata.foundAt` names the site's item exactly
 * (ADR-0058 decision 3), passed globally (ADR-0025 decision 2), and shown at
 * a museum a reader may be sent to: the link still placed by the source
 * (ADR-0044) and passed by a curator, the museum admitted by a kind, passed
 * and still standing. A find no such museum holds is a find nobody can go and
 * see, and is neither listed nor counted.
 */

import { MEMBERSHIPS, membershipOfferedSql, rowKindJoinSql } from '../../db/membership.js';
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
 * The finds of the site `site`, as the conditions on a treasure `find`:
 * named by the site's item, passed, and shown somewhere a reader may go. A
 * site by the type only the Archaeology kind has — the item a find names is a
 * place somebody dug in, never a museum — so every other row has none. Both are
 * the Archaeology membership's: its type within the kind and the id its source
 * knows the place by, so a site another source wrote first keeps its finds
 * (ADR-0084). And that membership is offered itself: a place shown through
 * another kind is not a site a reader may be sent to for its finds.
 */
export function findOfSiteSql(site: string, find: string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} site_member
                 WHERE site_member.experience_id = ${site}.id
                   AND site_member.type = 'site'
                   AND site_member.external_id = ${find}.metadata->'foundAt'->>'qid'
                   AND ${membershipOfferedSql('site_member')})
        AND ${publishedContentSql(find)}
        AND EXISTS (SELECT 1 ${venuesShowingSql(find)})`;
}

/** How many finds of the site `site` are on view — the list's length, as a scalar. */
export function findsOnViewCountSql(site: string): string {
  return `(SELECT COUNT(*)::int FROM treasures sf WHERE ${findOfSiteSql(site, 'sf')})`;
}

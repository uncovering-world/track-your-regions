/**
 * The Wikivoyage articles that use a place's item (#2520):
 * GET /api/experiences/review/guide-articles/:membershipId.
 *
 * A curator who reads that a guide uses a place (the crowded-city figures'
 * *In Wikivoyage*, a visit question's travel-guide witness) opens the articles
 * behind that yes. Both read the item the membership's source knows the place
 * by (`refreshCrowding`, `witnessesOfPlaces`), so this read takes the
 * membership and answers for the same item: the evidence and its articles
 * never name two items.
 *
 * The articles come from the local copy the usage build keeps
 * (`wikivoyage_articles`, a serving table, ADR-0124), never from a live
 * Wikivoyage or Wikidata call: nothing here asks a third party. An empty table
 * is a copy built before the articles were kept, since a build that keeps no
 * item fails rather than swaps in, so the read says so (`articlesKept`)
 * rather than answer an empty list a curator would take for no guide.
 *
 * Curator only, as the reads the evidence sits on are. A membership is
 * answered only where the caller may be shown its place: one readers are
 * offered, or one in the caller's scope (`shownToCallerSql`, as the parts
 * reads ask). Any other is not found, so the read does not say an unread
 * place outside the scope exists.
 */

import type { z } from 'zod/v4';
import type { GuideArticles } from '../../api/responses/guideArticles.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import { editionLanguage, wikivoyageArticleUrl } from '../../services/dumps/wikivoyage/articleUrl.js';
import type { guideArticlesParamSchema } from '../../types/guideArticlesSchema.js';
import { shownToCallerSql } from './partRecordRead.js';

/** The most articles one read lists: far more than any place's item is used by, and a bound on the answer. */
export const MOST_GUIDE_ARTICLES = 1000;

/** An item, as the build keeps one; a membership a curator made by hand has none. */
const ITEM = /^Q[1-9]\d*$/;

export async function getGuideArticles(
  { params: { membershipId }, caller }: { params: z.output<typeof guideArticlesParamSchema>; caller: Express.User },
): Promise<GuideArticles> {
  // $1 the caller, $2 the membership, $3 whether an admin asks.
  const found = await pool.query<{ item: string | null }>(
    `SELECT m.external_id AS item
       FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
      WHERE m.id = $2 AND ${shownToCallerSql('e', { user: '$1', admin: '$3::boolean' })}`,
    [caller.id, membershipId, caller.role === 'admin'],
  );
  if (found.rowCount === 0) throw notFound('Membership not found');
  const item = found.rows[0].item && ITEM.test(found.rows[0].item) ? found.rows[0].item : null;

  try {
    const [kept, listed] = await Promise.all([
      pool.query<{ kept: boolean }>('SELECT EXISTS (SELECT 1 FROM wikivoyage_articles) AS kept'),
      item === null ? null : pool.query<{ site: string; title: string }>(
        `SELECT site, title FROM wikivoyage_articles WHERE item = $1 ORDER BY site, title, page_id LIMIT $2`,
        [item, MOST_GUIDE_ARTICLES + 1],
      ),
    ]);
    const rows = listed?.rows ?? [];
    return {
      item,
      articlesKept: kept.rows[0].kept,
      articles: rows.slice(0, MOST_GUIDE_ARTICLES).map(row => ({
        site: row.site, language: editionLanguage(row.site), title: row.title, url: wikivoyageArticleUrl(row.site, row.title),
      })),
      truncated: rows.length > MOST_GUIDE_ARTICLES,
    };
  } catch (error) {
    console.error('Error reading the Wikivoyage articles of a membership:', error);
    throw failure('Failed to read the Wikivoyage articles', 500);
  }
}

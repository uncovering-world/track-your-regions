/**
 * The Wikivoyage articles that use a place's item (#2520), as a curator opens
 * them behind a guide's yes. Read only when the list is opened, from the copy
 * the server keeps, so a table of places asks nothing until a curator does.
 */

import { getExperiencesReviewGuideArticlesByMembershipId } from './client.generated';
import type { GuideArticles } from './client.generated';

// What the call answers is declared once, as a backend schema (ADR-0066).
export type { GuideArticles, GuideArticlesArticlesItem as GuideArticle } from './client.generated';

/** The articles that use the item the membership's source knows its place by. */
export function fetchGuideArticles(membershipId: number): Promise<GuideArticles> {
  return getExperiencesReviewGuideArticlesByMembershipId(membershipId);
}

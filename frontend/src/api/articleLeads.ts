/**
 * The first sentence of an asked place's English Wikipedia article (#2185), as
 * a review card shows it under its question: what the place is, in its
 * article's own words, before a curator answers whether it belongs in a kind.
 * Read when the card opens; the server keeps each article's sentence for a day.
 */

import { getExperiencesReviewArticleLeads } from './client.generated';

// What the call answers is declared once, as a backend schema (ADR-0066).
export type { ReviewArticleLeadsLeadsItem as ArticleLead } from './client.generated';
import type { ReviewArticleLeadsLeadsItem } from './client.generated';

/** The place's article and its first sentence, or null where it has none the server could read. */
export async function fetchArticleLead(placeId: number): Promise<ReviewArticleLeadsLeadsItem | null> {
  const { leads } = await getExperiencesReviewArticleLeads({ ids: String(placeId) });
  return leads.find(lead => lead.placeId === placeId) ?? null;
}

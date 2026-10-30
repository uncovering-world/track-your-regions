/**
 * What English Wikipedia says an admitted venue holds, where Wikidata says
 * nothing (ADR-0166): the items filed in the venue's collection categories,
 * read from the copy of Wikipedia's structure (`structureCollectionItems`).
 * The Code of Hammurabi names no collection on Wikidata and sits in *Near
 * Eastern and Middle Eastern antiquities in the Louvre*; the Dead Sea Scrolls
 * in *Collection of the Israel Museum*. Read by the venue-side read beside
 * what Wikidata's statements place at the venue (`readVenueSide`), and the
 * kind's own rule still decides whether what is found is its work.
 *
 * Only from the copy: asking the live API for every admitted venue's shelves
 * is a question per venue per pattern, which the dumps answer in one.
 */

import { enwikiTitleOf } from '../wikipediaCategories.js';
import { structureCollectionItems } from '../wikipediaStructure.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import type { VenueHolding } from './venueSideQueries.js';
import type { QueryRunner } from '../wikidataQueries.js';

/** A venue the read may ask about: its item and its English article, where it has one. */
export interface ArticleVenue { qid: string; articleUrl: string | null }

/** What Wikipedia files under the venues' collection categories, as holdings of those venues. */
export type ArticleHoldingsReader = (run: QueryRunner, venues: readonly ArticleVenue[]) => Promise<VenueHolding[]>;

/**
 * The reader a run passes its pipeline, or none while no copy of Wikipedia's
 * structure is built: the run then says so, since a venue whose shelves were
 * not read looks like one that holds nothing there.
 */
export async function articleHoldingsReader(logPrefix: string): Promise<ArticleHoldingsReader | undefined> {
  const built = await latestStructure();
  if (built) return readArticleHoldings;
  console.log(`${logPrefix} No copy of English Wikipedia's structure is built: what it files in a venue's collection is not read`);
  return undefined;
}

/** `ArticleHoldingsReader` over the copy of Wikipedia's structure; `run` is the door a reader may ask Wikidata through. */
export async function readArticleHoldings(_run: QueryRunner, venues: readonly ArticleVenue[]): Promise<VenueHolding[]> {
  const byTitle = new Map<string, string>();
  for (const venue of venues) {
    const title = enwikiTitleOf(venue.articleUrl);
    if (title) byTitle.set(title.replace(/ /g, '_'), venue.qid);
  }
  if (!byTitle.size) return [];
  const filed = await structureCollectionItems([...byTitle.keys()]);
  return filed.flatMap(({ item, title }) => {
    const venue = byTitle.get(title);
    // Editions are not known from the copy; the by-id read recounts them (`fetchWorksByIds`).
    return venue ? [{ work: item, venue, property: 'P276' as const, sitelinks: 0, via: 'wikipedia' as const }] : [];
  });
}

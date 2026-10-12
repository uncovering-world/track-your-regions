/**
 * The component-item finder's fourth door (#1339): the Wikipedia articles near
 * a point no other door found anything for. The Aalto Works' villa, sanatorium
 * and town hall are of classes no resolved component teaches, so the near
 * rule's class search has nothing to offer, while Wikipedia asked by place
 * holds an article about each within a few metres (the survey of #1306). The
 * article's coordinate, title and item are read, never its text.
 *
 * The editions are the site's countries' and English (`editionsFor`); the radius
 * and the name test are the near rule's (`NEAR_RADIUS_M`, `bestMatch` with
 * `wikipedia`). A point whose articles could not be read is named in `unread`,
 * so the pass keeps what this door proposed for it before.
 */

import { editionsFor } from './countryWikiEditions.js';
import { bestMatch, NEAR_RADIUS_M, type CandidateItem, type ComponentMatch, type ComponentPoint } from './componentItemMatching.js';
import { articlesNear, type QueryHooks } from './componentItemQueries.js';

interface ArticlePoint extends ComponentPoint {
  countryCodes: string[];
}

/**
 * The free articles' items near each point, one point at a time; an item a
 * point's site already holds, or any point holds, is left out.
 */
export async function articleCandidates(
  points: readonly ArticlePoint[],
  taken: ReadonlySet<string>,
  hooks: QueryHooks,
  onStage?: (message: string) => void,
): Promise<{ near: Map<number, CandidateItem[]>; unread: Set<number> }> {
  const near = new Map<number, CandidateItem[]>();
  const unread = new Set<number>();
  for (const [i, point] of points.entries()) {
    if (hooks.isCancelled?.()) break;
    onStage?.(`Asking Wikipedia near point ${i + 1} of ${points.length}`);
    try {
      const found = await articlesNear(point, editionsFor(point.countryCodes), NEAR_RADIUS_M, hooks);
      near.set(point.locationId, found.filter(c => !taken.has(c.item)));
    } catch (error) {
      if (hooks.isCancelled?.()) throw error;
      // One point's articles unread is that point's, not the pass's: the rest
      // are still asked, and this one keeps what an earlier pass proposed.
      console.warn('[Component items] %s', error instanceof Error ? error.message : String(error));
      unread.add(point.locationId);
    }
  }
  return { near, unread };
}

/** The article each point is best matched to by the near rule's test, and the points whose articles went unread. */
export async function articleMatches(
  points: readonly ArticlePoint[],
  taken: ReadonlySet<string>,
  refused: ReadonlyMap<number, ReadonlySet<string>>,
  hooks: QueryHooks,
  onStage?: (message: string) => void,
): Promise<{ matches: ComponentMatch[]; unread: Set<number> }> {
  const { near, unread } = await articleCandidates(points, taken, hooks, onStage);
  const matches = points
    .map(point => bestMatch(point, near.get(point.locationId) ?? [], 'wikipedia', refused.get(point.locationId)))
    .filter((match): match is ComponentMatch => match !== null);
  return { matches, unread };
}

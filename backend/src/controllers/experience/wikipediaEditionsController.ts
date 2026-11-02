/**
 * Which edition each English article opens in for a reader's languages
 * (#2209): GET /api/experiences/wikipedia-editions.
 *
 * The catalogue links one English article per place, part and work, and keeps
 * every edition of the item behind it (`wikipedia_editions`, written at the end
 * of every run). A reader names their languages, first choice first; each
 * article is answered with the first of them its item has an article in, and
 * an article whose item has none ahead of English is left out, so its English
 * link stands. The item is the English article's own, so a reader's language
 * never moves a link to another item's article (#1963, #1964).
 *
 * Public: a visitor who is not signed in reads in the browser's languages.
 */

import type { z } from 'zod/v4';
import type { WikipediaEditions } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { failure } from '../../middleware/errorHandler.js';
import { articleOf } from '../../services/wikipediaCoordinate.js';
import type { wikipediaEditionsQuerySchema } from '../../types/index.js';

/**
 * The edition a language names, as Wikidata's sitelinks name it: `ru` →
 * `ruwiki`, `zh-classical` → `zh_classicalwiki`. Two languages are written
 * otherwise: Norwegian Bokmål's edition is `no`, and Belarusian in the
 * Taraškievica spelling is `be_x_old`.
 */
export function wikiOfLanguage(language: string): string {
  if (language === 'nb') return 'nowiki';
  if (language === 'be-tarask') return 'be_x_oldwiki';
  return `${language.replace(/-/g, '_')}wiki`;
}

/** The address of an edition's article: `ruwiki`, `Старый музей` → `https://ru.wikipedia.org/wiki/Старый_музей`, escaped. */
export function editionUrl(wiki: string, title: string): string {
  const site = wiki.replace(/wiki$/, '');
  const host = site === 'be_x_old' ? 'be-tarask' : site.replace(/_/g, '-');
  return `https://${host}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function getWikipediaEditions(
  { query: { articles, languages } }: { query: z.output<typeof wikipediaEditionsQuerySchema> },
): Promise<WikipediaEditions> {
  // English is the link the catalogue already holds: only languages ahead of it are asked.
  const ahead = languages.slice(0, languages.includes('en') ? languages.indexOf('en') : languages.length);
  // Two spellings of one article (`Altes_Museum`, `Altes%20Museum`) are one title, and each is answered.
  const titled = new Map<string, string[]>();
  for (const article of articles) {
    const parsed = articleOf(article);
    if (parsed?.wiki === 'en') titled.set(parsed.title, [...(titled.get(parsed.title) ?? []), article]);
  }
  if (ahead.length === 0 || titled.size === 0) return { editions: [] };

  const wikis = ahead.map(wikiOfLanguage);
  let rows: Array<{ english: string; wiki: string; title: string }>;
  try {
    rows = (await pool.query<{ english: string; wiki: string; title: string }>(
      `SELECT e.title AS english, c.wiki, c.title
         FROM wikipedia_editions e
         JOIN wikipedia_editions c ON c.item = e.item AND c.wiki = ANY($2::text[])
        WHERE e.wiki = 'enwiki' AND e.title = ANY($1::text[])`,
      [[...titled.keys()], wikis],
    )).rows;
  } catch (error) {
    console.error('Error reading Wikipedia editions:', error);
    throw failure('Failed to read Wikipedia editions', 500);
  }

  const editions: WikipediaEditions['editions'] = [];
  for (const [english, spellings] of titled) {
    const held = new Map(rows.filter(row => row.english === english).map(row => [row.wiki, row.title]));
    const index = wikis.findIndex(wiki => held.has(wiki));
    if (index === -1) continue;
    const url = editionUrl(wikis[index], held.get(wikis[index])!);
    for (const article of spellings) editions.push({ article, url, language: ahead[index] });
  }
  return { editions };
}

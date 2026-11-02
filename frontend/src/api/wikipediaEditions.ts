/**
 * Which edition an English article opens in for a reader's languages (#2209),
 * asked of `GET /api/experiences/wikipedia-editions` (ADR-0073).
 *
 * A card shows one article and a museum's list shows dozens, each asked by its
 * own link. The links of one render are gathered into one request per list of
 * languages, at most a hundred articles each, so a list of works costs one
 * read, not one per row: the reads share the public read limiter with the list
 * itself.
 */

import { getExperiencesWikipediaEditions } from './client.generated';

export interface ReaderEdition {
  url: string;
  language: string;
}

const BATCH = 100;

type Waiting = { article: string; resolve: (edition: ReaderEdition | null) => void; reject: (error: unknown) => void };

const pending = new Map<string, Waiting[]>();
let scheduled = false;

async function send(languages: string, waiting: Waiting[]): Promise<void> {
  for (let start = 0; start < waiting.length; start += BATCH) {
    const batch = waiting.slice(start, start + BATCH);
    const articles = [...new Set(batch.map(entry => entry.article))];
    try {
      const { editions } = await getExperiencesWikipediaEditions({ articles, languages });
      const byArticle = new Map(editions.map(edition => [edition.article, { url: edition.url, language: edition.language }]));
      for (const entry of batch) entry.resolve(byArticle.get(entry.article) ?? null);
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }
}

function flush(): void {
  scheduled = false;
  const ready = [...pending];
  pending.clear();
  for (const [languages, waiting] of ready) void send(languages, waiting);
}

/** The article's edition in the first of `languages` its item has ahead of English, or null for its English link. */
export function fetchReaderEdition(article: string, languages: readonly string[]): Promise<ReaderEdition | null> {
  const key = languages.join(',');
  return new Promise((resolve, reject) => {
    const waiting = pending.get(key) ?? [];
    waiting.push({ article, resolve, reject });
    pending.set(key, waiting);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
}

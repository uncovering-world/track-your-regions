/**
 * Which edition an English article opens in for a reader's languages (#2209),
 * asked of `GET /api/experiences/wikipedia-editions` (ADR-0073).
 *
 * A card shows one article and a museum's list shows dozens, each asked by its
 * own link. The links of one render are gathered into one request per list of
 * languages, at most a hundred articles each, so a list of works costs one
 * read, not one per row: the reads share the public read limiter with the list
 * itself. The articles travel on the query string, so a batch is also closed
 * before its query passes `QUERY_BUDGET` (#2526): a hundred Cyrillic or
 * Japanese titles percent-encode to well past the request line a server reads,
 * and such a request is answered 431, which would send every link of the batch
 * to its English article.
 */

import { getExperiencesWikipediaEditions } from './client.generated';

export interface ReaderEdition {
  url: string;
  language: string;
}

const BATCH = 100;

/**
 * The longest query string one request carries, in encoded characters: 8 kB is
 * the tighter request-line limit in common use (nginx's default per header line,
 * where Node reads 16 kB), and the path, the languages and the method take the
 * rest of it.
 */
const QUERY_BUDGET = 7000;

/** What an article adds to the query string: `articles=`, the address as the client encodes it, and its `&`. */
function queryLength(article: string): number {
  return new URLSearchParams({ articles: article }).toString().length + 1;
}

/**
 * The articles in batches of at most a hundred, each closed before its query
 * passes the budget. An article that alone passes it still goes, by itself.
 */
function batchesOf(articles: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = 0;
  for (const article of articles) {
    const size = queryLength(article);
    if (batch.length && (batch.length === BATCH || length + size > QUERY_BUDGET)) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(article);
    length += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

type Waiting = { article: string; resolve: (edition: ReaderEdition | null) => void; reject: (error: unknown) => void };

const pending = new Map<string, Waiting[]>();
let scheduled = false;

async function send(languages: string, waiting: Waiting[]): Promise<void> {
  for (const articles of batchesOf([...new Set(waiting.map(entry => entry.article))])) {
    const asked = new Set(articles);
    const batch = waiting.filter(entry => asked.has(entry.article));
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

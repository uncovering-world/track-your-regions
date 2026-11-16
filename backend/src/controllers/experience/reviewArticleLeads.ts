/**
 * The first sentence of each asked place's English Wikipedia article, for the
 * review cards a page shows (#2185): a card opens with its question, then the
 * place itself, so a curator who does not know the Dormition Cathedral in
 * Kharkiv reads what it is before deciding whether it is a tower.
 *
 * GET /api/experiences/review/article-leads?ids=…
 *
 * Only places the caller has an open question about under their scope are read
 * (`scopedQuestionsSql`, as the map's short list names them), so an unread
 * arrival outside the scope is never read about. The leads come from
 * Wikipedia's extracts API (`articleLeads`, twenty titles an ask, the
 * register's line in `docs/tech/external-services.md`), and are kept in the
 * process for a day: a page of cards reread on every answer would otherwise ask
 * Wikipedia again for leads that have not changed. A lead Wikipedia did not
 * answer for is left out and asked again next time; the card then shows the
 * place's Wikidata description instead.
 */

import type { z } from 'zod/v4';
import type { ReviewArticleLeads } from '../../api/responses/articleLeads.js';
import { userAgent } from '../../config/userAgent.js';
import { pool } from '../../db/index.js';
import { WaitBudget } from '../../services/sync/sourceRetry.js';
import { articleLeads } from '../../services/sync/visit/visitReading.js';
import { enwikiTitleOf } from '../../services/sync/wikipediaCategories.js';
import type { reviewQueueMapNamesQuerySchema } from '../../types/index.js';
import { scopedQuestionsSql } from './reviewQueueKeys.js';

/** How long a lead read is kept before Wikipedia is asked again. */
const KEPT_MS = 24 * 60 * 60 * 1000;

/** How long a card waits for Wikipedia: a slow answer leaves the description on screen rather than holding the card. */
const CARD_WAIT_MS = 5_000;

/** The most leads kept; the oldest goes first. */
const MOST_KEPT = 5000;

/** Each article's first sentence (null: it has none), by its URL, with when it was read. */
const kept = new Map<string, { sentence: string | null; at: number }>();

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Words a period follows inside an English sentence. */
const ABBREVIATIONS = new Set([
  'st', 'mt', 'ft', 'dr', 'mr', 'mrs', 'ms', 'sr', 'jr', 'prof', 'gen', 'gov', 'rev', 'no', 'nos',
  'c', 'ca', 'approx', 'vs', 'e.g', 'i.e', 'u.s', 'u.k',
]);

/**
 * Whether a segment ends on an abbreviation or an initial, which the segmenter
 * reads as a sentence's end: "St." in "St. Peter's Basilica", "c." in a date,
 * "J." in "J. S. Bach", "U.S." in a name.
 */
function endsOnAbbreviation(text: string): boolean {
  if (!text.endsWith('.')) return false;
  const word = text.slice(text.lastIndexOf(' ') + 1, -1).replace(/^[("']/, '');
  const initial = word.length === 1 && word >= 'A' && word <= 'Z';
  return initial || ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * What the extract leaves of a pronunciation or a respelling: "Buckingham
 * Palace (UK: ) is…", once Wikipedia's plain text drops the IPA. A bracket
 * holding only such labels and punctuation goes, with the space before it.
 */
const PRONUNCIATION_LABELS = new Set(['uk', 'us', 'listen', 'pronunciation', 'pronounced', 'ipa', 'or']);

/** A letter outside the Latin script: a native name a curator reading English cannot read. */
const NOT_LATIN = /[^\p{Script=Latin}\P{L}]/u;

/**
 * A bracket the card's sentence does without: one the extract emptied of its
 * pronunciation, or one holding a native name in another script or a
 * pronunciation in square brackets — "Kyaiktiyo Pagoda (Burmese: ကျိုက်ထီးရိုးဘုရား
 * pronounced [tɕaɪʔtʰíjó pʰəjá] …) is…". A bracket in Latin script stays, and
 * so does one with a year: "(German: Lötschberg-Basistunnel)", "(1883)".
 */
function withoutNoisyBrackets(text: string): string {
  return text.replace(/ ?\(([^()]*)\)/g, (bracket, inside: string) => {
    if (NOT_LATIN.test(inside) || inside.includes('[')) return '';
    // A year or a span of years is a fact the curator reads: "(1883)", "(1453–1934)".
    if (/\p{N}/u.test(inside)) return bracket;
    const words = inside.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    return words.every(word => PRONUNCIATION_LABELS.has(word)) ? '' : bracket;
  });
}

/** The first sentence of a lead, or null where it holds none. */
export function firstSentence(lead: string | null): string | null {
  if (!lead) return null;
  let sentence = '';
  for (const { segment } of sentences.segment(withoutNoisyBrackets(lead.trim()))) {
    sentence += segment;
    if (!endsOnAbbreviation(sentence.trimEnd())) break;
  }
  return sentence.trim() || null;
}

/** The reads under way, by article URL: a card asking for one already asked waits on it rather than asking again. */
const reading = new Map<string, Promise<void>>();

/** Keep the first sentence of each article Wikipedia answered for. */
function keep(urls: string[], read: Map<string | null, string | null>, now: number): void {
  for (const url of urls) {
    if (!read.has(url)) continue;
    kept.delete(url);
    kept.set(url, { sentence: firstSentence(read.get(url) ?? null), at: now });
  }
}

/**
 * Ask Wikipedia for the articles' leads and keep their first sentences when
 * the answer comes, however late; a failed ask keeps nothing and never rejects.
 */
function askAndKeep(urls: string[], now: number): Promise<void> {
  return articleLeads(urls, { userAgent: userAgent(), timeoutMs: CARD_WAIT_MS }, new WaitBudget(0))
    .then(read => keep(urls, read, now), () => undefined);
}

/**
 * Wait for the reads at most `CARD_WAIT_MS` in all, a turn held behind another
 * Wikimedia read included, so the card falls back to the source's description
 * in time; the reads themselves go on, and keep what they bring.
 */
async function waitAtMost(reads: Promise<void>[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, CARD_WAIT_MS); });
  try {
    await Promise.race([Promise.all(reads), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** An article's first sentence while it is kept, and null once it is older than a day or was never read. */
function keptSentence(url: string, now: number): string | null {
  const known = kept.get(url);
  return known && now - known.at <= KEPT_MS ? known.sentence : null;
}

/**
 * The first sentences of the articles not kept yet or kept too long, read and
 * kept. A read stays under way until Wikipedia answers or fails, past the
 * card's deadline, so a card opened meanwhile waits on it rather than asking
 * Wikipedia again while it may be holding callers back.
 */
async function readMissing(urls: string[], now: number): Promise<void> {
  const stale = urls.filter(url => {
    const known = kept.get(url);
    return !known || now - known.at > KEPT_MS;
  });
  const waiting = [...new Set(stale.flatMap(url => reading.get(url) ?? []))];
  const missing = stale.filter(url => !reading.has(url));
  if (missing.length > 0) {
    // Answered or failed, the read stops being under way, so a failed one is asked again next time.
    const asked: Promise<void> = askAndKeep(missing, now).then(() => {
      for (const url of missing) if (reading.get(url) === asked) reading.delete(url);
    });
    for (const url of missing) reading.set(url, asked);
    waiting.push(asked);
  }
  await waitAtMost(waiting);
  for (const oldest of kept.keys()) {
    if (kept.size <= MOST_KEPT) break;
    kept.delete(oldest);
  }
}

/** Forget every lead kept; for the specs, which read the same articles under different answers. */
export function forgetArticleLeads(): void {
  kept.clear();
  reading.clear();
}

export async function getReviewArticleLeads(
  { query, caller }: { query: z.output<typeof reviewQueueMapNamesQuerySchema>; caller: Express.User },
): Promise<ReviewArticleLeads> {
  const params: unknown[] = [caller.id];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const scoped = scopedQuestionsSql(caller.role === 'admin', { showAside: true }, bind);
  const { rows } = await pool.query<{ placeId: number; url: string }>(
    `${scoped.sql}
SELECT DISTINCT ON (k.id) k.id AS "placeId", e.metadata->>'wikipediaUrl' AS url
FROM scoped k JOIN experiences e ON e.id = k.id
WHERE k.id = ANY(${bind(query.ids)}::int[]) AND e.metadata->>'wikipediaUrl' IS NOT NULL
ORDER BY k.id`,
    params,
  );
  const titled = rows.flatMap(row => {
    const title = enwikiTitleOf(row.url);
    return title ? [{ ...row, title }] : [];
  });
  await readMissing([...new Set(titled.map(row => row.url))], Date.now());
  // Read the clock again: a sentence kept a day ago whose refresh failed is out of date, not current.
  const now = Date.now();
  return {
    leads: titled.flatMap(({ placeId, url, title }) => {
      const sentence = keptSentence(url, now);
      return sentence ? [{ placeId, title, url, sentence }] : [];
    }),
  };
}

/**
 * What English Wikipedia says an article is *about*, read as its categories.
 *
 * Wikidata types the Louvre `archaeological museum` and says nothing of the
 * kind about the British Museum, the Pergamon, the Bardo or the Museo del Oro
 * — the class tree is silent about half the canon. The category on the article
 * is not: `Archaeological museums in London` sits on the British Museum,
 * `Egyptological collections in Russia` on the Hermitage. That editorial line
 * is the second signal ADR-0058 decision 2 reads a museum's nature off, and
 * this module is the one door to it — titles in, categories out, no
 * archaeology here. Which categories mean what stays in
 * `archaeology/classes.ts`, so a second kind asks this door rather than
 * writing a second client with its own set of mistakes.
 *
 * POST rather than GET, which is not a style choice: fifty titles in a query
 * string is kilobytes, and the Action API answers a long URL with an HTTP 414
 * — the trap the readership measurement fell into. A batch lost that way would
 * read as museums that are not archaeological, so one that cannot be read
 * throws rather than coming back empty.
 */

import {
  withRetries, abortOn, exponentialBackoff, backoffFromRetryAfter, RetrySignal, WaitBudget,
} from './sourceRetry.js';
import { isStorableHttpUrl } from '../../types/urlSafety.js';

const LOG_PREFIX = '[Wikipedia]';
const ENWIKI_API = 'https://en.wikipedia.org/w/api.php';
const ENWIKI_HOST = 'en.wikipedia.org';
const ARTICLE_PATH = '/wiki/';

/** The API's documented ceiling for a titles list, and the whole of a batch's limit. */
const TITLE_BATCH = 50;

/** Far past what a batch of fifty articles can need, and short of forever. */
const MAX_ASKS_PER_BATCH = 10;

/**
 * The Commons client's patience, mirrored rather than shared: `imageCredit.ts`
 * declares these as module constants and exports none of them. Identical on
 * purpose — one Wikimedia Action API having a bad day looks like another — and
 * the budget is the fifteen minutes every source run gets
 * (`SPARQL_WAIT_BUDGET_MS`), spelled here because this is not SPARQL.
 */
const CATEGORY_TIMEOUT_MS = 30000;
const CATEGORY_MAX_RETRIES = 4;
const CATEGORY_BACKOFF_CEILING_MS = 60000;
const CATEGORY_WAIT_BUDGET_MS = 900000;

/** Everything the question asks for except the titles and a continuation. */
const CATEGORY_QUERY: Record<string, string> = {
  action: 'query', prop: 'categories', clshow: '!hidden', cllimit: 'max',
  redirects: '1', format: 'json', formatversion: '2',
};

/** A page the API has no article for carries `missing` and no categories, so an empty list falls out. */
interface CategoryPage { title?: string; missing?: boolean; categories?: { title?: string }[] }
interface TitleHop { from: string; to: string }

interface CategoryAnswer {
  query?: {
    /** An array under `formatversion=2`, an object keyed by page id under version 1. */
    pages?: CategoryPage[] | Record<string, CategoryPage>;
    redirects?: TitleHop[];
    normalized?: TitleHop[];
  };
  continue?: Record<string, string>;
  /** The Action API's way of saying no inside an HTTP 200. */
  error?: { code?: string; info?: string };
}

export interface CategoryOptions {
  userAgent: string;
  isCancelled?: () => boolean;
  pause?: () => Promise<void>;
  /** The door, for the test; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

async function handleHttpError(response: Response, attempt: number): Promise<never> {
  const text = await response.text();
  if (attempt < CATEGORY_MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RetrySignal(
      backoffFromRetryAfter(retryAfter, attempt, CATEGORY_BACKOFF_CEILING_MS),
      `Wikipedia ${response.status}`,
    );
  }
  throw new Error(`Wikipedia API error ${response.status}: ${text.substring(0, 300)}`);
}

/**
 * What is worth another attempt: a timeout, a dropped connection, and the
 * statuses `handleHttpError` already turned into a signal. A body that will not
 * parse is not — the Commons client reads its errors the same way, and a wiki
 * answering HTML answers HTML again a minute later.
 */
function classify(error: unknown, attempt: number, retries: number): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  if (attempt < retries && (isAbort || error instanceof TypeError)) {
    return new RetrySignal(
      exponentialBackoff(attempt, CATEGORY_BACKOFF_CEILING_MS),
      isAbort ? 'Wikipedia timeout' : 'Wikipedia network error',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Which of the API's own refusals are worth waiting out: `maxlag` is the
 * replication lag every Wikimedia API asks a bot to back off on, and
 * `internal_api_error_*` is their 500 wearing a 200.
 */
function isRetriableApiError(code: string): boolean {
  return code === 'maxlag' || code.startsWith('internal_api_error');
}

/**
 * A 200 that answers nothing, caught rather than read as an answer.
 *
 * The Action API says no inside a 200: an `error` object, or a body with no
 * `query` in it at all. Either one, taken at face value, is fifty museums with
 * no categories — which is fifty museums this kind refuses — on a run whose log
 * said success. That is the silent refusal this module exists to prevent, so it
 * is an error like any other and the retriable codes wait like a 503.
 */
function failOnApiError(answer: CategoryAnswer, attempt: number): void {
  const { code, info } = answer.error ?? {};
  if (code ?? info) {
    if (attempt < CATEGORY_MAX_RETRIES && code && isRetriableApiError(code)) {
      throw new RetrySignal(
        exponentialBackoff(attempt, CATEGORY_BACKOFF_CEILING_MS), `Wikipedia ${code}`,
      );
    }
    throw new Error(`Wikipedia API said ${code ?? 'no'}: ${info ?? 'no reason given'}`);
  }
  if (!answer.query) throw new Error('Wikipedia answered without a query, so without categories');
}

async function askWikipedia(
  titles: string[], cont: Record<string, string>, options: CategoryOptions, attempt: number,
): Promise<CategoryAnswer> {
  const body = new URLSearchParams({ ...CATEGORY_QUERY, titles: titles.join('|'), ...cont });
  const { signal, release } = abortOn(CATEGORY_TIMEOUT_MS, options.isCancelled);
  try {
    const response = await (options.fetchImpl ?? fetch)(ENWIKI_API, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': options.userAgent,
      },
      body,
      signal,
    });
    if (!response.ok) await handleHttpError(response, attempt);
    let answer: CategoryAnswer;
    try {
      answer = await response.json() as CategoryAnswer;
    } catch {
      throw new Error('Wikipedia answered with something that is not JSON');
    }
    failOnApiError(answer, attempt);
    return answer;
  } finally {
    release();
  }
}

/** One request, retried; a failure names the batch, so a run says which museums it lost. */
async function askBatch(
  titles: string[], cont: Record<string, string>, options: CategoryOptions, budget: WaitBudget,
): Promise<CategoryAnswer> {
  try {
    return await withRetries((attempt) => askWikipedia(titles, cont, options, attempt), {
      logPrefix: LOG_PREFIX, retries: CATEGORY_MAX_RETRIES, budget,
      isCancelled: options.isCancelled, classify,
    });
  } catch (error) {
    if (options.isCancelled?.()) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${LOG_PREFIX} the batch of ${titles.length} from "${titles[0]}" could not be read: ${message}`,
    );
  }
}

/** Both shapes of `query.pages`, so a `formatversion` that does not take is not silence. */
function pagesOf(answer: CategoryAnswer): CategoryPage[] {
  const pages = answer.query?.pages;
  if (!pages) return [];
  return Array.isArray(pages) ? pages : Object.values(pages);
}

/**
 * The answered title back to the titles that were asked for. A title travels
 * twice — the API normalises it (underscores to spaces, first letter
 * capitalised) and then follows a redirect, reporting each hop separately — so
 * both are walked in that order and a page answered under `British Museum`
 * still lands under `british_museum`.
 *
 * A list rather than one name, because two asked titles can arrive at the same
 * article — `British_Museum` and `British Museum` normalise together, and a
 * redirect joins any two names for one museum. The API then answers once, and
 * a map holding a single name would leave the other title looking like a
 * museum with no categories, which is a museum this kind refuses.
 */
function askedTitles(titles: string[], answer: CategoryAnswer): Map<string, string[]> {
  const asked = new Map(titles.map((title) => [title, [title]]));
  for (const hop of [...(answer.query?.normalized ?? []), ...(answer.query?.redirects ?? [])]) {
    const original = asked.get(hop.from);
    if (original) asked.set(hop.to, [...(asked.get(hop.to) ?? []), ...original]);
  }
  return asked;
}

/** The categories of one page, in the words a caller matches on. */
function categoryNames(page: CategoryPage): string[] {
  const names: string[] = [];
  for (const category of page.categories ?? []) {
    const name = category.title?.replace(/^Category:/, '');
    if (name) names.push(name);
  }
  return names;
}

/** One answer's pages folded into the map, each under the titles that were asked for. */
function foldPages(titles: string[], answer: CategoryAnswer, into: Map<string, string[]>): void {
  const asked = askedTitles(titles, answer);
  for (const page of pagesOf(answer)) {
    if (!page.title) continue;
    const keys = asked.get(page.title);
    if (!keys) {
      // A page no hop leads back to. Filing it under its own name would put
      // categories beside a key nobody asked for while the asked title kept its
      // empty list — two wrong answers instead of one. Said out loud instead.
      console.warn(`${LOG_PREFIX} answered about "${page.title}", which was not asked for`);
      continue;
    }
    const names = categoryNames(page);
    // Appended, never replaced: a continuation carries the rest of the same
    // page's categories, and a museum reading as not archaeological because
    // its second answer overwrote its first is the bug this kind cannot see.
    for (const key of keys) {
      into.set(key, [...(into.get(key) ?? []), ...names]);
    }
  }
}

/** One batch of titles, asked as many times as its continuations require. */
async function readBatch(
  titles: string[], options: CategoryOptions, budget: WaitBudget, into: Map<string, string[]>,
): Promise<void> {
  let cont: Record<string, string> | undefined = {};
  let asks = 0;
  while (cont) {
    const answer: CategoryAnswer = await askBatch(titles, cont, options, budget);
    asks += 1;
    foldPages(titles, answer, into);
    // Everything in `continue` goes back, which is what the API asks for:
    // `clcontinue` is the page of categories, `continue` the marker beside it.
    cont = answer.continue && Object.keys(answer.continue).length > 0 ? answer.continue : undefined;
    // Fifty articles cannot hold `cllimit=max` categories ten times over, so a
    // batch *still continuing* here is a source repeating itself — and a loop
    // driven by somebody else's answer is a run that never finishes. Asked of
    // `cont` and not of the count alone: a batch that finished on its tenth
    // answer finished, and throwing there would lose what it had just read.
    if (cont && asks >= MAX_ASKS_PER_BATCH) {
      throw new Error(`${LOG_PREFIX} "${titles[0]}" continues without end`);
    }
    if (options.pause) await options.pause();
  }
  console.log(`${LOG_PREFIX} ${titles.length} articles from "${titles[0]}" in ${asks} request(s)`);
}

/**
 * enwiki titles → their non-hidden categories (without the "Category:" prefix),
 * 50 titles a request. Every title asked for comes back, with an empty list
 * where the article carries no category or the API has no such page — absence
 * from the map means the caller never asked, never that an answer went missing.
 */
export async function fetchWikipediaCategories(
  titles: string[], options: CategoryOptions,
): Promise<Map<string, string[]>> {
  const wanted = [...new Set(titles.filter((title) => title.trim().length > 0))];
  const categories = new Map<string, string[]>(wanted.map((title) => [title, []]));
  const budget = new WaitBudget(CATEGORY_WAIT_BUDGET_MS);
  for (let start = 0; start < wanted.length; start += TITLE_BATCH) {
    await readBatch(wanted.slice(start, start + TITLE_BATCH), options, budget, categories);
  }
  return categories;
}

/**
 * The enwiki title of a `https://en.wikipedia.org/wiki/…` article URL, decoded;
 * null for another wiki. That is the shape a Wikidata sitelink answers with and
 * the host is the only one that counts — a French article says nothing about
 * what an English category calls a museum. The path is read off `new URL`,
 * which drops the fragment a section link carries.
 *
 * Which protocols count is `isStorableHttpUrl`'s answer rather than a second
 * spelling of it: `http:` as well as `https:` is what a row is allowed to hold,
 * and an article URL a curator typed without the s is still that article —
 * refusing it here would be a museum with no categories, which is a museum the
 * rule refuses. Nothing is fetched from this URL; only the title is taken.
 */
export function enwikiTitleOf(articleUrl: string | null): string | null {
  if (!articleUrl || !isStorableHttpUrl(articleUrl)) return null;
  try {
    const parsed = new URL(articleUrl);
    if (parsed.hostname !== ENWIKI_HOST) return null;
    if (!parsed.pathname.startsWith(ARTICLE_PATH)) return null;
    return decodeURIComponent(parsed.pathname.slice(ARTICLE_PATH.length))
      .replace(/_/g, ' ').trim() || null;
  } catch {
    // Not a URL at all, or a percent sign that is not an escape: not a title either way.
    return null;
  }
}

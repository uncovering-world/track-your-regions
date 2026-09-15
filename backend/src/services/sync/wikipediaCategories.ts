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
 *
 * The same door read the other way round — who is filed *under* a category —
 * is `wikipediaCategoryMembers.ts`, a module of its own so neither question has
 * to be read past to follow the other. It sends its requests through this
 * file's transport rather than a second copy of it: one endpoint, one retry
 * rule, one wording for a refusal.
 */

import {
  withRetries, abortOn, exponentialBackoff, backoffFromRetryAfter, RetrySignal, WaitBudget,
  type SourceWait,
} from './sourceRetry.js';
import { isStorableHttpUrl } from '../../types/urlSafety.js';

/** Exported for the walk next door, so both questions log under one name. */
export const LOG_PREFIX = '[Wikipedia]';
const ENWIKI_API = 'https://en.wikipedia.org/w/api.php';
const ENWIKI_HOST = 'en.wikipedia.org';
const ARTICLE_PATH = '/wiki/';

/** The API's documented ceiling for a titles list, and the whole of a batch's limit. */
const TITLE_BATCH = 50;

/**
 * How many times one question may be asked before the run stops believing the
 * answers: far past what a question can need — fifty articles' categories, or
 * five hundred members of a category, ten times over — and short of forever.
 *
 * Ten asks of `cmlimit: max` is about five thousand articles of one category.
 * The walk of 2026-09-13 read 1,148 articles under 121 categories, the largest
 * of them well inside one ask, so the cap is far from anything real; a category
 * that reached it would be a source repeating itself rather than a long list,
 * which is why hitting it ends the run (`nextContinuation`) instead of
 * truncating the answer — a walk that stopped early and said nothing is a
 * country's museums missing from a run whose log said success (#887).
 */
const MAX_ASKS_PER_QUESTION = 10;

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
/** Exported so the walk next door waits exactly as long, on a budget of its own. */
export const CATEGORY_WAIT_BUDGET_MS = 900000;

/** Everything the question asks for except the titles and a continuation. */
const CATEGORY_QUERY: Record<string, string> = {
  action: 'query', prop: 'categories', clshow: '!hidden', cllimit: 'max',
  redirects: '1', format: 'json', formatversion: '2',
};

/** A page the API has no article for carries `missing` and no categories, so an empty list falls out. */
export interface CategoryPage {
  title?: string;
  missing?: boolean;
  categories?: { title?: string }[];
  /** Which Wikidata item the article is about, where the question asked for it. */
  pageprops?: { wikibase_item?: string };
}
interface TitleHop { from: string; to: string }

export interface CategoryAnswer {
  query?: {
    /** An array under `formatversion=2`, an object keyed by page id under version 1. */
    pages?: CategoryPage[] | Record<string, CategoryPage>;
    redirects?: TitleHop[];
    normalized?: TitleHop[];
    /** What a `list=categorymembers` question answers with: the members themselves. */
    categorymembers?: { title?: string }[];
  };
  continue?: Record<string, string>;
  /** The Action API's way of saying no inside an HTTP 200. */
  error?: { code?: string; info?: string };
}

export interface CategoryOptions {
  userAgent: string;
  isCancelled?: () => boolean;
  pause?: () => Promise<void>;
  /**
   * Called before each wait, for a caller with somewhere to show it — the shape
   * `SparqlOptions` uses, so a run reports a Wikipedia wait exactly as it
   * reports a Wikidata one (`wikidataDoor`). Without it a run held up by a 429
   * with a three-minute `Retry-After` goes on showing its last phase line, and
   * an admin watching cannot tell waiting from hung (#886).
   */
  onWait?: (wait: SourceWait) => void;
  /**
   * How much waiting the whole *run* has left, shared across every question it
   * asks — Wikipedia's and Wikidata's alike. Without it each call minted a
   * budget of its own, so a run could wait far longer in total than the number
   * any one of them was held to. A fresh `CATEGORY_WAIT_BUDGET_MS` where none is
   * given, which is what keeps a test and a one-off caller working.
   */
  budget?: WaitBudget;
  /** The door, for the test; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Which wiki to ask; English Wikipedia unless a caller names another. The
   * article resolver (`wikipediaArticles.ts`, #895) asks the wiki an
   * OpenStreetMap tag names — `tr:` for Nemrut's tumulus — through this same
   * transport, and every other caller reads the English categories.
   */
  endpoint?: string;
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
 * A 200 that says no, caught rather than read as an answer.
 *
 * The Action API refuses inside a 200, with an `error` object. Taken at face
 * value that is fifty museums with no categories — which is fifty museums this
 * kind refuses — on a run whose log said success. That is the silent refusal
 * this module exists to prevent, so it is an error like any other and the
 * retriable codes wait like a 503.
 *
 * What it does *not* judge is an answer with no `query` at all. For a batch of
 * titles that is the same silence and the caller says so
 * (`readBatch`); for a category with no articles in it, it is the whole truth —
 * the live API answers a generator that matched nothing exactly that way.
 */
function failOnApiError(answer: CategoryAnswer, attempt: number): void {
  const { code, info } = answer.error ?? {};
  if (!(code ?? info)) return;
  if (attempt < CATEGORY_MAX_RETRIES && code && isRetriableApiError(code)) {
    throw new RetrySignal(
      exponentialBackoff(attempt, CATEGORY_BACKOFF_CEILING_MS), `Wikipedia ${code}`,
    );
  }
  throw new Error(`Wikipedia API said ${code ?? 'no'}: ${info ?? 'no reason given'}`);
}

/** A redirect's target, when it is another Wikipedia host; a refusal when it is not. */
function redirectedWikipedia(response: Response, from: string): string | null {
  if (![301, 302, 307, 308].includes(response.status)) return null;
  const location = response.headers.get('location');
  if (!location) throw new Error(`Wikipedia answered ${response.status} with no location`);
  const target = new URL(location, from);
  if (!target.hostname.endsWith('.wikipedia.org')) {
    throw new Error(`Wikipedia answered with a redirect to ${target.hostname}, which is not Wikipedia`);
  }
  return target.toString();
}

/**
 * One POST, with a redirect to another Wikipedia host followed **as a POST**.
 *
 * A wiki's code is not always its host: `yue.wikipedia.org` answers 301 to
 * `zh-yue.wikipedia.org` (2026-09-15), and a transparent redirect turns the
 * POST into a GET with no body, which the API answers with a page rather
 * than JSON. So the redirect is taken by hand, once, and only onto another
 * `*.wikipedia.org` host — a redirect anywhere else is refused by name.
 */
async function postWikipedia(
  endpoint: string, body: URLSearchParams, options: CategoryOptions, signal: AbortSignal,
): Promise<Response> {
  const send = (url: string) => (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': options.userAgent,
    },
    body,
    signal,
    redirect: 'manual',
  });
  const first = await send(endpoint);
  const target = redirectedWikipedia(first, endpoint);
  return target ? send(target) : first;
}

async function askWikipedia(
  params: Record<string, string>, options: CategoryOptions, attempt: number,
): Promise<CategoryAnswer> {
  const body = new URLSearchParams(params);
  const { signal, release } = abortOn(CATEGORY_TIMEOUT_MS, options.isCancelled);
  try {
    const response = await postWikipedia(options.endpoint ?? ENWIKI_API, body, options, signal);
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

/**
 * One request, retried; a failure names what was being read, so a run says what
 * it lost rather than how many bytes it did not get.
 *
 * Exported for the members walk next door: both questions go to the same
 * endpoint under the same retry rule and the same patience, and a second copy
 * of this would be a second way for a lost answer to read as a fact.
 */
export async function askWikipediaOnce(
  params: Record<string, string>, options: CategoryOptions, budget: WaitBudget, what: string,
): Promise<CategoryAnswer> {
  try {
    return await withRetries((attempt) => askWikipedia(params, options, attempt), {
      logPrefix: LOG_PREFIX, retries: CATEGORY_MAX_RETRIES, budget,
      isCancelled: options.isCancelled, onWait: options.onWait, classify,
    });
  } catch (error) {
    if (options.isCancelled?.()) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${LOG_PREFIX} ${what} could not be read: ${message}`);
  }
}

/**
 * The continuation to send back, or nothing where the answer was the last one.
 *
 * Everything in `continue` goes back, which is what the API asks for:
 * `clcontinue` is the page of categories, `gcmcontinue` the page of members,
 * and `continue` the marker beside either. The cap is about a source that will
 * not stop rather than about a long question — a loop driven by somebody else's
 * answer is a run that never finishes — and it is asked of the continuation and
 * not of the count alone: a question that finished on its tenth answer
 * finished, and throwing there would lose what it had just read.
 *
 * A question that reaches the cap says so by name and by number, in the log and
 * in the error the run fails with: "continues without end" alone left an admin
 * to guess which category, how many asks and whether the limit was ours or
 * Wikipedia's (#887).
 */
export function nextContinuation(
  answer: CategoryAnswer, asks: number, what: string,
): Record<string, string> | undefined {
  const cont = answer.continue && Object.keys(answer.continue).length > 0
    ? answer.continue : undefined;
  if (cont && asks >= MAX_ASKS_PER_QUESTION) {
    const said = `${what} still continues after ${asks} asks, this run's cap`;
    console.log(`${LOG_PREFIX} ${said} — stopping rather than reading on`);
    throw new Error(`${LOG_PREFIX} ${said}`);
  }
  return cont;
}

/** Both shapes of `query.pages`, so a `formatversion` that does not take is not silence. */
export function pagesOf(answer: CategoryAnswer): CategoryPage[] {
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
 *
 * Exported for the article resolver (`wikipediaArticles.ts`, #895), which
 * walks the same hops back for the same reason: two tags that normalise
 * together are two objects, and both are filed under the item.
 */
export function askedTitles(titles: string[], answer: CategoryAnswer): Map<string, string[]> {
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
  const what = `the batch of ${titles.length} from "${titles[0]}"`;
  while (cont) {
    const answer: CategoryAnswer = await askWikipediaOnce(
      { ...CATEGORY_QUERY, titles: titles.join('|'), ...cont }, options, budget, what,
    );
    asks += 1;
    // A batch answered with no `query` at all is every one of its museums read
    // as category-less, which is every one of them refused: the silent refusal
    // this module exists to prevent, so it is an error like a 400 is.
    if (!answer.query) {
      throw new Error(`${LOG_PREFIX} ${what}: Wikipedia answered without a query, so without categories`);
    }
    foldPages(titles, answer, into);
    cont = nextContinuation(answer, asks, `"${titles[0]}"`);
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
  const budget = options.budget ?? new WaitBudget(CATEGORY_WAIT_BUDGET_MS);
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

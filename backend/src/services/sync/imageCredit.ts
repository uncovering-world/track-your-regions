/**
 * Who took the picture, and under what licence we are allowed to show it.
 *
 * The catalogue displays 1590 photographs it does not host: 1260 served from
 * `whc.unesco.org` and 330 from Wikimedia Commons. Every one of them was taken
 * by somebody, most under a licence whose whole condition is that the somebody
 * is named — CC BY and CC BY-SA between them cover the Commons set — and until
 * now the catalogue named nobody. That is not a rendering gap; it is the one
 * obligation those licences impose, and UNESCO's syndication terms ask for the
 * same in their own words.
 *
 * Both sources hand the credit over for free once asked:
 *
 *   - UNESCO's export carries `main_image_author` (1196 of 1273 records) and
 *     `main_image_copyright` (1216) beside the image URL. Two more field names
 *     in the `select` and nothing else changes.
 *   - Commons answers `extmetadata` for up to 50 files in one request, which
 *     covers our 330 in seven — with `Artist`, `LicenseShortName` and
 *     `LicenseUrl` for each.
 *
 * `Artist` arrives as HTML, because it is a wiki field. It is reduced to text
 * here rather than in the browser: it is stored, so it would otherwise be
 * user-supplied markup sitting in our database waiting for the one component
 * that renders something without escaping it.
 */

import {
  withRetries,
  abortOn,
  exponentialBackoff,
  backoffFromRetryAfter,
  RetrySignal,
  WaitBudget,
  type SourceWait,
} from './sourceRetry.js';
import { pool } from '../../db/index.js';

const LOG_PREFIX = '[Image Credit]';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_FILE_PAGE = 'https://commons.wikimedia.org/wiki/';
const FILE_PATH_PATH = '/wiki/Special:FilePath/';

/** The hosts that actually serve Commons files; anything else is somebody else's server. */
const COMMONS_HOSTS = new Set(['commons.wikimedia.org', 'commons.m.wikimedia.org']);

/** Their documented ceiling for a titles list, and what the 330 files cost: seven requests. */
const TITLE_BATCH = 50;
const CREDIT_TIMEOUT_MS = 30000;
const CREDIT_MAX_RETRIES = 4;
const CREDIT_BACKOFF_CEILING_MS = 60000;

/** Long enough that a name is a name; short enough that a wiki template is not a paragraph. */
const CREDIT_MAX_CHARS = 200;
/** What is even scanned: a credit hiding past 2 kB of markup is not a credit. */
const CREDIT_INPUT_MAX_CHARS = 2000;

/**
 * A credit as the database holds it: the names, and which picture they are for.
 *
 * The URL is the load-bearing half. A credit belongs to one photograph, so
 * reusing a stored one is only safe while the row still shows the same file.
 */
export interface StoredCredit {
  credit: ImageCredit | null;
  /** Whether the row carries the key at all, which is not the same as carrying a value. */
  hasCredit: boolean;
  imageUrl: string | null;
  /**
   * Whether a curator owns the picture.
   *
   * A run that does not own the picture must not write a credit for it: the
   * upsert would keep the curator's `image_url` and take the source's
   * photographer, which is the mismatch the whole feature is against.
   */
  imageClaimed: boolean;
}

/** What the line under a picture needs, and nothing else. */
export interface ImageCredit {
  /** The photographer or uploader, as plain text. */
  author: string | null;
  /** The licence in the words its own name uses: "CC BY-SA 3.0", "Public domain". */
  license: string | null;
  licenseUrl: string | null;
  /** Where the full terms live — the file page on Commons, or the site's own page. */
  detailsUrl: string | null;
}

/**
 * The Commons file name inside a `Special:FilePath` URL, or null for anything else.
 *
 * That is the shape `wdt:P18` answers with, and the file page is the same name
 * under a different prefix — so a credit link needs no second question.
 */
export function commonsFileName(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // The **host**, not just the path. While the only caller was a sync reading
  // `wdt:P18` the path alone was safe, because that property answers with
  // Commons and nothing else. A curator may now type the URL, and
  // `https://my-blog.example/wiki/Special:FilePath/Mona_Lisa.jpg` would
  // otherwise be asked about on Commons and credited to the photographer of a
  // picture nobody is looking at — the one thing this feature promises never to
  // do.
  if (!COMMONS_HOSTS.has(parsed.hostname)) return null;
  if (!parsed.pathname.startsWith(FILE_PATH_PATH)) return null;
  const encoded = parsed.pathname.slice(FILE_PATH_PATH.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded).replace(/_/g, ' ');
  } catch {
    // A malformed escape is not worth failing a run over; the picture still shows.
    return null;
  }
}

/** The human-readable page where a Commons file's licence and author are stated. */
export function commonsFilePage(url: string | null | undefined): string | null {
  const name = commonsFileName(url);
  return name ? `${COMMONS_FILE_PAGE}File:${encodeURIComponent(name.replace(/ /g, '_'))}` : null;
}

/**
 * The entities a wiki text field actually carries, decoded in **one** pass.
 *
 * One pass and not a chain of replacements, which is what this was and what
 * CodeQL called a double-unescape (js/double-escaping) on the first run of this
 * branch. A chain re-reads its own output: `&amp;lt;` becomes `&lt;` when the
 * ampersand is decoded, and the next replacement then turns that into `<`. So
 * `&amp;lt;b&amp;gt;` — a wiki page displaying the literal text `<b>` — came out
 * as real markup this function had just finished stripping. A single scan with a
 * lookup cannot do that: the `&` it writes is behind the cursor.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#039;': "'",
};

/**
 * A wiki HTML field as text.
 *
 * Tags dropped, entities decoded, whitespace collapsed, and the result bounded:
 * an `Artist` field can be a whole template with a table in it, and a credit
 * line is one line. Each pattern is anchored on a character class that cannot
 * cross its own delimiter, so none of them can backtrack.
 */
export function creditText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    // Bounded before anything scans it: the field is somebody else's wiki markup
    // and the answer is one line either way, so the work is capped by
    // construction rather than by trusting each pattern to stay linear.
    .slice(0, CREDIT_INPUT_MAX_CHARS)
    // eslint-disable-next-line sonarjs/slow-regex -- negated class `[^>]*` cannot match past `>`, so the quantifier is committed and cannot backtrack across tag boundaries; the input is capped above regardless
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#0?39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > CREDIT_MAX_CHARS ? `${text.slice(0, CREDIT_MAX_CHARS).trimEnd()}…` : text;
}

/**
 * A URL only if it is one somebody may safely be sent to.
 *
 * An allowlist of two schemes rather than a blacklist of the dangerous ones:
 * `LicenseUrl` is a field on a wiki page that anybody may edit, it is stored
 * here and later rendered as an `href`, and `javascript:` is only the best-known
 * of the schemes a blacklist has to remember. `Artist` two functions above is
 * reduced to text for the same reason; this is the same care applied to the
 * other half of the same answer.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

interface ExtMetadataValue { value?: string }
interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: Array<{ extmetadata?: Record<string, ExtMetadataValue> }>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function handleHttpError(response: Response, attempt: number, retries: number): Promise<never> {
  const text = await response.text();
  const retriable = response.status >= 500 || response.status === 429;
  if (attempt < retries && retriable) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RetrySignal(
      backoffFromRetryAfter(retryAfter, attempt, CREDIT_BACKOFF_CEILING_MS),
      `Commons ${response.status}`,
    );
  }
  throw new Error(`Commons API error ${response.status}: ${text.substring(0, 300)}`);
}

function classify(error: unknown, attempt: number, retries: number): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  if (attempt < retries && (isAbort || error instanceof TypeError)) {
    return new RetrySignal(
      exponentialBackoff(attempt, CREDIT_BACKOFF_CEILING_MS),
      isAbort ? 'Commons timeout' : 'Commons network error',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Commons API request failed: ${message}`);
}

async function askCommons(
  names: string[],
  userAgent: string,
  attempt: number,
  isCancelled?: () => boolean,
  timeoutMs = CREDIT_TIMEOUT_MS,
): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    titles: names.map((n) => `File:${n}`).join('|'),
  });
  const { signal, release } = abortOn(timeoutMs, isCancelled);
  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': userAgent },
      signal,
    });
    if (!response.ok) await handleHttpError(response, attempt, CREDIT_MAX_RETRIES);
    const data = await response.json() as { query?: { pages?: CommonsPage[] } };
    return data.query?.pages ?? [];
  } finally {
    release();
  }
}

export interface CreditOptions {
  userAgent: string;
  budget: WaitBudget;
  isCancelled?: () => boolean;
  onWait?: (wait: SourceWait) => void;
  /** Called between batches: the run's pacing, so this file does not own the rate limit. */
  pause?: () => Promise<void>;
  /**
   * How long one attempt may take. The default suits a sync, which has all
   * afternoon; a curator waiting on a save does not, and passes something short.
   */
  timeoutMs?: number;
}

/**
 * The credits a category's rows already carry, keyed by external id.
 *
 * Read once per run, because a run that could not fetch a credit has to resend
 * the stored one rather than omit it: the sync upsert writes
 * `COALESCE(EXCLUDED.metadata, '{}') || <curator-claimed keys>`, so the metadata
 * object a run sends **replaces** what is stored and every key left out is
 * dropped. Omitting the credit would therefore erase it — exactly the failure
 * that resending exists to prevent.
 */
export async function readStoredCredits(categoryId: number): Promise<Map<string, StoredCredit>> {
  const result = await pool.query(
    `SELECT external_id, image_url,
            metadata->'imageCredit' AS credit,
            metadata ? 'imageCredit' AS has_credit,
            curated_fields ? 'image_url' AS image_claimed
       FROM experiences
      WHERE category_id = $1`,
    [categoryId],
  );
  const credits = new Map<string, StoredCredit>();
  const rows = result.rows as {
    external_id: string; image_url: string | null;
    credit: ImageCredit | null; has_credit: boolean; image_claimed: boolean;
  }[];
  for (const row of rows) {
    credits.set(row.external_id, {
      credit: row.credit,
      hasCredit: row.has_credit === true,
      imageUrl: row.image_url,
      imageClaimed: row.image_claimed === true,
    });
  }
  return credits;
}

/**
 * What a run should write about who took the picture: what it fetched, or what
 * the row already says.
 *
 * The stored one is **resent**, not omitted, and that is the whole of the rule.
 * The sync upsert writes `COALESCE(EXCLUDED.metadata, '{}') || <claimed keys>`,
 * so the object a run sends replaces what is stored — a key left out is a key
 * dropped. A Commons 5xx during one batch would therefore strip the
 * photographer's name off every museum in it, which is the failure this exists
 * to prevent. Only a credit actually fetched replaces a stored one; where there
 * is neither, the key is absent and nothing is claimed about the picture.
 */
export function creditToWrite(
  fetched: ImageCredit | undefined,
  stored: StoredCredit | undefined,
  imageUrl: string | null,
): { imageCredit?: ImageCredit | null } {
  // A picture a curator owns is not this run's to describe: the upsert keeps
  // their `image_url` and would take the source's photographer beside it. What
  // the run sends back is **what the row already holds** rather than nothing,
  // because the change set compares key by key — an omitted key reads as a
  // removal and would file the same phantom conflict on every run, forever.
  if (stored?.imageClaimed) {
    return stored.hasCredit ? { imageCredit: stored.credit } : {};
  }
  if (fetched) return { imageCredit: fetched };
  // Keyed by the **picture**, not by the row. A source's `wdt:P18` can change
  // between runs; if the Commons batch covering the new file then fails, falling
  // back on the row's stored credit would write the new photograph and the
  // previous photographer's name in one statement — a false claim about a real
  // person, which is the one thing this feature promises never to do.
  if (stored?.credit && stored.imageUrl === imageUrl) return { imageCredit: stored.credit };
  return {};
}

/**
 * The credit for one picture a person just chose, or nothing.
 *
 * Its own entry point because the deadline is different: this runs inside a
 * curator's save, so it gets one attempt on a short leash and answers null for
 * anything that is not a Commons file or does not come back in time. A save must
 * not fail, or wait, because a metadata endpoint is slow.
 */
export async function creditForOneImage(
  url: string | null | undefined,
  userAgent: string,
  timeoutMs = 5000,
): Promise<ImageCredit | null> {
  if (!commonsFileName(url)) return null;
  const credits = await fetchCommonsCredits([url], {
    userAgent,
    // No patience at all: the first refusal ends it, because the person who
    // pressed Save is watching.
    budget: new WaitBudget(0),
    timeoutMs,
  });
  return credits.get(url!) ?? null;
}

/** Every URL that names a Commons file, grouped by that file: two rows can share a picture. */
function groupByFile(urls: Array<string | null | undefined>): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const url of urls) {
    const name = commonsFileName(url);
    if (!name || !url) continue;
    const held = byName.get(name) ?? [];
    held.push(url);
    byName.set(name, held);
  }
  return byName;
}

/** One batch, or an empty answer: a credit nobody could fetch is not a failed run. */
async function creditBatch(
  batch: string[],
  options: CreditOptions,
): Promise<CommonsPage[]> {
  try {
    return await withRetries(
      (attempt) => askCommons(
        batch, options.userAgent, attempt, options.isCancelled, options.timeoutMs,
      ),
      {
        logPrefix: LOG_PREFIX,
        retries: CREDIT_MAX_RETRIES,
        budget: options.budget,
        isCancelled: options.isCancelled,
        onWait: options.onWait,
        classify,
      },
    );
  } catch (error) {
    if (options.isCancelled?.()) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${LOG_PREFIX} credit batch of ${batch.length} failed: ${message}`);
    return [];
  }
}

function readCredit(page: CommonsPage): { name: string; credit: ImageCredit } | null {
  if (page.missing || !page.title) return null;
  const meta = page.imageinfo?.[0]?.extmetadata ?? {};
  return {
    name: page.title.replace(/^File:/, ''),
    credit: {
      author: creditText(meta.Artist?.value),
      license: creditText(meta.LicenseShortName?.value),
      licenseUrl: safeHttpUrl(meta.LicenseUrl?.value),
      detailsUrl: null,
    },
  };
}

/**
 * Credits for a set of image URLs, keyed by the URL the caller passed in.
 *
 * A URL that is not a Commons file is skipped rather than asked about, and a
 * batch that fails after its retries is logged and skipped rather than fatal: a
 * missing photographer is a missing line under a picture, not a reason to throw
 * away an import. A URL absent from the answer is therefore "not fetched", which
 * is a different thing from "nobody took it" — what a run does with that absence
 * is `creditToWrite`'s decision, not this function's.
 */
export async function fetchCommonsCredits(
  urls: Array<string | null | undefined>,
  options: CreditOptions,
): Promise<Map<string, ImageCredit>> {
  const credits = new Map<string, ImageCredit>();
  const byName = groupByFile(urls);
  if (byName.size === 0) return credits;

  for (const batch of chunk([...byName.keys()], TITLE_BATCH)) {
    for (const page of await creditBatch(batch, options)) {
      const read = readCredit(page);
      if (!read) continue;
      for (const url of byName.get(read.name) ?? []) {
        credits.set(url, { ...read.credit, detailsUrl: commonsFilePage(url) });
      }
    }
    if (options.pause) await options.pause();
  }

  console.log(`${LOG_PREFIX} Credited ${credits.size} of ${byName.size} Commons files`);
  return credits;
}

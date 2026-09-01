/**
 * Who took the picture, and under what licence we are allowed to show it.
 *
 * The catalogue displays photographs it does not host: Wikimedia Commons files,
 * on the objects and on the works inside them (#582). Every one of them was
 * taken by somebody, and a share of them carry CC BY or CC BY-SA, which of a
 * catalogue that merely *shows* a picture ask the one thing — that the somebody
 * is named wherever it appears; ShareAlike binds adaptations, which showing a
 * photograph is not. Until this file existed the catalogue named nobody. That
 * is not a rendering gap; it is the one obligation those licences impose.
 *
 * Commons is the only source of a credit, because Commons is the only source of
 * a picture (ADR-0043). The World Heritage portal's photographs were shown too,
 * and its export named their photographer in `main_image_author` and
 * `main_image_copyright`; its terms do not let this product show them, so the
 * run stopped reading the picture and, with it, the two fields — a
 * photographer's name belongs under their photograph.
 *
 * No counts here on purpose: how many pictures the catalogue holds is a
 * property of the last sync, and a comment that states it is wrong by the next
 * one. Measure it when the question comes up.
 *
 * Commons hands the credit over for free once asked: `extmetadata` for up to
 * 50 files in one request, which is their documented ceiling — with `Artist`,
 * `LicenseShortName` and `LicenseUrl` for each.
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
import { isCommonsPictureUrl, isStorableHttpUrl } from '../../types/urlSafety.js';

const LOG_PREFIX = '[Image Credit]';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_FILE_PAGE = 'https://commons.wikimedia.org/wiki/';
const FILE_PATH_PATH = '/wiki/Special:FilePath/';

/** The hosts that actually serve Commons files; anything else is somebody else's server. */
const COMMONS_HOSTS = new Set(['commons.wikimedia.org', 'commons.m.wikimedia.org']);

/** Their documented ceiling for a titles list, and the first of a batch's two limits. */
const TITLE_BATCH = 50;
/**
 * And the other ceiling, which is the URL the batch is asked down.
 *
 * The count alone was enough while the callers were museums and landmarks, whose
 * files are named after a building. Artworks are not: a painting's file is named
 * after the painting, its painter, the museum and the inventory number, so fifty
 * of them can build a query string several kilobytes long. MediaWiki's own
 * guidance is to POST past 8 kB, and a request over the limit fails as a 414 —
 * which this file turns into a batch of missing credits rather than a failed
 * import, so it would go unnoticed. Closing a batch early costs one more request
 * and cannot.
 */
const TITLE_CHARS_BATCH = 6000;
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
 *
 * Which two schemes those are is not decided here. `isStorableHttpUrl` holds
 * that for every url the backend stores, curator input included, so a policy
 * written twice cannot come to be enforced twice over (#693). What this adds is
 * the normalising: the value kept is the one the parser made, not the string it
 * arrived as.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isStorableHttpUrl(trimmed) ? new URL(trimmed).href : null;
}

interface ExtMetadataValue { value?: string }
interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: Array<{ extmetadata?: Record<string, ExtMetadataValue> }>;
}

/**
 * What one title costs the query string, measured the way the query is built.
 *
 * `URLSearchParams` and not `encodeURIComponent`, because `askCommons` sends the
 * titles through the former and the two disagree: form encoding escapes `~ ' ! (
 * )` where `encodeURIComponent` leaves them, and writes a space as `+` where
 * `encodeURIComponent` writes `%20`. Measuring with the wrong one is only ever
 * *usually* safe — today's file names are mostly spaces, so the old estimate ran
 * high on every batch — but a set full of apostrophes and brackets, which Commons
 * names commonly are, would have measured short and built a longer URL than the
 * budget allows. That failure is silent: a 414 reaches this module as a batch of
 * missing credits.
 *
 * Per name rather than per batch because the encoding is per character, so the
 * costs add: the separator is one `|`, which form encoding writes as three.
 */
function titleCost(name: string): number {
  return new URLSearchParams({ t: `File:${name}|` }).toString().length - 2;
}

/**
 * File names grouped into the batches one request may carry.
 *
 * Two ceilings, because the batch has two costs: how many titles the API accepts
 * at once, and how long the URL those titles build comes out. A name is measured
 * as it will be sent, so the budget is about the request rather than about the
 * characters a person would count. A single name over the whole budget still
 * gets its own batch and is asked about: refusing to ask is a credit certainly
 * missing, where asking is one that may yet arrive.
 */
export function batchTitles(names: string[]): string[][] {
  const out: string[][] = [];
  let batch: string[] = [];
  let chars = 0;
  for (const name of names) {
    const cost = titleCost(name);
    if (batch.length > 0 && (batch.length >= TITLE_BATCH || chars + cost > TITLE_CHARS_BATCH)) {
      out.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(name);
    chars += cost;
  }
  if (batch.length > 0) out.push(batch);
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
 * What a stored row says about its picture, in the four parts `creditToWrite` asks about.
 *
 * One fragment for both tables because the answer has to mean the same thing on
 * either: `experiences` and `treasures` carry the same `metadata` key, the same
 * `image_url` and the same `curated_fields` claim set, and a rule about who owns
 * a photograph cannot read one shape here and another there.
 */
const STORED_CREDIT_COLUMNS = `SELECT external_id, image_url,
            metadata->'imageCredit' AS credit,
            metadata ? 'imageCredit' AS has_credit,
            curated_fields ? 'image_url' AS image_claimed`;

interface StoredCreditRow {
  external_id: string; image_url: string | null;
  credit: ImageCredit | null; has_credit: boolean; image_claimed: boolean;
}

function creditsByExternalId(rows: StoredCreditRow[]): Map<string, StoredCredit> {
  const credits = new Map<string, StoredCredit>();
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
    `${STORED_CREDIT_COLUMNS}
       FROM experiences
      WHERE category_id = $1`,
    [categoryId],
  );
  return creditsByExternalId(result.rows as StoredCreditRow[]);
}

/**
 * The same, for the works inside those rows.
 *
 * Every treasure rather than a category's worth of them, because a treasure has
 * no category: it is globally unique by `external_id` and shared by every venue
 * that holds it (ADR-0023). No `WHERE` at all, then, and one query per run —
 * the run reads the whole table once and looks up what it needs by
 * `external_id`, rather than asking per work.
 */
export async function readStoredTreasureCredits(): Promise<Map<string, StoredCredit>> {
  const result = await pool.query(`${STORED_CREDIT_COLUMNS} FROM treasures`);
  return creditsByExternalId(result.rows as StoredCreditRow[]);
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
  offered: string | null,
): { imageCredit?: ImageCredit | null } {
  // A picture the run may not write is, for the credit, no picture at all: the
  // writer refuses the url (`withShowablePicture`, `syncUtils.ts`), and a
  // photographer's name beside a frame that will hold nothing is the claim this
  // feature exists never to make. Decided here rather than at the writer because
  // this is the one place that can see the claim below — and a claimed picture
  // keeps its own credit whatever the source offered (ADR-0043).
  const imageUrl = offered && isCommonsPictureUrl(offered) ? offered : null;
  // A picture a curator owns is not this run's to describe: the upsert keeps
  // their `image_url` and would take the source's photographer beside it. What
  // the run sends back is **what the row already holds** rather than nothing,
  // because the change set compares key by key — an omitted key reads as a
  // removal and would file the same phantom conflict on every run, forever.
  if (stored?.imageClaimed) {
    return stored.hasCredit ? { imageCredit: stored.credit } : {};
  }
  if (fetched && imageUrl) return { imageCredit: fetched };
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

  for (const batch of batchTitles([...byName.keys()])) {
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

/**
 * What the pictures a review card shows are, asked of Commons (#2192): the
 * file's MIME type and the categories its page is in, read through the same
 * `imageinfo` call the credits come from (`imageCredit.ts`), fifty files a
 * request, and classed by `classifyPicture`. Asked for a card on screen and
 * never for the catalogue in bulk; an answer is kept for a day per file, so a
 * queue of cards about one place asks once.
 *
 * Only Commons is ever asked: a URL that is not a Commons file is answered as
 * not classed without a request, and the request names Commons' API with the
 * file names as titles and nothing else. A request that fails leaves its files
 * not classed and uncached, so the next card asks again.
 */

import { userAgent } from '../../config/userAgent.js';
import { assertRobotsAllow } from '../robots/robotsSignals.js';
import { batchTitles, commonsFileName } from '../sync/imageCredit.js';
import {
  categoriesOf, classifyPicture, type CommonsFileFacts, type PictureClassification, type PictureSubject,
} from './classifyPicture.js';

/** A picture to class: its address and what it is of. */
export interface PictureToClass {
  url: string;
  subject: PictureSubject;
}

export interface PictureClassResult extends PictureClassification {
  url: string;
  /** When Commons was asked; an answer is kept for a day. */
  checkedAt: string;
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/** A curator is waiting on the card, so one attempt, short. */
export const TIMEOUT_MS = 8000;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 20000;
const LOG_PREFIX = '[Picture class]';

interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: Array<{ mime?: string; extmetadata?: Record<string, { value?: string }> }>;
}

export interface ClassifierDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** The robots check before a request; the production one reads Commons' robots.txt. */
  robots?: (url: string) => Promise<void>;
}

type Cached = { facts: CommonsFileFacts | null; checkedAt: string; expires: number };

/**
 * A file name as Commons titles it, which is the key the cache and the answer
 * meet on: the first letter upper-case (a title's first character is never
 * lower-case on Commons, whatever a stored address spells), underscores
 * already spaces (`commonsFileName`).
 */
function canonicalFileName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function askCommons(names: string[], deps: Required<Pick<ClassifierDeps, 'fetch' | 'robots'>>): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'extmetadata|mime',
    iiextmetadatafilter: 'Categories',
    titles: names.map(name => `File:${name}`).join('|'),
  });
  const address = `${COMMONS_API}?${params}`;
  await deps.robots(address);
  const response = await deps.fetch(address, {
    headers: { Accept: 'application/json', 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Commons API error ${response.status}`);
  const data = await response.json() as { query?: { pages?: CommonsPage[] } };
  return data.query?.pages ?? [];
}

/** The files in `urls` worth asking about: Commons files not known, or known too long ago. */
function filesToAsk(names: Map<string, string | null>, cache: Map<string, Cached>, now: () => number): string[] {
  const asked = new Set<string>();
  for (const name of names.values()) {
    if (name === null) continue;
    const kept = cache.get(name);
    if (!kept || kept.expires <= now()) asked.add(name);
  }
  return [...asked];
}

/** What one Commons page states of its file; null for a file Commons does not know. */
function factsOf(page: CommonsPage): CommonsFileFacts | null {
  const info = page.missing ? undefined : page.imageinfo?.[0];
  return info ? { mime: info.mime ?? null, categories: categoriesOf(info.extmetadata?.Categories?.value) } : null;
}

/** The classifier: every picture answered, in the order given, Commons asked once per file not yet known. */
export function createPictureClassifier(deps: ClassifierDeps = {}): (pictures: readonly PictureToClass[]) => Promise<PictureClassResult[]> {
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetch ?? fetch;
  const robots = deps.robots ?? assertRobotsAllow;
  const cache = new Map<string, Cached>();

  function remember(name: string, facts: CommonsFileFacts | null, checkedAt: string): void {
    cache.delete(name);
    cache.set(name, { facts, checkedAt, expires: now() + CACHE_TTL_MS });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }

  async function askBatch(batch: string[]): Promise<void> {
    try {
      const checkedAt = new Date(now()).toISOString();
      for (const page of await askCommons(batch, { fetch: fetchFn, robots })) {
        if (page.title) remember(canonicalFileName(page.title.replace(/^File:/, '')), factsOf(page), checkedAt);
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} a batch of ${batch.length} files could not be asked about: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function answerFor({ url, subject }: PictureToClass, name: string | null): PictureClassResult {
    const kept = name ? cache.get(name) : undefined;
    if (!kept) return { url, class: null, basis: null, checkedAt: new Date(now()).toISOString() };
    const classification: PictureClassification = kept.facts ? classifyPicture(kept.facts, subject) : { class: null, basis: null };
    return { url, ...classification, checkedAt: kept.checkedAt };
  }

  return async function classify(pictures: readonly PictureToClass[]): Promise<PictureClassResult[]> {
    const names = new Map<string, string | null>(pictures.map(picture => {
      const name = commonsFileName(picture.url);
      return [picture.url, name === null ? null : canonicalFileName(name)];
    }));
    for (const batch of batchTitles(filesToAsk(names, cache, now))) await askBatch(batch);
    return pictures.map(picture => answerFor(picture, names.get(picture.url) ?? null));
  };
}

/** The classifier the endpoint uses. */
export const classifyPictures = createPictureClassifier();

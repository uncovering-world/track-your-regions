/**
 * The photographs witness (#1768): how many files in a place's Commons
 * category were taken within `PHOTO_REACH_M` of it. People photograph a place
 * they go to. The Roman Baths' category holds 217 files, 98 of them taken on
 * site; Rungholt's holds 17, none taken there.
 *
 * A file's primary coordinate on Commons is where the camera stood
 * (`{{Location}}`), so the files are read with `prop=coordinates` through the
 * run's MediaWiki transport (`askWikipediaOnce`), with its retries, its wait
 * budget and its pause between asks. A category is read until
 * `PHOTOS_NEEDED` of its files were taken there, which ends most reads on
 * the first page, or to its end. `MAX_FILES` is far past any category a
 * place the readership door opens for has; a read that reaches it with fewer
 * than `PHOTOS_NEEDED` taken there has read that many files of the place
 * taken elsewhere, which is no witness that people go there.
 *
 * The question is the category and the point together, so an answer can be
 * kept in the run's cache like any other (`withCache`, kind `photos`): what a
 * place's photographs say changes as fast as people upload, which is weeks.
 */

import {
  askWikipediaOnce, nextContinuation, pagesOf, CATEGORY_WAIT_BUDGET_MS, type CategoryOptions, type CategoryPage,
} from '../wikipediaCategories.js';
import { WaitBudget } from '../sourceRetry.js';
import type { CacheDescriptor } from '../wikidataCache.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { PHOTO_REACH_M, PHOTOS_NEEDED } from './witnesses.js';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/** How many of a category's files are read at most. */
const MAX_FILES = 20_000;
/**
 * How many asks one category may take. A page of members is 500 files, and
 * the coordinates of one page can take asks of their own (`cocontinue`), so
 * `MAX_FILES` takes far more than the ten a Wikipedia question is held to. A
 * category still continuing past this is a source that will not stop.
 */
const MAX_ASKS = 120;
const EARTH_RADIUS_M = 6_371_000;

/** A place whose photographs are counted: its Commons category and its point. */
export interface PhotoPlace {
  qid: string;
  category: string;
  lat: number;
  lon: number;
}

/** The send a cached door wraps: one question, one answer row. */
export type PhotoSend = (question: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]>;

/** The question for one place, which is also its cache key: the category and the point to five places. */
export function photoQuestion(place: PhotoPlace): string {
  return JSON.stringify({ category: place.category, lat: Number(place.lat.toFixed(5)), lon: Number(place.lon.toFixed(5)) });
}

/** The great-circle distance between two points, in metres. */
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

type FilePage = CategoryPage & { coordinates?: { lat?: number; lon?: number }[] };
type Files = Map<string, { lat: number; lon: number } | null>;

/** Add one answer's files to `files`, each with where its camera stood, or none. */
function addFiles(files: Files, pages: readonly FilePage[]): void {
  for (const page of pages) {
    if (!page.title) continue;
    const at = page.coordinates?.find((c) => typeof c.lat === 'number' && typeof c.lon === 'number');
    if (at) files.set(page.title, { lat: at.lat!, lon: at.lon! });
    else if (!files.has(page.title)) files.set(page.title, null);
  }
}

/**
 * The door to Commons: answers a `photoQuestion` with one row, how many of the
 * category's files read were taken within reach (`near`) and how many were
 * read (`files`). A category Commons does not have answers 0 and 0.
 */
export function commonsPhotoDoor(options: CategoryOptions): PhotoSend {
  const budget = options.budget ?? new WaitBudget(CATEGORY_WAIT_BUDGET_MS);
  return async (question) => {
    const { category, lat, lon } = JSON.parse(question) as { category: string; lat: number; lon: number };
    const what = `Commons' files in Category:${category}`;
    const files: Files = new Map();
    const nearOf = () => [...files.values()].filter((at) => at && metresBetween(at, { lat, lon }) <= PHOTO_REACH_M).length;
    let cont: Record<string, string> | undefined;
    let asks = 0;
    do {
      const params: Record<string, string> = {
        action: 'query', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file',
        gcmlimit: 'max', prop: 'coordinates', colimit: 'max', format: 'json', formatversion: '2', ...cont,
      };
      await options.pause?.();
      const answer = await askWikipediaOnce(params, { ...options, endpoint: COMMONS_API }, budget, what);
      asks += 1;
      addFiles(files, pagesOf(answer) as FilePage[]);
      cont = nextContinuation(answer, asks, what, MAX_ASKS);
    } while (cont && nearOf() < PHOTOS_NEEDED && files.size < MAX_FILES);
    return [{ near: { value: String(nearOf()) }, files: { value: String(files.size) } }];
  };
}

/**
 * Whether each place's photographs witness it, through the door `send`, one
 * place at a time: `PHOTOS_NEEDED` of its category's files taken there.
 */
export async function photographed(send: PhotoSend, places: readonly PhotoPlace[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const place of places) {
    const [row] = await send(photoQuestion(place), { kind: 'photos', label: `photographs of Category:${place.category}` });
    out.set(place.qid, Number(row?.near?.value ?? 0) >= PHOTOS_NEEDED);
  }
  return out;
}

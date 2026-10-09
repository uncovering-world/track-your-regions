/**
 * The one door to OpenStreetMap's Nominatim, for every caller in this process:
 * the curator's place search (`geocodeController.ts`) and the world-view
 * import's geocode match (`worldViewImport/geocodeMatcher.ts`).
 *
 * Its usage policy (operations.osmfoundation.org/policies/nominatim, read
 * 2026-10-09) asks four things of a client, and each is held here, once:
 * - **An absolute maximum of one request per second.** Every search this
 *   process sends waits its turn in one queue, a little over a second apart.
 *   Two callers that each kept their own "one a second" used to make two a
 *   second between them, and two requests arriving together both read the old
 *   timestamp and went at once.
 * - **Results cached on our side.** A client that repeats the same query may be
 *   classified as faulty and blocked. An answer is kept for a day, by query.
 * - **An application named in the User-Agent** — the caller's `userAgent()`.
 * - **No auto-complete over the API.** Not a rule this module can hold: the
 *   screens search on an explicit action (Enter or a button), never per keystroke.
 *
 * A refusal (429, 403) is not retried: the policy's answer to a client that
 * keeps asking is a ban.
 */

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
/** A little over the policy's one second, so clock jitter never makes it two. */
const SPACING_MS = 1100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * The longest one request may hold the queue. Every caller's search waits
 * behind the one in flight, so a request Nominatim never answers would stall
 * them all; it is given up here whatever deadline its caller set.
 */
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_MAX = 2000;

export interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  extratags?: Record<string, string>;
}

export interface NominatimSearch {
  limit: number;
  /** Ask for the OSM tags too: the place search reads its `wikidata` tag. */
  extratags?: boolean;
  userAgent: string;
  signal?: AbortSignal;
}

/** Nominatim answered with a status other than 200. */
export class NominatimError extends Error {
  constructor(public status: number) {
    super(`Nominatim request failed: ${status}`);
  }
}

let turn: Promise<void> = Promise.resolve();
let nextStartAt = 0;
const cache = new Map<string, { at: number; places: NominatimPlace[] }>();

const keyOf = (q: string, options: NominatimSearch) =>
  `${options.limit}|${options.extratags ? 1 : 0}|${q.trim().replace(/\s+/g, ' ').toLowerCase()}`;

function cached(key: string): NominatimPlace[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.places;
}

function remember(key: string, places: NominatimPlace[]): void {
  cache.delete(key);
  cache.set(key, { at: Date.now(), places });
  // A Map iterates in insertion order, so the first key is the oldest.
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, Math.max(ms, 0));
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** A signal that fires at the caller's deadline or after `REQUEST_TIMEOUT_MS`, whichever comes first. */
function boundedBy(caller?: AbortSignal): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Nominatim did not answer in time')), REQUEST_TIMEOUT_MS);
  const onCaller = () => controller.abort(caller?.reason);
  if (caller?.aborted) onCaller();
  else caller?.addEventListener('abort', onCaller, { once: true });
  return {
    signal: controller.signal,
    release: () => { clearTimeout(timer); caller?.removeEventListener('abort', onCaller); },
  };
}

/** Settles once the query ahead has, or rejects as soon as the caller's own deadline passes. */
function queuedBehind(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous;
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([previous, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

/**
 * One request, in its turn: never sooner than `SPACING_MS` after the last one
 * started. The next caller waits for the query ahead of this one as well as
 * for this one, so a caller whose deadline passes while it queues gives up its
 * place at once without letting anyone start beside the query in flight. A
 * question the cache answers by the time its turn comes takes no slot.
 */
async function inTurn<T>(
  signal: AbortSignal | undefined, answered: () => T | null, send: () => Promise<T>,
): Promise<T> {
  const previous = turn;
  let done!: () => void;
  const mine = new Promise<void>((resolve) => { done = resolve; });
  turn = previous.then(() => mine);
  try {
    await queuedBehind(previous, signal);
    const hit = answered();
    if (hit !== null) return hit;
    await wait(nextStartAt - Date.now(), signal);
    nextStartAt = Date.now() + SPACING_MS;
    return await send();
  } finally {
    done();
  }
}

/** Places matching `q`, from the cache where the same question was asked within a day. */
export async function searchNominatim(q: string, options: NominatimSearch): Promise<NominatimPlace[]> {
  const key = keyOf(q, options);
  const hit = cached(key);
  if (hit) return hit;
  // Asked again when the turn comes: a caller queued behind the same question gets its answer.
  const places = await inTurn(options.signal, () => cached(key), async () => {
    const url = new URL(NOMINATIM_SEARCH);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(options.limit));
    if (options.extratags) {
      url.searchParams.set('addressdetails', '0');
      url.searchParams.set('extratags', '1');
    }
    const { signal, release } = boundedBy(options.signal);
    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': options.userAgent, 'Accept': 'application/json' },
        signal,
      });
      if (!response.ok) throw new NominatimError(response.status);
      return await response.json() as NominatimPlace[];
    } finally {
      release();
    }
  });
  remember(key, places);
  return places;
}

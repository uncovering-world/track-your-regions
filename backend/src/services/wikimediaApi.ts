/**
 * One turn for every call to the Wikimedia Action API (`/w/api.php` on
 * Wikidata, Commons, the Wikipedias and Wikivoyage), across the process
 * (#2352).
 *
 * The robot policy (https://wikitech.wikimedia.org/wiki/Robot_policy) asks an
 * unauthenticated automated client for one request at a time, under five a
 * second, and a 5 s pause after any request that took over a second; the API
 * rate-limits page asks a client to wait at least 5 s after a 429 that names no
 * `Retry-After`; API:Etiquette asks for `maxlag` on work nobody waits on and
 * for `Promise-Non-Write-API-Action: true` on a read sent as POST. Each caller
 * used to pace itself, so runs of different sources, the world-view import and
 * a curator's lookup overlapped. Every caller now sends through `actionApiFetch`,
 * which keeps those rules for all of them: the Wikidata Query Service has its
 * own turn (`inTurn` in `sync/wikidataUtils.ts`, #1307), and this is the Action
 * API's.
 *
 * What a caller does with an answer stays its own: its retries, its patience,
 * what it reads of the body. The turn decides when a request leaves, and holds
 * until its body has arrived: the answer is read inside the turn and handed
 * back whole, so a slow body neither overlaps the next request nor escapes the
 * pause a slow answer asks for. The answers are small JSON or wikitext.
 */

/** The gap between two requests that answered quickly: under five a second. */
export const ACTION_API_GAP_MS = 250;
/** A request that took longer than this makes the next one wait `ACTION_API_SLOW_PAUSE_MS`. */
export const ACTION_API_SLOW_MS = 1000;
export const ACTION_API_SLOW_PAUSE_MS = 5000;
/** The wait after a 429 or a 503 that names no `Retry-After`. */
export const ACTION_API_DEFAULT_HOLD_MS = 5000;
/** The longest one answer holds every caller back; a caller's own retry decides beyond it. */
export const ACTION_API_HOLD_CEILING_MS = 180_000;
/** The replication lag, in seconds, an unattended request is willing to wait out (API:Etiquette). */
export const ACTION_API_MAXLAG_S = 5;

export interface ActionApiOptions {
  /** Work nobody is waiting on (a run, the import, a script): it sends `maxlag`. A curator's click does not. */
  unattended?: boolean;
  /** Stops the wait for the turn; the request is then not sent. The caller's own `signal` does the same. */
  isCancelled?: () => boolean;
  /** The transport, for a spec; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  /**
   * Ask once more after a 429 or 503, in the turn, once the hold it asked for is
   * over: for a caller with no retry of its own, which would otherwise drop the
   * answer (the world-view import's live reads).
   */
  retryHeld?: boolean;
  /**
   * How long the request may take once it leaves: the timer starts when the
   * turn is given, not when the caller asks, so a wait for the turn never
   * spends a caller's patience. Joined with any signal the caller passes.
   */
  timeoutMs?: number;
}

let turn: Promise<void> = Promise.resolve();
let nextStartAt = 0;
let heldUntil = 0;

/** Back to a fresh process, for a spec. */
export function resetActionApiTurn(): void {
  turn = Promise.resolve();
  nextStartAt = 0;
  heldUntil = 0;
}

/** How long an answer asks every caller to wait: its `Retry-After`, in seconds or as a date, or the default. */
export function holdOf(response: Pick<Response, 'status' | 'headers'>, now = Date.now()): number {
  if (response.status !== 429 && response.status !== 503) return 0;
  const said = response.headers.get('retry-after');
  if (said) {
    const seconds = Number(said);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, ACTION_API_HOLD_CEILING_MS);
    const at = Date.parse(said);
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - now), ACTION_API_HOLD_CEILING_MS);
  }
  return ACTION_API_DEFAULT_HOLD_MS;
}

/** The caller's headers with one more, in the shape the caller gave them. */
function withHeader(headers: RequestInit['headers'] | undefined, name: string, value: string): RequestInit['headers'] {
  if (headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.set(name, value);
    return copy;
  }
  if (Array.isArray(headers)) return [...headers, [name, value]];
  return { ...headers, [name]: value };
}

/** The request as it leaves: `maxlag` on unattended work, and the read-only promise on a POST. */
function shaped(url: string, init: RequestInit, unattended: boolean): { url: string; init: RequestInit } {
  const method = (init.method ?? 'GET').toUpperCase();
  let { headers } = init;
  let body = init.body;
  let address = url;
  if (method === 'POST') headers = withHeader(headers, 'Promise-Non-Write-API-Action', 'true');
  if (unattended) {
    if (method === 'POST' && body instanceof URLSearchParams) {
      body = new URLSearchParams(body);
      if (!body.has('maxlag')) body.set('maxlag', String(ACTION_API_MAXLAG_S));
    } else {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('maxlag')) parsed.searchParams.set('maxlag', String(ACTION_API_MAXLAG_S));
      address = parsed.toString();
    }
  }
  return { url: address, init: { ...init, headers, body } };
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** Wait until `until`, a second at a time, so a cancelled caller stops waiting within a second. */
async function waitUntil(until: number, stopped: () => boolean): Promise<boolean> {
  for (let left = until - Date.now(); left > 0; left = until - Date.now()) {
    if (stopped()) return false;
    await sleep(Math.min(left, 1000));
  }
  return !stopped();
}

/** Settles when `signal` aborts; never, without one. */
function abortedOf(signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); });
}

/** Why a request waiting for its turn was not sent: the caller's abort, or a cancelled run. */
function notSent(signal: AbortSignal | null | undefined): Error {
  if (signal?.aborted) return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
  return new Error('Sync cancelled');
}

/** The statuses a Response may not carry a body with. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** The answer read whole, so the turn is held until the last byte arrived. */
async function readWhole(response: Response): Promise<Response> {
  const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Send one Action API request in the process's turn, and record what its
 * answer asks of the next one. A 429 or 503 holds every caller back by its
 * `Retry-After` (5 s where it names none); the caller still reads the answer
 * and decides whether to try again.
 */
export async function actionApiFetch(
  url: string | URL, init: RequestInit = {}, options: ActionApiOptions = {},
): Promise<Response> {
  const response = await oneTurn(url, init, options);
  if (!options.retryHeld || holdOf(response) === 0) return response;
  return oneTurn(url, init, options);
}

async function oneTurn(url: string | URL, init: RequestInit, options: ActionApiOptions): Promise<Response> {
  const { url: address, init: request } = shaped(url.toString(), init, options.unattended === true);
  const previous = turn;
  let done!: () => void;
  const mine = new Promise<void>((resolve) => { done = resolve; });
  turn = previous.then(() => mine);
  const stopped = () => options.isCancelled?.() === true || request.signal?.aborted === true;
  try {
    await Promise.race([previous, abortedOf(request.signal)]);
    if (stopped() || !(await waitUntil(Math.max(nextStartAt, heldUntil), stopped))) throw notSent(request.signal);
    const startedAt = Date.now();
    try {
      const signals = [request.signal, options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs)]
        .filter((signal): signal is AbortSignal => !!signal);
      const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
      const response = await readWhole(await (options.fetchImpl ?? fetch)(address, { ...request, signal }));
      const hold = holdOf(response);
      if (hold > 0) heldUntil = Math.max(heldUntil, Date.now() + hold);
      return response;
    } finally {
      const took = Date.now() - startedAt;
      nextStartAt = Date.now() + (took > ACTION_API_SLOW_MS ? ACTION_API_SLOW_PAUSE_MS : ACTION_API_GAP_MS);
    }
  } finally {
    done();
  }
}

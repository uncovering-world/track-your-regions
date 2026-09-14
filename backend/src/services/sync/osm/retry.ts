/**
 * What an OpenStreetMap endpoint's failures mean, shared by every door.
 *
 * Both readers wait out the same things — a 429, a 5xx, a timeout, a dropped
 * connection — and give up loudly on the same things — a refusal of the
 * question itself, a body that will not parse. What differs between them is
 * how long to wait when the endpoint did not say: the mirror doubles from five
 * seconds, and Overpass asks for thirty after a 429. That one number is the
 * door's to hand in, and the rest is written once.
 */

import { backoffFromRetryAfter, exponentialBackoff, RetrySignal } from '../sourceRetry.js';

/** Attempts after the first; the run's wait budget is what usually stops the loop. */
export const OSM_MAX_RETRIES = 4;
export const OSM_BACKOFF_CEILING_MS = 60000;

/** How a door names itself in a wait reason: `OSM 503`, `Overpass 429`. */
export interface OsmRetryPolicy {
  label: string;
  /**
   * The wait for a status worth retrying, given what `Retry-After` said (or
   * `NaN` where it said nothing) and the attempt. The doubling backoff unless
   * the door says otherwise.
   */
  backoffMs?: (status: number, retryAfterSeconds: number, attempt: number) => number;
}

const doublingBackoff: NonNullable<OsmRetryPolicy['backoffMs']> = (_status, retryAfter, attempt) =>
  backoffFromRetryAfter(retryAfter, attempt, OSM_BACKOFF_CEILING_MS);

/**
 * A response that is not OK, turned into a wait or a refusal. Always throws.
 *
 * A 429 and a 5xx are the endpoint being busy, which is worth another
 * attempt while the attempts last; anything else is a refusal of the question
 * as asked, which a minute's wait will not change.
 */
export async function refuseOrRetry(
  response: Response,
  attempt: number,
  policy: OsmRetryPolicy,
): Promise<never> {
  const text = await response.text();
  if (attempt < OSM_MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RetrySignal(
      (policy.backoffMs ?? doublingBackoff)(response.status, retryAfter, attempt),
      `${policy.label} ${response.status}`,
    );
  }
  throw new Error(`OpenStreetMap answered ${response.status}: ${text.substring(0, 300)}`);
}

/**
 * What is worth another attempt: a timeout and a dropped connection, plus the
 * statuses above (already a `RetrySignal` by the time they get here). A body
 * that will not parse is not — an endpoint answering HTML answers HTML again a
 * minute later.
 */
export function classifyOsmError(
  error: unknown, attempt: number, retries: number, label: string,
): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  if (attempt < retries && (isAbort || error instanceof TypeError)) {
    return new RetrySignal(
      exponentialBackoff(attempt, OSM_BACKOFF_CEILING_MS),
      isAbort ? `${label} timeout` : `${label} network error`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

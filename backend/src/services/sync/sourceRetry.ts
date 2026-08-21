/**
 * How a run waits for an outside source that is having a bad day.
 *
 * Every source we import from is somebody else's server with somebody else's
 * rules, and each of them has now failed a run at least once: Wikidata's query
 * front end answered run 61 with a gateway error, and UNESCO's portal is one
 * unhandled 502 away from doing the same. The shape of the answer is the same
 * either way — wait, but bounded; wake up when the run is cancelled; say on
 * screen that waiting is what is happening — so it lives here rather than being
 * written twice with two different sets of mistakes.
 *
 * What stays with each caller is what its errors *mean*: only the SPARQL client
 * knows that a body which will not parse is worth another attempt, and only the
 * UNESCO client knows what its portal puts in a 429. That is the `classify`
 * hook, and it is the whole of the difference between the two.
 */

/**
 * Told when a query is about to wait, so a screen can say so.
 *
 * A run that is waiting for a source looks exactly like a run that has hung: the
 * collection phase has no denominator, so the bar sits at zero, and the retries
 * went to a container log nobody was watching. Run 61 spent over a minute that
 * way and then failed. One callback is enough to end that — the caller decides
 * whether it becomes a status message, a log line, or nothing.
 */
export interface SourceWait {
  /** What the service said, in the words the log uses: `SPARQL 504`, `HTTP 429`. */
  reason: string;
  attempt: number;
  /** How long we are about to wait, in milliseconds. */
  backoffMs: number;
  /** How much of the wait budget is already spent, so a caller can say "9 of 15 min". */
  waitedMs: number;
}

/**
 * A run's remaining patience, in milliseconds, shared by every request it sends.
 *
 * Per run rather than per request, which is the shape the first version got
 * wrong: a museum collection sends a few hundred queries, and fifteen minutes of
 * patience each is arithmetically hours of a run nobody is watching. One budget
 * spent by whichever requests need it says the true thing — this source is
 * having a bad day, and we stop when we have waited as long as we said.
 */
export class WaitBudget {
  private spentMs = 0;

  constructor(public readonly totalMs: number) {}

  get remainingMs(): number {
    return Math.max(0, this.totalMs - this.spentMs);
  }

  spend(ms: number): void {
    this.spentMs += ms;
  }
}

/**
 * Sentinel thrown by a classifier to say "this is worth another attempt".
 * Carries the backoff duration and a label for the log and the screen.
 */
export class RetrySignal extends Error {
  constructor(public backoffMs: number, public label: string) {
    super(label);
  }
}

/** Doubling from five seconds, never past the ceiling the caller allows. */
export function exponentialBackoff(attempt: number, ceilingMs: number): number {
  return Math.min(ceilingMs, 5000 * Math.pow(2, attempt));
}

/** What the service asked for, where it asked; the doubling otherwise. */
export function backoffFromRetryAfter(
  retryAfter: number,
  attempt: number,
  ceilingMs: number,
): number {
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : exponentialBackoff(attempt, ceilingMs);
}

/**
 * How often a cancelled run is noticed, both mid-request and mid-wait.
 *
 * A second is short enough that Cancel feels immediate and long enough that a
 * three-minute backoff costs 180 wake-ups rather than a busy loop.
 */
export const CANCEL_POLL_MS = 1000;

/**
 * Wait, but wake early when the run is cancelled.
 *
 * Sliced rather than one timer, because `setTimeout` cannot be asked whether
 * anything has changed since it was scheduled.
 */
export async function interruptibleDelay(
  ms: number,
  isCancelled?: () => boolean,
): Promise<void> {
  const slice = CANCEL_POLL_MS;
  for (let waited = 0; waited < ms; waited += slice) {
    if (isCancelled?.()) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(slice, ms - waited)));
  }
}

/**
 * An abort controller that fires on a timeout *or* on the run being cancelled.
 *
 * The caller must call the returned `release`, or a cancelled run leaves an
 * interval behind for every request it abandoned.
 */
export function abortOn(
  timeoutMs: number,
  isCancelled?: () => boolean,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // A pool band can take most of a minute, and the run is over long before it
  // answers. Aborting hands the socket back rather than waiting out a request
  // whose result nobody will read.
  const watch = isCancelled
    ? setInterval(() => { if (isCancelled()) controller.abort(); }, CANCEL_POLL_MS)
    : undefined;
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timeout);
      if (watch) clearInterval(watch);
    },
  };
}

export interface RetryOptions {
  /** Prefix for log messages (e.g. "[Museum Sync]"). */
  logPrefix: string;
  /** Attempts after the first. The budget is what usually stops the loop. */
  retries: number;
  /** The run's patience, shared with every other request it sends. */
  budget: WaitBudget;
  /** Whether the run has been cancelled. Checked before every attempt and while waiting. */
  isCancelled?: () => boolean;
  /** Called before each wait, for a caller that has somewhere to show it. */
  onWait?: (wait: SourceWait) => void;
  /**
   * What this source's failures mean: a `RetrySignal` to wait on, or an `Error`
   * to give up with. Only the caller knows which of its errors are transient.
   */
  classify: (error: unknown, attempt: number, retries: number) => RetrySignal | Error;
}

/**
 * Try, wait, try again — until it works, the run is cancelled, or the patience
 * runs out.
 *
 * Retries are bounded by *time* rather than by a count: `retries` caps the
 * attempts and the budget caps the waiting, whichever comes first. The budget is
 * what makes the difference between "busy for a minute" — which is ordinary and
 * worth waiting out — and a service that is genuinely down.
 */
export async function withRetries<T>(
  attempt: (attemptNo: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { logPrefix, retries, budget, isCancelled, onWait, classify } = options;
  const maxAttempts = retries + 1;
  for (let n = 0; n < maxAttempts; n++) {
    if (isCancelled?.()) throw new Error('Sync cancelled');
    try {
      return await attempt(n);
    } catch (error) {
      // Asked before the error is classified, because the abort a cancel causes
      // is indistinguishable from a timeout — and retrying a run that has been
      // stopped would wait out a backoff on its way to stopping anyway.
      if (isCancelled?.()) throw new Error('Sync cancelled');
      const classified = classify(error, n, retries);
      if (!(classified instanceof RetrySignal)) throw classified;
      // The budget is checked before the wait rather than after it, so the run
      // never sleeps three minutes only to give up on waking.
      if (classified.backoffMs > budget.remainingMs) {
        throw new Error(
          `${classified.label}, and this run's ${Math.round(budget.totalMs / 60000)} min of waiting is spent`,
        );
      }
      console.warn(
        `${logPrefix} ${classified.label}, retrying in ${Math.round(classified.backoffMs / 1000)}s (attempt ${n + 1}/${maxAttempts})`,
      );
      onWait?.({
        reason: classified.label,
        attempt: n + 1,
        backoffMs: classified.backoffMs,
        waitedMs: budget.totalMs - budget.remainingMs,
      });
      budget.spend(classified.backoffMs);
      await interruptibleDelay(classified.backoffMs, isCancelled);
    }
  }
  throw new Error(`${logPrefix} request failed after all retries`);
}

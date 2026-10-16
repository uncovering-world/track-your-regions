/**
 * The date of the newest complete file the host lists for a dump, so the admin
 * panel can say a newer dump is out (#1583). Asked of the host at most once a
 * day per dump, in the background: the panel reads what was last learnt and
 * never waits on the host, and a host that does not answer leaves what was
 * known before. The URL is the catalog's, as for a build (`catalog.ts`).
 */

import { dumpNamed, type DumpKey } from './catalog.js';
import { fetchText, sizeOf } from './fetch.js';

/** How long what the host said stands before it is asked again. */
export const ASK_EVERY_MS = 24 * 60 * 60 * 1000;
/** How long one asking may take before it is given up until the next. */
const ASK_FOR_MS = 60_000;

interface Known {
  date: string | null;
  askedAt: number;
  /** Whether the last asking was answered; a host that failed leaves the date it gave before. */
  answered: boolean;
}

/** What is known of the newest dump: its date, and whether and when the host was asked. */
export interface Newest {
  date: string | null;
  /** When the host was last asked; null while it never has been. */
  askedAt: Date | null;
  answered: boolean;
}

const known = new Map<DumpKey, Known>();
const asking = new Set<DumpKey>();

async function ask(key: DumpKey, now: number): Promise<void> {
  const descriptor = dumpNamed(key);
  if (!descriptor || asking.has(key)) return;
  asking.add(key);
  const signal = AbortSignal.timeout(ASK_FOR_MS);
  try {
    const file = await descriptor.resolve(url => fetchText(url, signal), url => sizeOf(url, signal));
    known.set(key, { date: file?.date ?? known.get(key)?.date ?? null, askedAt: now, answered: true });
  } catch (error) {
    // Asked again a day later all the same: a host that is down is not asked in a loop.
    known.set(key, { date: known.get(key)?.date ?? null, askedAt: now, answered: false });
    console.warn('[Dumps] Could not learn the newest file of a dump:', key, (error as Error).message);
  } finally {
    asking.delete(key);
  }
}

/**
 * The newest file's date (`YYYY-MM-DD`) last learnt from the host, and when
 * and whether it answered; asks the host again in the background once a day
 * has passed since it last did. Right after a start nothing is known, and
 * the panel says it is checking rather than that the copy is current.
 */
export function newestDump(key: DumpKey, now: number = Date.now()): Newest {
  const last = known.get(key);
  if (!last || now - last.askedAt >= ASK_EVERY_MS) void ask(key, now);
  return last
    ? { date: last.date, askedAt: new Date(last.askedAt), answered: last.answered }
    : { date: null, askedAt: null, answered: false };
}

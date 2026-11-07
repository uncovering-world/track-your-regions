/**
 * The date of the newest complete file the host lists for a dump, so the admin
 * panel can say a newer dump is out (#1583). The dump worker asks the host, at
 * most once a day per dump, and keeps what it learnt in
 * `workbench.dump_newest_on_host`; the backend reads that and never asks the
 * host itself.
 *
 * Asked by the worker because dumps.wikimedia.org caps a client at three
 * connections, and `HOST_CONNECTIONS` in `fetch.ts` counts them within one
 * process (#2353). With every request to the host made by the worker, its
 * downloads and its checks share that one counter, and the backend opens none.
 * A host that does not answer leaves the date it gave before, and is asked
 * again a day later. The URL is the catalog's, as for a build (`catalog.ts`).
 */

import { pool } from '../../db/index.js';
import type { DumpNewestOnHostRow } from '../../db/schema.generated.js';
import { DUMPS, dumpNamed, type DumpKey } from './catalog.js';
import { fetchText, sizeOf } from './fetch.js';

/** How long what the host said stands before it is asked again. */
export const ASK_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * How long one request of an asking may take once it holds a connection,
 * before the asking is given up as unanswered. The wait for the connection is
 * not counted: behind a build's download it can last hours (#2353).
 */
export const ASK_FOR_MS = 60_000;

/** What is known of the newest dump: its date, and whether and when the host was asked. */
export interface Newest {
  date: string | null;
  /** When the host was last asked; null while it never has been. */
  askedAt: Date | null;
  answered: boolean;
}

/** What a dump the worker has not asked about yet answers. */
export const NOT_ASKED: Newest = { date: null, askedAt: null, answered: false };

/** A row as read: the date as text, `YYYY-MM-DD`, as every dump date leaves this module. */
type NewestRow = Pick<DumpNewestOnHostRow, 'asked_at' | 'answered'> & { dump: DumpKey; newest_date: string | null };

/** What the worker last learnt of every dump it has asked about. */
export async function newestDumps(): Promise<Map<DumpKey, Newest>> {
  const result = await pool.query<NewestRow>(
    `SELECT dump, to_char(newest_date, 'YYYY-MM-DD') AS newest_date, asked_at, answered FROM workbench.dump_newest_on_host`,
  );
  return new Map(result.rows.map(row => [row.dump, { date: row.newest_date, askedAt: row.asked_at, answered: row.answered }]));
}

/**
 * The newest file's date (`YYYY-MM-DD`) the worker last learnt from the host,
 * and when and whether it answered. Before the worker has asked, nothing is
 * known, and the panel says it is checking rather than that the copy is
 * current.
 */
export async function newestDump(key: DumpKey): Promise<Newest> {
  return (await newestDumps()).get(key) ?? NOT_ASKED;
}

async function record(key: DumpKey, newest: Newest): Promise<void> {
  await pool.query(
    `INSERT INTO workbench.dump_newest_on_host (dump, newest_date, asked_at, answered) VALUES ($1, $2, $3, $4)
     ON CONFLICT (dump) DO UPDATE SET newest_date = EXCLUDED.newest_date, asked_at = EXCLUDED.asked_at, answered = EXCLUDED.answered`,
    [key, newest.date, newest.askedAt, newest.answered],
  );
}

async function ask(key: DumpKey, last: Newest, stop: AbortSignal, now: Date): Promise<void> {
  const descriptor = dumpNamed(key);
  if (!descriptor) return;
  try {
    const file = await descriptor.resolve(url => fetchText(url, stop, ASK_FOR_MS), url => sizeOf(url, stop, ASK_FOR_MS));
    await record(key, { date: file?.date ?? last.date, askedAt: now, answered: true });
  } catch (error) {
    if (stop.aborted) return;
    // Asked again a day later all the same: a host that is down is not asked in a loop.
    await record(key, { date: last.date, askedAt: now, answered: false });
    console.warn('[Dumps] Could not learn the newest file of a dump:', key, (error as Error).message);
  }
}

/**
 * Ask the host for every dump whose answer is missing or a day old, one at a
 * time: the worker's background check (`dumpWorker.ts`), beside the build it
 * may be running. Which are due is decided when the pass starts; each is
 * recorded as asked when its own asking starts, which may be long after,
 * behind a build's download.
 */
export async function askDueDumps(stop: AbortSignal, clock: () => number = Date.now): Promise<void> {
  const known = await newestDumps();
  const now = clock();
  for (const { key } of DUMPS) {
    if (stop.aborted) return;
    const last = known.get(key) ?? NOT_ASKED;
    if (last.askedAt && now - last.askedAt.getTime() < ASK_EVERY_MS) continue;
    await ask(key, last, stop, new Date(clock()));
  }
}

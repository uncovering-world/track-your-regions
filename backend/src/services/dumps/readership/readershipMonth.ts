/**
 * The readership tables (#1436, ADR-0055): a month's staged titles are summed,
 * joined to Wikidata items through the local subset's sitelinks and swapped in
 * whole, with the file the month came from.
 *
 * A title is staged once per spelling and per run of adjacent lines
 * (`monthSummer.ts`), so its rows are summed here, with the rows of the
 * article's redirects (#1650). Its daily series is the sum, day by day, of the
 * series its rows carry: a renamed article is read mostly under a redirect,
 * and the series the burst flag reads (ADR-0055 decision 4) has to cover the
 * views it is read against.
 */

import type { PoolClient, QueryResult } from 'pg';
import { pool, rollbackQuietly } from '../../../db/index.js';
import { FoldTitles, titleHash } from './foldTitles.js';
import type { StagedRow } from './monthSummer.js';
import { MONTH_FLOOR } from './monthSummer.js';

/**
 * ADR-0055 decision 1: a month under these is a stream that stopped, not a
 * short month. The editions are every Wikipedia edition the file names (371
 * in September 2026), never the ones over the counted line, which an edition
 * near it crosses from month to month.
 */
export const MIN_MONTH_LINES = 50_000_000;
export const MIN_EDITIONS = 80;

/** Stage a batch of a month's rows under the build reading it; one build of the dump runs at a time. */
export async function stageRows(buildId: number, rows: readonly StagedRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO readership_staging (build_id, site, title, views, mobile, daily)
     SELECT $1::int, s.site, s.title, s.views, s.mobile, s.daily::int[]
       FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::text[]) AS s(site, title, views, mobile, daily)`,
    [
      buildId, rows.map(r => r.site), rows.map(r => r.title), rows.map(r => r.views), rows.map(r => r.mobile),
      rows.map(r => (r.daily ? `{${r.daily.join(',')}}` : null)),
    ],
  );
}

/**
 * Empty the staging table: before a month is read, after its read failed, and
 * once it is kept. Builds of the dump run one at a time (`BuildAlreadyRunning`),
 * so whatever is staged belongs to a build that is not running — a worker
 * stopped mid-month leaves its rows here, and the next build drops them.
 */
export async function emptyStaging(client: Pick<PoolClient, 'query'> = pool): Promise<void> {
  await client.query('TRUNCATE readership_staging');
}

const FOLD_PAGE = 100_000;

/**
 * The titles a month stages under the floor (#1702): every redirect in place
 * and the article each points to, read in pages along the table's key. On the
 * development database, 26.2M redirects to 9.5M articles: some 140 MB of
 * hashes once read, after a peak of some 350 MB while the two hashes of every
 * redirect are sorted and the distinct ones copied out.
 */
export async function foldTitles(): Promise<FoldTitles> {
  const counted = await pool.query<{ n: string }>('SELECT count(*) AS n FROM wikipedia_redirects');
  let hashes = new Uint32Array(Number(counted.rows[0].n) * 2);
  let filled = 0;
  let after: { site: string; title: string } | null = null;
  for (;;) {
    const page: QueryResult<{ site: string; title: string; target: string }> = await pool.query(after
      ? `SELECT site, title, target FROM wikipedia_redirects WHERE (site, title) > ($2::text, $3::text) ORDER BY site, title LIMIT $1::int`
      : 'SELECT site, title, target FROM wikipedia_redirects ORDER BY site, title LIMIT $1::int',
    after ? [FOLD_PAGE, after.site, after.title] : [FOLD_PAGE]);
    if (filled + page.rows.length * 2 > hashes.length) {
      // A build of the redirects swapped in a larger table since the count.
      const grown = new Uint32Array((filled + page.rows.length * 2) * 2);
      grown.set(hashes.subarray(0, filled));
      hashes = grown;
    }
    for (const row of page.rows) {
      hashes[filled++] = titleHash(row.site, row.title);
      hashes[filled++] = titleHash(row.site, row.target);
    }
    if (page.rows.length < FOLD_PAGE) break;
    after = page.rows[page.rows.length - 1];
  }
  return FoldTitles.ofHashes(hashes.subarray(0, filled));
}

export interface MonthRead {
  buildId: number;
  /** The month's first day, `YYYY-MM-01`. */
  month: string;
  fileName: string;
  lines: number;
  /** Every Wikipedia edition's views that month, by sitelink site code. */
  editions: ReadonlyMap<string, number>;
  /**
   * The last month of the window the month was asked for by name, `YYYY-MM-01`
   * (#2230), or null for a month of the current year, the twelve ending on the
   * newest dump: a current month leaves with the twelve, an earlier year's stays.
   */
  windowEnd: string | null;
}

/**
 * Refuse a month that looks cut short (ADR-0055 decision 1): the file's own
 * checks passed, and still a real month carries hundreds of millions of lines
 * and hundreds of editions.
 */
export function refuseShortMonth(read: Pick<MonthRead, 'fileName' | 'lines' | 'editions'>, floors = { lines: MIN_MONTH_LINES, editions: MIN_EDITIONS }): void {
  const editions = read.editions.size;
  if (read.lines < floors.lines || editions < floors.editions) {
    throw new Error(`${read.fileName} looks cut short: ${read.lines.toLocaleString('en')} lines and ${editions} Wikipedia editions, where a month has at least ${floors.lines.toLocaleString('en')} and ${floors.editions}`);
  }
}

/**
 * Sum the month's staged rows, join them to items and swap the month in, in
 * one transaction: the month's old rows go, the new ones come, and the file
 * it came from is recorded. Every edition is kept: which editions a door
 * counts (ADR-0055, over 15 million views a year) is read off the twelve
 * months' `editions` totals, not decided by one month. Answers how many rows
 * were kept.
 */
export async function keepMonth(read: MonthRead): Promise<number> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM readership_months WHERE month = $1::date', [read.month]);
    const kept = await client.query(
      `WITH joined AS (
         SELECT l.id AS item, p.site, p.views, p.mobile, p.daily
           FROM readership_staging p
           -- A redirect's views count under the article it points to (ADR-0055 decision 2, #1650).
           LEFT JOIN wikipedia_redirects rd ON rd.site = p.site AND rd.title = p.title
           JOIN wikidata_sitelinks l ON l.site = p.site AND l.title = COALESCE(rd.target, p.title)
          WHERE p.build_id = $2::int),
       per_day AS (
         SELECT j.item, j.site, d.day, sum(d.views) AS views
           FROM joined j CROSS JOIN LATERAL unnest(j.daily) WITH ORDINALITY AS d(views, day)
          GROUP BY j.item, j.site, d.day),
       series AS (
         SELECT item, site, array_agg(views ORDER BY day) AS daily FROM per_day GROUP BY item, site)
       INSERT INTO readership_months (month, item, site, views, mobile, daily)
       SELECT $1::date, j.item, j.site, sum(j.views), sum(j.mobile), s.daily
         FROM joined j
         LEFT JOIN series s ON s.item = j.item AND s.site = j.site
        GROUP BY j.item, j.site, s.daily
       HAVING sum(j.views) >= $3::int`,
      [read.month, read.buildId, MONTH_FLOOR],
    );
    await client.query(
      `WITH redirects AS (SELECT build_id, dump_date FROM wikipedia_redirect_builds ORDER BY swapped_at DESC LIMIT 1)
       INSERT INTO readership_month_files (month, file_name, build_id, lines, editions, kept, redirects_dump_date, redirects_build_id, window_end)
       VALUES ($1::date, $2, $3, $4, $5::jsonb, $6,
               (SELECT dump_date FROM redirects), (SELECT build_id FROM redirects), $7::date)
       ON CONFLICT (month) DO UPDATE SET file_name = EXCLUDED.file_name, build_id = EXCLUDED.build_id,
         lines = EXCLUDED.lines, editions = EXCLUDED.editions, kept = EXCLUDED.kept,
         redirects_dump_date = EXCLUDED.redirects_dump_date, redirects_build_id = EXCLUDED.redirects_build_id, built_at = NOW(),
         window_end = EXCLUDED.window_end`,
      [read.month, read.fileName, read.buildId, read.lines, JSON.stringify(Object.fromEntries(read.editions)), kept.rowCount ?? 0, read.windowEnd],
    );
    await emptyStaging(client);
    await client.query('COMMIT');
    return kept.rowCount ?? 0;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

export interface KeptMonth {
  fileName: string;
  builtAt: Date;
  lines: number;
  redirects: number | null;
  /** The window the month was asked for by name, `YYYY-MM-01`, or null for a month of the current year (#2230). */
  windowEnd: string | null;
}

/**
 * The months kept, by their first day, with the file each came from, the build
 * of the redirects it was folded with, and the window it was asked for (#2230).
 */
export async function keptMonths(): Promise<Map<string, KeptMonth>> {
  const result = await pool.query<{ month: string; file_name: string; built_at: Date; lines: string; redirects: number | null; window_end: string | null }>(
    `SELECT to_char(month, 'YYYY-MM-DD') AS month, file_name, built_at, lines, redirects_build_id AS redirects,
            to_char(window_end, 'YYYY-MM-DD') AS window_end
       FROM readership_month_files ORDER BY month`,
  );
  return new Map(result.rows.map(r => [r.month, {
    fileName: r.file_name, builtAt: r.built_at, lines: Number(r.lines), redirects: r.redirects, windowEnd: r.window_end,
  }]));
}

/**
 * The build of the redirects in place (#1650), or null where none were ever
 * built: the build, not its dump date, since one date can be built twice over
 * a subset whose sitelinks changed between.
 */
export async function redirectsInPlace(): Promise<number | null> {
  const result = await pool.query<{ build_id: number }>(
    'SELECT build_id FROM wikipedia_redirect_builds ORDER BY swapped_at DESC LIMIT 1',
  );
  return result.rows[0]?.build_id ?? null;
}

/**
 * Drop the current year's months before `first`: readership reads the last
 * twelve (ADR-0055 decision 1). A month kept for an earlier year an admin asked
 * for (`window_end` set, #2230) stays, rows and record alike, whatever its date.
 */
export async function dropMonthsBefore(first: string): Promise<number> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM readership_months WHERE month < $1::date
          AND month NOT IN (SELECT month FROM readership_month_files WHERE window_end IS NOT NULL)`,
      [first],
    );
    const files = await client.query('DELETE FROM readership_month_files WHERE month < $1::date AND window_end IS NULL', [first]);
    await client.query('COMMIT');
    return files.rowCount ?? 0;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

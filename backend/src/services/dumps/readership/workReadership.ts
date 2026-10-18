/**
 * What the world reads of a work (ADR-0055), read back from the year the
 * readership build keeps: the user views over twelve months in every counted
 * edition, English included, which is the measure ADR-0056's door compares
 * against the world tier's median.
 *
 * A (work, edition) pair at 5,000 views a year or more whose phone share is
 * 2.5 or more in log-odds off its edition's yearly share does not count
 * (decision 3): it adds nothing to the work's sum, and it is left out of the
 * series the burst flag reads (decision 4).
 */

import { pool } from '../../../db/index.js';
import { countedEditions } from '../wikipedia/redirectBuild.js';
import { latestReadership, readershipWindow } from './readershipBuild.js';

/** ADR-0055 decision 3: a pair is judged on its phone share from this many views a year. */
export const AUTOMATED_FROM_VIEWS = 5_000;
/** ADR-0055 decision 3: how far a pair's phone share may stray from its edition's, in log-odds. */
export const AUTOMATED_LOG_ODDS = 2.5;
/** ADR-0055 decision 4: a week holding this share of the year is a burst. */
export const BURST_WEEK_SHARE = 0.25;
/** ADR-0055 decision 4: a monthly coefficient of variation from this is a burst. */
export const BURST_MONTHLY_CV = 0.5;

/** The year a reading is taken over: its months, and the editions a door counts. */
export interface ReadershipYear { months: string[]; editions: string[] }

/**
 * The year in place, or null when no reading can be trusted: no year built,
 * or one whose months are not all folded with the redirects in place (#1650),
 * which a rebuild is still reading again.
 */
export async function readershipYear(): Promise<ReadershipYear | null> {
  const latest = await latestReadership();
  if (!latest || latest.needs !== 'nothing') return null;
  return { months: readershipWindow(latest.dumpDate), editions: await countedEditions() };
}

const logOdds = (share: number) => {
  const p = Math.min(Math.max(share, 1e-6), 1 - 1e-6);
  return Math.log(p / (1 - p));
};

/** Whether a pair's phone share keeps it out of every sum (ADR-0055 decision 3). */
export function automated(views: number, mobile: number, editionShare: number | undefined): boolean {
  if (views < AUTOMATED_FROM_VIEWS || editionShare === undefined) return false;
  return Math.abs(logOdds(mobile / views) - logOdds(editionShare)) >= AUTOMATED_LOG_ODDS;
}

/** Each counted edition's phone share over the year: one pass over the year's rows. */
async function editionShares(year: ReadershipYear): Promise<Map<string, number>> {
  const result = await pool.query<{ site: string; share: number }>(
    `SELECT site, sum(mobile)::float8 / nullif(sum(views), 0) AS share
       FROM readership_months
      WHERE site = ANY($1::text[]) AND month = ANY($2::date[])
      GROUP BY site`,
    [year.editions, year.months],
  );
  return new Map(result.rows.filter(row => row.share !== null).map(row => [row.site, row.share]));
}

/** A work's counted pairs: the editions whose views it sums. */
type CountedPairs = Map<string, Set<string>>;

/**
 * The year's views of each item over the editions a door counts, without the
 * pairs decision 3 sets aside, and the pairs it counted; an item read in no
 * counted edition is absent.
 */
export async function readWorks(
  year: ReadershipYear,
  items: readonly string[],
): Promise<{ views: Map<string, number>; counted: CountedPairs }> {
  const shares = await editionShares(year);
  const result = await pool.query<{ item: string; site: string; views: string; mobile: string }>(
    `SELECT item, site, sum(views) AS views, sum(mobile) AS mobile
       FROM readership_months
      WHERE item = ANY($1::text[]) AND site = ANY($2::text[]) AND month = ANY($3::date[])
      GROUP BY item, site`,
    [items, year.editions, year.months],
  );
  const views = new Map<string, number>();
  const counted: CountedPairs = new Map();
  for (const row of result.rows) {
    const pairViews = Number(row.views);
    if (automated(pairViews, Number(row.mobile), shares.get(row.site))) continue;
    views.set(row.item, (views.get(row.item) ?? 0) + pairViews);
    const sites = counted.get(row.item) ?? new Set<string>();
    sites.add(row.site);
    counted.set(row.item, sites);
  }
  return { views, counted };
}

/** One month of a work's series: its views and, where the month kept it, the views of each day. */
export interface MonthSeries { views: number; daily: number[] | null }

/**
 * ADR-0055 decision 4 over one work's year, its months in order: a quarter of
 * the year in one week, or a monthly coefficient of variation of 0.5 or more.
 * A month with no daily series still counts in the coefficient.
 */
export function isBurst(months: readonly MonthSeries[]): boolean {
  const total = months.reduce((sum, month) => sum + month.views, 0);
  if (total === 0) return false;
  const mean = total / months.length;
  const variance = months.reduce((sum, month) => sum + (month.views - mean) ** 2, 0) / months.length;
  if (Math.sqrt(variance) / mean >= BURST_MONTHLY_CV) return true;
  const days = months.flatMap(month => month.daily ?? []);
  let week = 0;
  for (let day = 0; day < days.length; day++) {
    week += days[day] - (day >= 7 ? days[day - 7] : 0);
    if (week >= BURST_WEEK_SHARE * total) return true;
  }
  return false;
}

/** Add one day-by-day series onto another, the longer one setting the length. */
function addDaily(into: number[] | null, from: number[] | null): number[] | null {
  if (!from) return into;
  if (!into) return [...from];
  for (let day = 0; day < from.length; day++) into[day] = (into[day] ?? 0) + from[day];
  return into;
}

/** The works among `items` whose year is a burst, read on the pairs `readWorks` counted. */
export async function burstsAmong(
  year: ReadershipYear,
  items: readonly string[],
  counted: CountedPairs,
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const result = await pool.query<{ item: string; site: string; month: string; views: number; daily: number[] | null }>(
    `SELECT item, site, to_char(month, 'YYYY-MM-DD') AS month, views, daily
       FROM readership_months
      WHERE item = ANY($1::text[]) AND site = ANY($2::text[]) AND month = ANY($3::date[])`,
    [items, year.editions, year.months],
  );
  const series = new Map<string, Map<string, MonthSeries>>();
  for (const row of result.rows) {
    if (!counted.get(row.item)?.has(row.site)) continue;
    const months = series.get(row.item) ?? new Map<string, MonthSeries>();
    const month = months.get(row.month) ?? { views: 0, daily: null };
    month.views += row.views;
    month.daily = addDaily(month.daily, row.daily);
    months.set(row.month, month);
    series.set(row.item, months);
  }
  const bursts = new Set<string>();
  for (const [item, months] of series) {
    const ordered = year.months.map(month => months.get(month) ?? { views: 0, daily: null });
    if (isBurst(ordered)) bursts.add(item);
  }
  return bursts;
}

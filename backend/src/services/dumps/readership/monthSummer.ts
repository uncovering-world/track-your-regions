/**
 * One month's file summed per Wikipedia article (#1436, ADR-0055): the access
 * methods of a title added together, its phone share kept, its daily series
 * kept where the month is large enough for a door to read it, and every
 * edition's own total counted as the denominator.
 *
 * The file is sorted by edition and then by title, so a title's access methods
 * are adjacent lines and are summed as they pass, with no table of every title
 * in memory. A title's other spellings (`%XX`, `%uXXXX`) sort elsewhere; they
 * are staged as rows of their own under the decoded title, whatever their
 * count, and the month's SQL sums them (`readershipMonth.ts`).
 *
 * Measured on September 2026 (#1436): 262.8M lines in the 80 editions over the
 * counted line, 181.9M titles, 35.9M of them with 10 views or more (36.9M over
 * every edition). The floor keeps those; the daily series is kept at 400 a
 * month, ADR-0055's 5,000 a year, where the burst flag and the
 * automated-traffic check read.
 *
 * Both floors read the run of adjacent lines, the plain spelling, before the
 * encoded spellings are added in SQL: a title at 9 views plain and a few
 * encoded is not kept, though its spellings sum to 10. The encoded spellings
 * are 17k of September's 263M lines, so the floor moves by a few views at most.
 *
 * A redirect readership folds, and the article it folds into, are staged
 * whatever their count (`folded`, #1702), and the month's SQL applies the
 * floor to the article once its redirects are summed into it: a work read
 * through many rare spellings, each under 10, reads them all.
 */

import { addDaily, decodeTitle, parsePageviewLine, siteOf } from './pageviewLine.js';

/** A title's month as it is staged: the edition by its sitelink site code, and the decoded title. */
export interface StagedRow {
  site: string;
  title: string;
  views: number;
  /** Views on a phone: the mobile web and the app. */
  mobile: number;
  /** One count per day of the month, where the row reaches `dailyFloor`; null otherwise. */
  daily: number[] | null;
}

export interface MonthSummerOptions {
  /** Days in the month the file covers. */
  days: number;
  /** A title under this many views in the month is not staged (an encoded spelling always is, and so is a folded title). */
  floor: number;
  /** The titles staged under the floor: a redirect readership folds, and the article it folds into (`foldTitles.ts`). */
  folded: { has(site: string, title: string): boolean };
  /** A title at this many views or more keeps its daily series. */
  dailyFloor: number;
  /** How many rows to hand on at once. */
  batch: number;
  /** Takes a batch; the read waits for it, so a slow write slows the read rather than filling memory. */
  onBatch: (rows: StagedRow[]) => Promise<void>;
}

export const MONTH_FLOOR = 10;
export const DAILY_FLOOR = 400;

export class MonthSummer {
  /** Every Wikipedia edition's month total, by site code: the denominator a door divides by. */
  readonly editionViews = new Map<string, number>();
  lines = 0;
  /** Lines of a Wikipedia edition whose title came in an encoded spelling. */
  encoded = 0;
  private rows: StagedRow[] = [];
  private key: string | null = null;
  private current: { site: string; title: string; encoded: boolean; views: number; mobile: number; codes: string[] } | null = null;

  constructor(private readonly options: MonthSummerOptions) {}

  /** One line of the file; resolves once the batch it completed, if any, is taken. */
  async line(text: string): Promise<void> {
    this.lines++;
    const row = parsePageviewLine(text);
    if (!row) return;
    const site = siteOf(row.wiki);
    this.editionViews.set(site, (this.editionViews.get(site) ?? 0) + row.views);
    const key = `${site}\t${row.rawTitle}`;
    if (key !== this.key) {
      await this.close();
      const encoded = row.rawTitle.includes('%');
      if (encoded) this.encoded++;
      this.key = key;
      this.current = { site, title: decodeTitle(row.rawTitle), encoded, views: 0, mobile: 0, codes: [] };
    }
    const current = this.current!;
    current.views += row.views;
    if (row.access !== 'desktop') current.mobile += row.views;
    current.codes.push(row.daily);
  }

  /** Stage the last title and hand on what is left. */
  async finish(): Promise<void> {
    await this.close();
    await this.flush();
  }

  private async close(): Promise<void> {
    const current = this.current;
    this.current = null;
    this.key = null;
    if (!current) return;
    if (current.views < this.options.floor && !current.encoded && !this.options.folded.has(current.site, current.title)) return;
    let daily: number[] | null = null;
    if (current.views >= this.options.dailyFloor) {
      daily = new Array<number>(this.options.days).fill(0);
      for (const code of current.codes) addDaily(daily, code);
    }
    this.rows.push({ site: current.site, title: current.title, views: current.views, mobile: current.mobile, daily });
    if (this.rows.length >= this.options.batch) await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    const rows = this.rows;
    this.rows = [];
    await this.options.onBatch(rows);
  }
}

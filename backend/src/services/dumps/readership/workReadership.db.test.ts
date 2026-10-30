import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { readershipWindow } from './readershipBuild.js';
import { burstsAmong, readAtLeast, readershipYear, readWorks } from './workReadership.js';

/**
 * A work's year read back from the readership tables (ADR-0055, ADR-0056),
 * against PostgreSQL. The year ends in September 2026; English and German are
 * counted editions and West Frisian, at 1,000 views a month, is not. A work is
 * read 1,000 times a month in English, half on phones as the edition is, and
 * 1,000 times a month in German almost entirely on desktops while German as a
 * whole reads half on phones: that pair is a machine's (decision 3).
 */

const WORK = 'Q99157401';
const FILLER = 'Q99157402';
const SPIKE = 'Q99157403';
const ITEMS = [WORK, FILLER, SPIKE];
const months = readershipWindow('2026-09-01');
let pageviewsBuild = 0;
let redirectsBuild = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM readership_months WHERE item = ANY($1)', [ITEMS]);
  await pool.query('DELETE FROM readership_month_files');
  await pool.query('DELETE FROM wikipedia_redirect_builds');
}

async function read(item: string, site: string, views: (i: number) => number, mobile: (i: number) => number): Promise<void> {
  for (const [i, month] of months.entries()) {
    await pool.query(
      `INSERT INTO readership_months (month, item, site, views, mobile, daily)
       VALUES ($1::date, $2, $3, $4::int, $5::int, NULL)`,
      [month, item, site, views(i), mobile(i)],
    );
  }
}

beforeEach(async () => {
  await clear();
  const build = async (dump: string) => (await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status, request) VALUES ($1, 'local', 'success', '{"kind":"keep"}') RETURNING id`,
    [dump],
  )).rows[0].id;
  pageviewsBuild = await build('pageviews-user');
  redirectsBuild = await build('wikipedia-redirects');
  await pool.query(
    `INSERT INTO wikipedia_redirect_builds (build_id, dump_date, editions) VALUES ($1, '2026-10-01', '{}')`,
    [redirectsBuild],
  );
  for (const month of months) {
    await pool.query(
      `INSERT INTO readership_month_files (month, file_name, build_id, lines, editions, kept, redirects_dump_date, redirects_build_id)
       VALUES ($1::date, $2, $3, 60000000, '{"enwiki": 20000000, "dewiki": 16000000, "fywiki": 1000}', 1000, '2026-10-01', $4)`,
      [month, `pageviews-${month.slice(0, 4)}${month.slice(5, 7)}-user.bz2`, pageviewsBuild, redirectsBuild],
    );
  }
  await read(WORK, 'enwiki', () => 1_000, () => 500);
  await read(WORK, 'dewiki', () => 1_000, () => 10);
  await read(WORK, 'fywiki', () => 1_000, () => 500);
  // What sets German's own phone share near a half.
  await read(FILLER, 'dewiki', () => 100_000, () => 50_000);
  // A year read in one month.
  await read(SPIKE, 'enwiki', (i) => (i === 3 ? 50_000 : 100), (i) => (i === 3 ? 25_000 : 50));
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a work read back from the readership year', () => {
  it('reads the year in place over the counted editions, the most read first', async () => {
    expect(await readershipYear()).toEqual({ months, editions: ['enwiki', 'dewiki'] });
  });

  it('sums the counted editions and sets a machine-read pair aside', async () => {
    const year = (await readershipYear())!;
    const { views, counted } = await readWorks(year, [WORK]);
    // English counts; German is a machine's, and West Frisian is no counted edition.
    expect(views.get(WORK)).toBe(12_000);
    expect([...counted.get(WORK)!]).toEqual(['enwiki']);
  });

  it('flags the year read in one month, and not the steady one', async () => {
    const year = (await readershipYear())!;
    const { counted } = await readWorks(year, [WORK, SPIKE]);
    expect([...await burstsAmong(year, [WORK, SPIKE], counted)]).toEqual([SPIKE]);
  });

  it('names the items read at a bar in fewer editions than a floor, over the counted editions only (ADR-0152)', async () => {
    const year = (await readershipYear())!;
    const among = async (views: number, below: number) =>
      (await readAtLeast(year, views, below)).filter((item) => ITEMS.includes(item)).sort();
    // The work is read 24,000 times in its two counted editions; West Frisian's
    // 12,000 are no counted edition's, so it stays under a bar of 30,000.
    expect(await among(30_000, 3)).toEqual([FILLER, SPIKE]);
    expect(await among(20_000, 3)).toEqual([WORK, FILLER, SPIKE]);
    // Read in two editions, it is not under a floor of two.
    expect(await among(20_000, 2)).toEqual([FILLER, SPIKE]);
    expect(await among(100_000, 2)).toEqual([FILLER]);
    // A door's bar is a percentile between two readings and so a fraction, which
    // the bigint sum refused outright (#2159): read as the next whole number, so
    // 23,999.5 still names the work at 24,000 and 24,000.5 no longer does.
    expect(await among(23_999.5, 3)).toEqual([WORK, FILLER, SPIKE]);
    expect(await among(24_000.5, 3)).toEqual([FILLER, SPIKE]);
  });

  it('reads nothing while a month is not folded with the redirects in place', async () => {
    await pool.query(`UPDATE readership_month_files SET redirects_build_id = NULL WHERE month = $1::date`, [months[0]]);
    expect(await readershipYear()).toBeNull();
  });
});

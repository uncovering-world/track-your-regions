import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Readership kept by month (#1436, ADR-0055), against PostgreSQL. The file is
 * stood in for: `readDump` hands the build's consumer a month's lines and then
 * commits, as a verified read does, and the cut-short floors (fifty million
 * lines, eighty editions) are lifted for a fixture of a few lines. Cologne
 * Cathedral is a fixture item with an English and a German article; the
 * German one is read in two spellings.
 */

const reads = vi.hoisted(() => ({ files: [] as string[], lines: new Map<string, string[]>(), fail: new Set<string>() }));
vi.mock('../read.js', () => ({
  readDump: async (file: { fileName: string }, consumer: { line(t: string): Promise<void>; commit(): Promise<void>; abort(): Promise<void> }) => {
    reads.files.push(file.fileName);
    const lines = reads.lines.get(file.fileName) ?? [];
    for (const line of lines) await consumer.line(line);
    if (reads.fail.has(file.fileName)) {
      await consumer.abort();
      throw new Error(`size mismatch on ${file.fileName}`);
    }
    await consumer.commit();
    return { bytes: 1000, lines: lines.length, checksumActual: null };
  },
}));
vi.mock('../catalog.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../catalog.js')>()),
  dumpNamed: () => ({
    resolve: async (_read: unknown, _size: unknown, only: (name: string) => boolean) => {
      for (let m = 1; m <= 12; m++) {
        for (const year of [2025, 2026]) {
          const fileName = `pageviews-${year}${String(m).padStart(2, '0')}-user.bz2`;
          if (only(fileName)) return { key: 'pageviews-user', fileName, url: '', date: `${year}-${String(m).padStart(2, '0')}-01`, checksum: null, expectedBytes: 1000, compression: 'bzip2' };
        }
      }
      return null;
    },
  }),
}));
vi.mock('./readershipMonth.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./readershipMonth.js')>()),
  refuseShortMonth: () => undefined,
}));

import { pool } from '../../../db/index.js';
import type { DumpFile } from '../catalog.js';
import { buildReadership, latestReadership, readershipWindow } from './readershipBuild.js';

const ITEM = 'Q99436001';
const OTHER = 'Q99436002';
const CHAPEL = 'Q99436003';
let buildId = 0;

/** A month's lines: two editions over ADR-0055's counted line, and one far under it. */
function month(views: number): string[] {
  return [
    `de.wikipedia K%C3%B6lner_Dom 1 desktop 4 A4`,
    `de.wikipedia Kölner_Dom 1 desktop ${views} A${views}`,
    `de.wikipedia Kölner_Dom 1 mobile-web ${views * 3} A${views * 3}`,
    'de.wikipedia Zzz_Füllseite 9 desktop 1300000 A1300000',
    `en.wikipedia Cologne_Cathedral 2 desktop ${views * 2} A${views}B${views}`,
    'en.wikipedia Not_in_the_subset 3 desktop 500 A500',
    'en.wikipedia Zzz_Filler 4 mobile-app 1300000 A1300000',
    // An edition far under the counted line is kept too: which editions count is the year's to say.
    `fy.wikipedia Kölner_Dom 5 desktop 90 A90`,
  ];
}

const file = (yyyymm: string): DumpFile => ({
  key: 'pageviews-user', fileName: `pageviews-${yyyymm}-user.bz2`, url: '', date: `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}-01`,
  checksum: null, expectedBytes: 1000, compression: 'bzip2',
});

const options = () => ({ buildId, signal: new AbortController().signal, onPhase: () => undefined });

async function clear(): Promise<void> {
  await pool.query('DELETE FROM readership_months WHERE item = ANY($1)', [[ITEM, OTHER, CHAPEL]]);
  await pool.query('DELETE FROM readership_month_files');
  await pool.query('DELETE FROM readership_staging');
  await pool.query('DELETE FROM wikidata_sitelinks WHERE id = ANY($1)', [[ITEM, OTHER, CHAPEL]]);
  await pool.query(`DELETE FROM wikipedia_redirects WHERE site = 'enwiki' AND title = ANY($1)`, [['Cologne Minster', 'Small chapel']]);
}

beforeEach(async () => {
  await clear();
  reads.files = [];
  reads.lines.clear();
  reads.fail.clear();
  await pool.query(
    `INSERT INTO wikidata_sitelinks (id, site, title) VALUES
       ($1, 'dewiki', 'Kölner Dom'), ($1, 'enwiki', 'Cologne Cathedral'), ($1, 'fywiki', 'Kölner Dom'),
       ($2, 'dewiki', 'Zzz Füllseite')`,
    [ITEM, OTHER],
  );
  buildId = (await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status, request) VALUES ('pageviews-user', 'local', 'success', '{"kind":"keep"}') RETURNING id`,
  )).rows[0].id;
  for (const m of readershipWindow('2026-09-01')) {
    reads.lines.set(`pageviews-${m.slice(0, 4)}${m.slice(5, 7)}-user.bz2`, month(100));
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const rows = async (m: string) => (await pool.query<{ item: string; site: string; views: number; mobile: number; daily: number[] | null }>(
  `SELECT item, site, views, mobile, daily FROM readership_months WHERE month = $1::date AND item = ANY($2) ORDER BY item, site`,
  [m, [ITEM, OTHER, CHAPEL]],
)).rows;

describe('readership kept by month (#1436)', () => {
  it('keeps twelve months, each summed per item and edition, with every edition’s total', async () => {
    const built = await buildReadership(file('202609'), options());

    expect(reads.files).toHaveLength(12);
    expect(reads.files[0]).toBe('pageviews-202510-user.bz2');
    expect(built.summary).toMatch(/^kept 2025-10 /);
    const september = await rows('2026-09-01');
    // German: both spellings and both access methods summed, the phone views apart; English, under 400, keeps no series.
    expect(september).toContainEqual({ item: ITEM, site: 'dewiki', views: 404, mobile: 300, daily: expect.any(Array) });
    expect(september).toContainEqual({ item: ITEM, site: 'enwiki', views: 200, mobile: 0, daily: null });
    // Frisian, far under the counted line, is kept for the year to judge; a title with no sitelink is not.
    expect(september).toContainEqual({ item: ITEM, site: 'fywiki', views: 90, mobile: 0, daily: null });
    // Cologne in three editions and the German filler page: nothing for the unlinked title.
    expect(september).toHaveLength(4);
    const files = await pool.query<{ editions: Record<string, number>; lines: string }>(
      `SELECT editions, lines FROM readership_month_files WHERE month = '2026-09-01'`,
    );
    expect(files.rows[0].editions).toEqual({ dewiki: 1300404, enwiki: 1300700, fywiki: 90 });
    expect(Number(files.rows[0].lines)).toBe(8);
    expect(await latestReadership()).toMatchObject({ dumpDate: '2026-09-01', needs: 'nothing' });
  });

  it('keeps a daily series where the month reaches 400, from the spelling that carries the views', async () => {
    reads.lines.set('pageviews-202609-user.bz2', month(150));
    await buildReadership(file('202609'), options());
    const german = (await rows('2026-09-01')).find(r => r.site === 'dewiki')!;
    expect(german.views).toBe(604);
    expect(german.daily).toHaveLength(30);
    expect(german.daily![0]).toBe(600);
  });

  it('counts a redirect under its article whatever its own count, and applies the floor to the sum (#1702)', async () => {
    await pool.query(`INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, 'enwiki', 'Small Chapel')`, [CHAPEL]);
    await pool.query(
      `INSERT INTO wikipedia_redirects (site, title, target) VALUES
         ('enwiki', 'Cologne Minster', 'Cologne Cathedral'), ('enwiki', 'Small chapel', 'Small Chapel')`,
    );
    reads.lines.set('pageviews-202609-user.bz2', [
      ...month(100),
      'en.wikipedia Cologne_Minster 6 desktop 3 A3',
      'en.wikipedia Small_Chapel 7 desktop 6 A6',
      'en.wikipedia Small_chapel 8 desktop 5 A5',
    ]);
    await buildReadership(file('202609'), options());
    const september = await rows('2026-09-01');
    expect(september).toContainEqual({ item: ITEM, site: 'enwiki', views: 203, mobile: 0, daily: null });
    // Six views and five under a redirect: neither reaches the floor alone, the article does.
    expect(september).toContainEqual({ item: CHAPEL, site: 'enwiki', views: 11, mobile: 0, daily: null });
  });

  it('reads only the months it lacks, and drops the month that left the twelve', async () => {
    await buildReadership(file('202609'), options());
    reads.files = [];
    reads.lines.set('pageviews-202610-user.bz2', month(100));

    const built = await buildReadership(file('202610'), options());

    expect(reads.files).toEqual(['pageviews-202610-user.bz2']);
    expect(built.summary).toMatch(/dropped 1 month before 2025-11/);
    expect(await rows('2025-10-01')).toEqual([]);
    expect(await latestReadership()).toMatchObject({ dumpDate: '2026-10-01', needs: 'nothing' });

    reads.files = [];
    const again = await buildReadership(file('202610'), options());
    expect(reads.files).toEqual([]);
    expect(again.summary).toBe('every month of the twelve was kept already');
  });

  it('drops what a stopped build left staged before it reads a month', async () => {
    // A worker killed mid-month leaves its rows; nothing reads them, and the next build empties the table.
    await pool.query(`INSERT INTO readership_staging (build_id, site, title, views, mobile) VALUES ($1, 'dewiki', 'Kölner Dom', 99999, 0)`, [buildId - 1]);
    await buildReadership(file('202609'), options());
    expect((await pool.query('SELECT 1 FROM readership_staging')).rowCount).toBe(0);
    expect((await rows('2026-09-01')).find(r => r.site === 'dewiki')?.views).toBe(404);
  });

  it('keeps the months before a month that fails, stages nothing of it, and says a year is not whole', async () => {
    reads.fail.add('pageviews-202603-user.bz2');
    await expect(buildReadership(file('202609'), options())).rejects.toThrow(/size mismatch/);

    const kept = await pool.query<{ month: string }>(`SELECT to_char(month, 'YYYY-MM') AS month FROM readership_month_files ORDER BY month`);
    expect(kept.rows.map(r => r.month)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect((await pool.query('SELECT 1 FROM readership_staging')).rowCount).toBe(0);
    expect(await latestReadership()).toMatchObject({ dumpDate: '2026-02-01', needs: 'rebuild' });
  });
});

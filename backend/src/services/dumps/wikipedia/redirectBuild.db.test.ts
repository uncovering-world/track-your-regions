import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

/**
 * The redirects readership folds (#1650, ADR-0055 decision 2), against
 * PostgreSQL, with the dump files' lines stood in. Wanderer Above the Sea of
 * Fog drawn small: its English article and the redirect *Wanderer above the
 * Sea of Fog*, which differs by one capital letter and carries most of its
 * readers, its German article and a redirect to that, and
 * the redirects a build leaves out: one to an article no item names, a user
 * page's, an interwiki one. The year readership keeps counts English and
 * German Wikipedia and not a small edition.
 */

const DATE = '20261001';
const ITEM = 'Q99650001';
/** An item whose sitelink is itself a redirect page, an "intentional sitelink to redirect". */
const SKETCH = 'Q99650002';
const MONTH = '2001-01-01';

const file = (wiki: string, table: string): DumpFile => ({
  key: 'wikipedia-redirects', fileName: `${wiki}-${DATE}-${table}.sql.gz`,
  url: `https://dumps.wikimedia.org/${wiki}/${DATE}/${wiki}-${DATE}-${table}.sql.gz`,
  date: '2026-10-01', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 100, compression: 'gzip',
});

const created = (table: string, columns: string[]) => [
  `CREATE TABLE \`${table}\` (`, ...columns.map(c => `  \`${c}\` int NOT NULL,`), '  PRIMARY KEY (`x`)', ') ENGINE=InnoDB;',
];
const PAGE = ['page_id', 'page_namespace', 'page_title', 'page_is_redirect', 'page_is_new', 'page_random', 'page_touched',
  'page_links_updated', 'page_latest', 'page_len', 'page_content_model', 'page_lang'];
const REDIRECT = ['rd_from', 'rd_namespace', 'rd_title', 'rd_interwiki', 'rd_fragment'];
const page = (id: number, ns: number, title: string, redirect: number) =>
  `(${id},${ns},'${title}',${redirect},0,0.5,'20261001000000',NULL,1,30,'wikitext',NULL)`;

const FILES: Record<string, string[]> = {
  'enwiki-redirect': [...created('redirect', REDIRECT), 'INSERT INTO `redirect` VALUES',
    "(10,0,'Wanderer_Above_the_Sea_of_Fog','',''),",
    "(11,0,'Not_an_article_of_an_item','',''),",
    "(12,0,'Wanderer_Above_the_Sea_of_Fog','',''),",
    "(13,0,'Wanderer_Above_the_Sea_of_Fog','en',''),",
    "(14,0,'Wanderer_Above_the_Sea_of_Fog','','');"],
  'enwiki-page': [...created('page', PAGE), 'INSERT INTO `page` VALUES',
    `${page(1, 0, 'Wanderer_Above_the_Sea_of_Fog', 0)},`,
    `${page(10, 0, 'Wanderer_above_the_Sea_of_Fog', 1)},`,
    `${page(11, 0, 'Some_old_title', 1)},`,
    `${page(12, 2, 'Someone/Wanderer', 1)},`,
    `${page(13, 0, 'Interwiki_wanderer', 1)},`,
    `${page(14, 0, 'Wanderer_sketch', 1)};`],
  'dewiki-redirect': [...created('redirect', REDIRECT), 'INSERT INTO `redirect` VALUES',
    "(20,0,'Der_Wanderer_über_dem_Nebelmeer','','');"],
  'dewiki-page': [...created('page', PAGE), 'INSERT INTO `page` VALUES',
    `${page(2, 0, 'Der_Wanderer_über_dem_Nebelmeer', 0)},`,
    `${page(20, 0, 'Wanderer_über_dem_Nebelmeer', 1)};`],
};

/** The file whose verification fails, when a test names one. */
let damaged: string | null = null;
/** An edition whose run has not finished its tables, when a test names one. */
let unfinishedWiki: string | null = null;
const read: string[] = [];

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const [wiki, , rest] = dumpFile.fileName.split('-');
    const lines = FILES[`${wiki}-${rest.replace('.sql.gz', '')}`];
    read.push(dumpFile.fileName);
    for (const line of lines) await consumer.line(line);
    if (dumpFile.fileName === damaged) {
      await consumer.abort();
      throw new Error(`${dumpFile.fileName}: checksum mismatch`);
    }
    await consumer.commit();
    return { bytes: 100, lines: lines.length, checksumActual: 'a'.repeat(40) };
  }),
}));
vi.mock('../catalog.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../catalog.js')>(),
  wikipediaTableFile: vi.fn(async (_read: unknown, _key: unknown, wiki: string, _dir: string, _job: string, table: string) =>
    (wiki === unfinishedWiki ? null : file(wiki, table))),
}));

const { pool } = await import('../../../db/index.js');
const { buildRedirects } = await import('./redirectBuild.js');
const { keepMonth } = await import('../readership/readershipMonth.js');

let buildId = 0;
let yearBuild = 0;

async function build(): Promise<Awaited<ReturnType<typeof buildRedirects>>> {
  return buildRedirects(file('enwiki', 'redirect'), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
}

async function clear(): Promise<void> {
  await pool.query('TRUNCATE wikipedia_redirect_builds, wikipedia_redirects');
  await pool.query('DELETE FROM readership_months WHERE item = $1', [ITEM]);
  await pool.query('DELETE FROM readership_month_files WHERE month = $1', [MONTH]);
  await pool.query('DELETE FROM wikidata_sitelinks WHERE id = ANY($1)', [[ITEM, SKETCH]]);
  await pool.query("DELETE FROM dump_builds WHERE dump IN ('wikipedia-redirects') OR file_name = 'redirect-fixture-year'");
}

beforeEach(async () => {
  damaged = null;
  unfinishedWiki = null;
  read.length = 0;
  await clear();
  await pool.query(`INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, 'enwiki', 'Wanderer Above the Sea of Fog'),
                    ($1, 'dewiki', 'Der Wanderer über dem Nebelmeer'), ($2, 'enwiki', 'Wanderer sketch')`, [ITEM, SKETCH]);
  yearBuild = (await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status, file_name) VALUES ('pageviews-user', 'local', 'success', 'redirect-fixture-year') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO readership_month_files (month, file_name, build_id, lines, editions, kept)
     VALUES ($1, 'pageviews-200101-user.bz2', $2, 1, '{"enwiki": 900000000, "dewiki": 20000000, "xxwiki": 1000000}', 0)`,
    [MONTH, yearBuild],
  );
  buildId = (await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikipedia-redirects', 'local', 'running') RETURNING id`,
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const rows = async (sql: string) => (await pool.query(sql)).rows;

describe('buildRedirects (#1650)', () => {
  it('keeps the namespace-0 redirects to an article of an item, in every counted edition and no other, and leaves an item\'s own redirect sitelink its own', async () => {
    const result = await build();
    expect(await rows('SELECT site, title, target FROM wikipedia_redirects ORDER BY site')).toEqual([
      { site: 'dewiki', title: 'Wanderer über dem Nebelmeer', target: 'Der Wanderer über dem Nebelmeer' },
      { site: 'enwiki', title: 'Wanderer above the Sea of Fog', target: 'Wanderer Above the Sea of Fog' },
    ]);
    expect(read).toEqual([
      `enwiki-${DATE}-redirect.sql.gz`, `enwiki-${DATE}-page.sql.gz`, `dewiki-${DATE}-redirect.sql.gz`, `dewiki-${DATE}-page.sql.gz`,
    ]);
    expect(await rows('SELECT dump_date::text AS date, editions FROM wikipedia_redirect_builds')).toEqual([
      { date: '2026-10-01', editions: { enwiki: 1, dewiki: 1 } },
    ]);
    expect(result.summary).toMatch(/kept 2 redirects .* in 2 editions/);
  });

  it('swaps nothing in while an edition\'s tables of the date are not finished, and names it', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = (await pool.query<{ id: number }>(
      `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikipedia-redirects', 'local', 'running') RETURNING id`,
    )).rows[0].id;
    unfinishedWiki = 'dewiki';
    await expect(build()).rejects.toThrow(/has not finished the redirect and page tables of 1 counted editions \(dewiki\), so the redirects in place stay/);
    expect(await rows('SELECT site FROM wikipedia_redirects ORDER BY site')).toEqual([{ site: 'dewiki' }, { site: 'enwiki' }]);
    expect(await rows('SELECT count(*)::int AS n FROM wikipedia_redirect_builds')).toEqual([{ n: 1 }]);
  });

  it('keeps the redirects in place when a file fails its check, and leaves nothing staged', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = (await pool.query<{ id: number }>(
      `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikipedia-redirects', 'local', 'running') RETURNING id`,
    )).rows[0].id;
    damaged = `dewiki-${DATE}-page.sql.gz`;
    await expect(build()).rejects.toThrow(/checksum mismatch/);
    expect(await rows('SELECT count(*)::int AS n FROM wikipedia_redirects')).toEqual([{ n: 2 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM pg_tables WHERE tablename LIKE 'wikipedia_redirect%_stage' OR tablename = 'wikipedia_redirects_next'`))
      .toEqual([{ n: 0 }]);
  });
});

describe('a month folds an article\'s redirects under it (#1650)', () => {
  it('sums the views and daily series of the title and its redirect under the item, and records the redirects it was folded with', async () => {
    await build();
    await pool.query(
      `INSERT INTO readership_staging (build_id, site, title, views, mobile, daily) VALUES
         ($1, 'enwiki', 'Wanderer Above the Sea of Fog', 3738, 1000, '{100,200,300}'),
         ($1, 'enwiki', 'Wanderer above the Sea of Fog', 388094, 200000, '{10000,20000,30000}')`,
      [yearBuild],
    );
    await keepMonth({ buildId: yearBuild, month: MONTH, fileName: 'pageviews-200101-user.bz2', lines: 1, editions: new Map([['enwiki', 900000000]]) });
    expect(await rows(`SELECT site, views, mobile, daily FROM readership_months WHERE item = '${ITEM}'`)).toEqual([
      { site: 'enwiki', views: 391832, mobile: 201000, daily: [10100, 20200, 30300] },
    ]);
    expect(await rows(`SELECT redirects_dump_date::text AS date, redirects_build_id AS build FROM readership_month_files WHERE month = '${MONTH}'`))
      .toEqual([{ date: '2026-10-01', build: buildId }]);
  });
});

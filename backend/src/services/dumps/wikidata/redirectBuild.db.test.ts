/**
 * The item redirects' keeping build (ADR-0143 decision 3, #1895), against
 * PostgreSQL: what it keeps from Wikidata's redirect and page tables, what it
 * records, and that a build that cannot finish leaves the redirects in place.
 * The dump stream and the host's listing are mocked; the staging, the keep and
 * the swap are the real statements.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

const DATE = '20261003';

const file = (table: string): DumpFile => ({
  key: 'wikidata-redirects', fileName: `wikidatawiki-${DATE}-${table}.sql.gz`,
  url: `https://dumps.wikimedia.org/wikidatawiki/${DATE}/wikidatawiki-${DATE}-${table}.sql.gz`,
  date: '2026-10-03', checksum: { kind: 'sha1', value: 'b'.repeat(40) }, expectedBytes: 100, compression: 'gzip',
});

const created = (table: string, columns: string[]) => [
  `CREATE TABLE \`${table}\` (`, ...columns.map(c => `  \`${c}\` int NOT NULL,`), '  PRIMARY KEY (`x`)', ') ENGINE=InnoDB;',
];
const PAGE = ['page_id', 'page_namespace', 'page_title', 'page_is_redirect', 'page_is_new', 'page_random', 'page_touched',
  'page_links_updated', 'page_latest', 'page_len', 'page_content_model', 'page_lang'];
const REDIRECT = ['rd_from', 'rd_namespace', 'rd_title', 'rd_interwiki', 'rd_fragment'];
const page = (id: number, ns: number, title: string, redirect: number) =>
  `(${id},${ns},'${title}',${redirect},0,0.5,'20261003000000',NULL,1,30,'wikibase-item',NULL)`;

const FILES: Record<string, string[]> = {
  redirect: [...created('redirect', REDIRECT), 'INSERT INTO `redirect` VALUES',
    // An item merged into another; one pointing to itself; one to a page that
    // is no item; one in another namespace; one interwiki.
    "(10,0,'Q99895001','',''),",
    "(11,0,'Q99895011','',''),",
    "(12,0,'Wikidata:Sandbox','',''),",
    "(13,120,'P999','',''),",
    "(14,0,'Q99895001','en','');"],
  page: [...created('page', PAGE), 'INSERT INTO `page` VALUES',
    `${page(1, 0, 'Q99895001', 0)},`,
    `${page(10, 0, 'Q99895010', 1)},`,
    `${page(11, 0, 'Q99895011', 1)},`,
    `${page(12, 0, 'Q99895012', 1)},`,
    `${page(13, 120, 'P998', 1)},`,
    `${page(14, 0, 'Q99895014', 1)};`],
};

let damaged: string | null = null;
let pageUnfinished = false;
const read: string[] = [];

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const table = dumpFile.fileName.split('-')[2].replace('.sql.gz', '');
    read.push(dumpFile.fileName);
    for (const line of FILES[table]) await consumer.line(line);
    if (dumpFile.fileName === damaged) {
      await consumer.abort();
      throw new Error(`${dumpFile.fileName}: checksum mismatch`);
    }
    await consumer.commit();
    return { bytes: 100, lines: FILES[table].length, checksumActual: 'b'.repeat(40) };
  }),
}));
vi.mock('../catalog.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../catalog.js')>(),
  wikipediaTableFile: vi.fn(async (_read: unknown, _key: unknown, _wiki: string, _dir: string, _job: string, table: string) =>
    (table === 'page' && pageUnfinished ? null : file(table))),
}));

const { pool } = await import('../../../db/index.js');
const { buildWikidataRedirects } = await import('./redirectBuild.js');
const { latestWikidataRedirects } = await import('./redirectTables.js');

let buildId = 0;

async function build(): Promise<Awaited<ReturnType<typeof buildWikidataRedirects>>> {
  return buildWikidataRedirects(file('redirect'), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
}

async function newBuild(): Promise<void> {
  await pool.query("UPDATE workbench.dump_builds SET status = 'success' WHERE id = $1", [buildId]);
  buildId = (await pool.query<{ id: number }>(
    `INSERT INTO workbench.dump_builds (dump, mode, status) VALUES ('wikidata-redirects', 'local', 'running') RETURNING id`,
  )).rows[0].id;
}

async function clear(): Promise<void> {
  await pool.query('TRUNCATE workbench.wikidata_redirect_builds, workbench.wikidata_redirects');
  await pool.query("DELETE FROM workbench.dump_builds WHERE dump = 'wikidata-redirects'");
}

beforeEach(async () => {
  damaged = null;
  pageUnfinished = false;
  read.length = 0;
  await clear();
  buildId = (await pool.query<{ id: number }>(
    `INSERT INTO workbench.dump_builds (dump, mode, status) VALUES ('wikidata-redirects', 'local', 'running') RETURNING id`,
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const rows = async (sql: string) => (await pool.query(sql)).rows;

describe('buildWikidataRedirects (#1895)', () => {
  it('keeps every main-namespace item redirected to another item, and no other', async () => {
    const result = await build();
    expect(await rows('SELECT source, target FROM workbench.wikidata_redirects ORDER BY source')).toEqual([
      { source: 'Q99895010', target: 'Q99895001' },
    ]);
    expect(read).toEqual([`wikidatawiki-${DATE}-redirect.sql.gz`, `wikidatawiki-${DATE}-page.sql.gz`]);
    expect(await rows('SELECT dump_date::text AS date, kept FROM workbench.wikidata_redirect_builds')).toEqual([{ date: '2026-10-03', kept: 1 }]);
    expect(result.summary).toMatch(/kept 1 items Wikidata redirected to another, from the 2026-10-03 dump; read 2 files/);
    expect(await latestWikidataRedirects()).toMatchObject({ dumpDate: '2026-10-03', needs: 'nothing' });
  });

  it('swaps nothing in while the run has not finished its page table, and names it', async () => {
    await build();
    await newBuild();
    pageUnfinished = true;
    await expect(build()).rejects.toThrow(/has not finished the page table, so the item redirects in place stay/);
    expect(await rows('SELECT count(*)::int AS n FROM workbench.wikidata_redirects')).toEqual([{ n: 1 }]);
    expect(await rows('SELECT count(*)::int AS n FROM workbench.wikidata_redirect_builds')).toEqual([{ n: 1 }]);
  });

  it('keeps the redirects in place when a file fails its check, and leaves nothing staged', async () => {
    await build();
    await newBuild();
    damaged = `wikidatawiki-${DATE}-page.sql.gz`;
    await expect(build()).rejects.toThrow(/checksum mismatch/);
    expect(await rows('SELECT count(*)::int AS n FROM workbench.wikidata_redirects')).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM pg_tables
                         WHERE schemaname = 'workbench' AND (tablename LIKE 'wikidata_redirect%_stage' OR tablename = 'wikidata_redirects_next')`))
      .toEqual([{ n: 0 }]);
  });
});

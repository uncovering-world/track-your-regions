import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

/**
 * A keeping build of English Wikipedia's structure (#1440), against
 * PostgreSQL, with the dump files' lines stood in. Two museum articles, one
 * of them filed under a hidden tracking category, a redirect, a user page and
 * a file that are filed too, and a category filed under another; the
 * linktarget table names a template beside the categories.
 */

const DATE = '20261001';
const file = (table: string): DumpFile => ({
  key: 'enwiki-page', fileName: `enwiki-${DATE}-${table}.sql.gz`, url: `https://dumps.wikimedia.org/enwiki/${DATE}/enwiki-${DATE}-${table}.sql.gz`,
  date: '2026-10-01', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 100, compression: 'gzip',
});

/** A table's definition as the dump writes it, naming its columns in order. */
const created = (table: string, columns: string[]) => [
  `CREATE TABLE \`${table}\` (`, ...columns.map(c => `  \`${c}\` int NOT NULL,`), '  PRIMARY KEY (`x`)', ') ENGINE=InnoDB;',
];
const COLUMNS: Record<string, string[]> = {
  page: ['page_id', 'page_namespace', 'page_title', 'page_is_redirect', 'page_is_new', 'page_random', 'page_touched',
    'page_links_updated', 'page_latest', 'page_len', 'page_content_model', 'page_lang'],
  page_props: ['pp_page', 'pp_propname', 'pp_value', 'pp_sortkey'],
  linktarget: ['lt_id', 'lt_namespace', 'lt_title'],
  categorylinks: ['cl_from', 'cl_sortkey', 'cl_timestamp', 'cl_sortkey_prefix', 'cl_type', 'cl_collation_id', 'cl_target_id'],
};

const ROWS: Record<string, string[]> = {
  page: [
    'INSERT INTO `page` VALUES',
    "(100,0,'Pergamon_Fixture_Museum',0,0,0.5,'20261001000000',NULL,1,100,'wikitext',NULL),",
    "(101,0,'Neues_Fixture_Museum',0,0,0.5,'20261001000000',NULL,1,100,'wikitext',NULL),",
    "(102,0,'Pergamon_Fixture',1,0,0.5,'20261001000000',NULL,1,30,'wikitext',NULL),",
    "(200,14,'Archaeological_fixture_museums_in_Germany',0,0,0.5,'20261001000000',NULL,1,50,'wikitext',NULL),",
    "(201,14,'Fixture_museums_in_Berlin',0,0,0.5,'20261001000000',NULL,1,50,'wikitext',NULL),",
    "(202,14,'Fixture_articles_with_short_description',0,0,0.5,'20261001000000',NULL,1,50,'wikitext',NULL),",
    "(300,2,'Someone/Museums',0,0,0.5,'20261001000000',NULL,1,50,'wikitext',NULL);",
  ],
  page_props: [
    'INSERT INTO `page_props` VALUES',
    "(100,'wikibase_item','Q98451',NULL),",
    "(100,'page_image_free','Fixture.jpg',NULL),",
    "(101,'wikibase_item','Q98452',NULL),",
    "(102,'wikibase_item','Q98451',NULL),",
    "(200,'wikibase_item','Q98453',NULL),",
    "(202,'hiddencat','',NULL),",
    "(300,'wikibase_item','Q98454',NULL);",
  ],
  linktarget: [
    'INSERT INTO `linktarget` VALUES',
    "(1,14,'Archaeological_fixture_museums_in_Germany'),",
    "(2,14,'Fixture_museums_in_Berlin'),",
    "(3,14,'Fixture_articles_with_short_description'),",
    "(4,10,'Infobox_fixture_museum'),",
    "(5,14,'Archaeological_fixture_museums_by_country');",
  ],
  categorylinks: [
    'INSERT INTO `categorylinks` VALUES',
    "(100,'KEY','2026-01-01 00:00:00','','page',1,1),",
    "(100,'KEY','2026-01-01 00:00:00','','page',1,2),",
    "(100,'KEY','2026-01-01 00:00:00','','page',1,3),",
    "(101,'KEY','2026-01-01 00:00:00','','page',1,2),",
    "(102,'KEY','2026-01-01 00:00:00','','page',1,2),",
    "(200,'KEY','2026-01-01 00:00:00','','subcat',1,5),",
    "(300,'KEY','2026-01-01 00:00:00','','page',1,2),",
    "(400,'KEY','2026-01-01 00:00:00','','file',1,2);",
  ],
};

/** Each file's lines: its definition, then its rows; a test may rewrite either. */
let LINES: Record<string, string[]> = {};
const lines = () => Object.fromEntries(Object.keys(ROWS).map(table => [table, [...created(table, COLUMNS[table]), ...ROWS[table]]]));

/** The file whose verification fails, when a test names one. */
let damaged: string | null = null;

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const table = /-(\w+)\.sql\.gz$/.exec(dumpFile.fileName)![1];
    for (const line of LINES[table]) await consumer.line(line);
    if (dumpFile.fileName === damaged) {
      await consumer.abort();
      throw new Error(`${dumpFile.fileName}: checksum mismatch`);
    }
    await consumer.commit();
    return { bytes: 100, lines: LINES[table].length, checksumActual: 'a'.repeat(40) };
  }),
}));
vi.mock('../catalog.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../catalog.js')>(),
  dumpNamed: vi.fn(() => ({ resolve: async (_read: unknown, _size: unknown, only: (name: string) => boolean) => {
    const table = ['page_props', 'linktarget', 'categorylinks'].find(t => only(`enwiki-${DATE}-${t}.sql.gz`));
    return table ? file(table) : null;
  } })),
}));

const { pool } = await import('../../../db/index.js');
const { buildStructure } = await import('./structureBuild.js');
const { createNextTables, dropNextTables, latestStructure, swapIn } = await import('./structureTables.js');

let buildId = 0;
async function build(): Promise<Awaited<ReturnType<typeof buildStructure>>> {
  return buildStructure(file('page'), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
}

const rows = async (sql: string) => (await pool.query(sql)).rows;

beforeEach(async () => {
  damaged = null;
  LINES = lines();
  await pool.query('TRUNCATE enwiki_structure_builds, enwiki_pages, enwiki_page_items, enwiki_categories, enwiki_category_links');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'enwiki-page'");
  const row = await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status) VALUES ('enwiki-page', 'local', 'running') RETURNING id`,
  );
  buildId = row.rows[0].id;
});

afterAll(async () => {
  await pool.query('TRUNCATE enwiki_structure_builds, enwiki_pages, enwiki_page_items, enwiki_categories, enwiki_category_links');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'enwiki-page'");
  await pool.end();
});

describe('buildStructure (#1440)', () => {
  it("refuses a dump whose table names another column where the build reads one, and keeps what is in place", async () => {
    await build();
    // A schema change that moves a column the build reads by position: cl_type one place on.
    LINES.categorylinks = [...created('categorylinks', [
      'cl_from', 'cl_sortkey', 'cl_timestamp', 'cl_sortkey_prefix', 'cl_collation_id', 'cl_type', 'cl_target_id',
    ]), ...ROWS.categorylinks];
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = (await pool.query<{ id: number }>(
      `INSERT INTO dump_builds (dump, mode, status) VALUES ('enwiki-page', 'local', 'running') RETURNING id`,
    )).rows[0].id;

    await expect(build()).rejects.toThrow(/categorylinks table has `cl_collation_id` at position 5, where cl_type is read/);
    expect(await rows('SELECT count(*)::int AS n FROM enwiki_category_links')).toEqual([{ n: 4 }]);
  });

  it('refuses to swap in a structure that kept no row of a table', async () => {
    LINES.linktarget = [...created('linktarget', COLUMNS.linktarget), 'INSERT INTO `linktarget` VALUES', "(4,10,'Infobox_fixture_museum');"];

    await expect(build()).rejects.toThrow(/kept no row of enwiki_categories, enwiki_category_links/);
    expect(await latestStructure()).toBeNull();
  });

  it('rolls the swap back when the build is cancelled while it is made, and keeps what is in place', async () => {
    await build();
    await createNextTables();
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(swapIn(buildId, '2026-10-15', { enwiki_pages: 0 }, cancelled.signal)).rejects.toThrow();

    expect(await latestStructure()).toMatchObject({ dumpDate: '2026-10-01' });
    expect(await rows('SELECT count(*)::int AS n FROM enwiki_pages')).toEqual([{ n: 5 }]);
    await dropNextTables();
  });

  it("records the page table's own figures as the build's read, and the four files' in the summary", async () => {
    const { lines: read, summary } = await build();
    expect(read).toBe(LINES.page.length);
    expect(summary).toContain('read 4 files');
  });

  it('keeps the articles and categories that are no redirect, and their Wikidata items', async () => {
    await build();
    expect(await rows('SELECT id, namespace, title FROM enwiki_pages ORDER BY id')).toEqual([
      { id: 100, namespace: 0, title: 'Pergamon_Fixture_Museum' },
      { id: 101, namespace: 0, title: 'Neues_Fixture_Museum' },
      { id: 200, namespace: 14, title: 'Archaeological_fixture_museums_in_Germany' },
      { id: 201, namespace: 14, title: 'Fixture_museums_in_Berlin' },
      { id: 202, namespace: 14, title: 'Fixture_articles_with_short_description' },
    ]);
    expect(await rows('SELECT page, item FROM enwiki_page_items ORDER BY page')).toEqual([
      { page: 100, item: 'Q98451' }, { page: 101, item: 'Q98452' }, { page: 200, item: 'Q98453' },
    ]);
  });

  it("keeps the categories a link may name less the hidden ones, and the articles' and categories' links to them", async () => {
    const { summary } = await build();
    expect(await rows('SELECT id, title FROM enwiki_categories ORDER BY id')).toEqual([
      { id: 1, title: 'Archaeological_fixture_museums_in_Germany' },
      { id: 2, title: 'Fixture_museums_in_Berlin' },
      { id: 5, title: 'Archaeological_fixture_museums_by_country' },
    ]);
    expect(await rows('SELECT page, category, subcat FROM enwiki_category_links ORDER BY page, category')).toEqual([
      { page: 100, category: 1, subcat: false },
      { page: 100, category: 2, subcat: false },
      { page: 101, category: 2, subcat: false },
      { page: 200, category: 5, subcat: true },
    ]);
    expect(summary).toContain('1 hidden ones left out');
  });

  it('records the build with its dump date, and the tables carry their indexes once swapped in', async () => {
    await build();
    expect(await latestStructure()).toMatchObject({ dumpDate: '2026-10-01', needs: 'nothing' });
    const indexes = (await rows("SELECT indexname FROM pg_indexes WHERE tablename LIKE 'enwiki\\_%' ORDER BY indexname")).map(r => r.indexname);
    expect(indexes).toEqual(expect.arrayContaining([
      'enwiki_pages_pkey', 'enwiki_pages_namespace_title_key', 'idx_enwiki_page_items_item', 'idx_enwiki_category_links_category',
      'enwiki_category_links_pkey', 'enwiki_categories_title_key',
    ]));
    expect(await rows("SELECT tablename FROM pg_tables WHERE tablename LIKE 'enwiki\\_%\\_next'")).toEqual([]);
  });

  it('leaves the structure in place as it was when a file fails its check, and drops the copies', async () => {
    await build();
    damaged = `enwiki-${DATE}-categorylinks.sql.gz`;
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = (await pool.query<{ id: number }>(
      `INSERT INTO dump_builds (dump, mode, status) VALUES ('enwiki-page', 'local', 'running') RETURNING id`,
    )).rows[0].id;

    await expect(build()).rejects.toThrow(/checksum mismatch/);

    expect(await rows('SELECT count(*)::int AS n FROM enwiki_category_links')).toEqual([{ n: 4 }]);
    expect(await rows('SELECT count(*)::int AS n FROM enwiki_structure_builds')).toEqual([{ n: 1 }]);
    expect(await rows("SELECT tablename FROM pg_tables WHERE tablename LIKE 'enwiki\\_%\\_next'")).toEqual([]);
  });
});

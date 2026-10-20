import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

/**
 * The Wikidata items each Wikivoyage edition uses (#1768, decided on #1718), against
 * PostgreSQL, with the dump files' lines stood in, shaped as the 2026-10-01
 * `wbc_entity_usage` and `page` tables wrote them. English Wikivoyage's Bath
 * article uses the Roman Baths twice over (two aspects) and a property, and a
 * user's draft uses Stapleton International Airport; German Wikivoyage's Arles
 * article uses the Arles Amphitheatre; Russian Wikivoyage's register of
 * Belarus's heritage uses an item, and a redirect uses another. Every
 * other edition's tables are empty.
 */

const DATE = '20261001';
const BATHS = 'Q2540426';
const ARLES = 'Q181189';
const STAPLETON = 'Q1436575';
/** A fixture item, no real one: what a register's list names. */
const REGISTERED = 'Q99768001';


const file = (wiki: string, table = 'wbc_entity_usage'): DumpFile => ({
  key: 'wikivoyage-usage', fileName: `${wiki}-${DATE}-${table}.sql.gz`,
  url: `https://dumps.wikimedia.org/${wiki}/${DATE}/${wiki}-${DATE}-${table}.sql.gz`,
  date: '2026-10-01', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 100, compression: 'gzip',
});

const created = (table: string, columns: string[]) => [
  `CREATE TABLE \`${table}\` (`, ...columns.map(c => `  \`${c}\` int NOT NULL,`), '  PRIMARY KEY (`x`)', ') ENGINE=InnoDB;',
  `INSERT INTO \`${table}\` VALUES`,
];
const USAGE = ['eu_row_id', 'eu_entity_id', 'eu_aspect', 'eu_page_id'];
const PAGE = ['page_id', 'page_namespace', 'page_title', 'page_is_redirect', 'page_is_new', 'page_random', 'page_touched',
  'page_links_updated', 'page_latest', 'page_len', 'page_content_model', 'page_lang'];
const page = (id: number, ns: number, title: string, redirect = 0) =>
  `(${id},${ns},'${title}',${redirect},0,0.5,'20261001000000',NULL,1,30,'wikitext',NULL)`;
const rowsOf = (lines: string[]) => lines.map((line, i) => `${line}${i === lines.length - 1 ? ';' : ','}`);

const FILES: Record<string, string[]> = {
  'enwikivoyage-wbc_entity_usage': [...created('wbc_entity_usage', USAGE),
    ...rowsOf([`(1,'${BATHS}','C.P625',17)`, `(2,'${BATHS}','S',17)`, "(3,'P1082','L.en',17)", `(4,'${STAPLETON}','T',90)`])],
  'enwikivoyage-page': [...created('page', PAGE), ...rowsOf([page(17, 0, 'Bath'), page(90, 2, 'Someone/Denver')])],
  'dewikivoyage-wbc_entity_usage': [...created('wbc_entity_usage', USAGE), ...rowsOf([`(1,'${ARLES}','O',40)`])],
  'dewikivoyage-page': [...created('page', PAGE), ...rowsOf([page(40, 0, 'Arles')])],
  'ruwikivoyage-wbc_entity_usage': [...created('wbc_entity_usage', USAGE), ...rowsOf([`(1,'${REGISTERED}','O',5)`, "(2,'Q99768002','O',6)"])],
  'ruwikivoyage-page': [...created('page', PAGE),
    ...rowsOf([page(5, 0, 'Культурное_наследие_Беларуси/Брестская_область'), page(6, 0, 'Старый_Брест', 1)])],
};
const empty = (table: string) => created(table, table === 'page' ? PAGE : USAGE).slice(0, -1);

/** The file whose verification fails, when a test names one. */
let damaged: string | null = null;
/** An edition whose run has not finished its table, when a test names one. */
let unfinishedWiki: string | null = null;
const read: string[] = [];

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const [wiki, , rest] = dumpFile.fileName.split('-');
    const name = rest.replace('.sql.gz', '');
    const lines = FILES[`${wiki}-${name}`] ?? empty(name);
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
  wikiRunFile: vi.fn(async (_read: unknown, _key: unknown, wiki: string, _dir: string, _job: string, suffix: string) =>
    (wiki === unfinishedWiki ? null : file(wiki, suffix.replace('.sql.gz', '')))),
}));

const { pool } = await import('../../../db/index.js');
const { buildUsage, WIKIVOYAGE_EDITIONS } = await import('./usageBuild.js');
const { latestUsage, usedByAGuide } = await import('./usageTables.js');

let buildId = 0;

const newBuild = async () => (await pool.query<{ id: number }>(
  `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikivoyage-usage', 'local', 'running') RETURNING id`,
)).rows[0].id;

async function build(): Promise<Awaited<ReturnType<typeof buildUsage>>> {
  return buildUsage(file('enwikivoyage'), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
}

async function clear(): Promise<void> {
  await pool.query('TRUNCATE wikivoyage_usage_builds, wikivoyage_usage');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'wikivoyage-usage'");
}

beforeEach(async () => {
  damaged = null;
  unfinishedWiki = null;
  read.length = 0;
  await clear();
  buildId = await newBuild();
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const rows = async (sql: string) => (await pool.query(sql)).rows;

describe('buildUsage (#1768)', () => {
  it("keeps each item an edition's guide articles use once, and no property, draft, redirect or register, and records the build", async () => {
    const result = await build();
    expect(await rows('SELECT item, site FROM wikivoyage_usage ORDER BY site')).toEqual([
      { item: ARLES, site: 'dewikivoyage' },
      { item: BATHS, site: 'enwikivoyage' },
    ]);
    expect(read).toHaveLength(WIKIVOYAGE_EDITIONS.length * 2);
    expect(read.slice(0, 2)).toEqual([`enwikivoyage-${DATE}-page.sql.gz`, `enwikivoyage-${DATE}-wbc_entity_usage.sql.gz`]);
    const [record] = await rows('SELECT dump_date::text AS date, editions FROM wikivoyage_usage_builds');
    expect(record.date).toBe('2026-10-01');
    expect(record.editions).toMatchObject({ enwikivoyage: 1, dewikivoyage: 1, ruwikivoyage: 0, itwikivoyage: 0 });
    expect(result.summary).toMatch(/kept 2 items that 27 Wikivoyage editions use \(English 1\)/);
    expect(await latestUsage()).toMatchObject({ dumpDate: '2026-10-01', needs: 'nothing' });
    expect(await usedByAGuide([BATHS, ARLES, STAPLETON, REGISTERED])).toEqual(new Set([BATHS, ARLES]));
  });

  it("swaps nothing in while an edition's table of the date is not finished, and names it", async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    unfinishedWiki = 'dewikivoyage';
    await expect(build()).rejects.toThrow(/has not finished the item usage and page tables of 1 Wikivoyage editions \(dewikivoyage\), so the usage in place stays/);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_usage')).toEqual([{ n: 2 }]);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_usage_builds')).toEqual([{ n: 1 }]);
  });

  it('keeps the usage in place when a file fails its check, and leaves no copy behind', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    damaged = `dewikivoyage-${DATE}-wbc_entity_usage.sql.gz`;
    await expect(build()).rejects.toThrow(/checksum mismatch/);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_usage')).toEqual([{ n: 2 }]);
    expect(await rows("SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'wikivoyage_usage_next'")).toEqual([{ n: 0 }]);
  });

  it('says no usage is in place before a first build', async () => {
    expect(await latestUsage()).toBeNull();
  });
});

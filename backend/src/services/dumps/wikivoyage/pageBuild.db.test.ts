import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

/**
 * English Wikivoyage's pages kept from its dump (#2089), against PostgreSQL,
 * with the files' lines stood in, shaped as the 20261001 run wrote its
 * `pages-articles` XML and its `page_props` table: the Algeria article with
 * its item, the Alger redirect, a template the build passes over, and an
 * article whose page properties name no item.
 */

const DATE = '20261001';
/** Fixture items, no real ones. */
const ALGERIA_ITEM = 'Q99208901';
const TEMPLATE_ITEM = 'Q99208902';

const file = (suffix: string): DumpFile => ({
  key: 'wikivoyage-pages', fileName: `enwikivoyage-${DATE}-${suffix}`,
  url: `https://dumps.wikimedia.org/enwikivoyage/${DATE}/enwikivoyage-${DATE}-${suffix}`,
  date: '2026-10-01', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 100,
  compression: suffix.endsWith('.bz2') ? 'bzip2' : 'gzip',
});
const ARTICLES = 'pages-articles.xml.bz2';
const PROPS = 'page_props.sql.gz';

const page = (lines: string[]) => ['  <page>', ...lines, '  </page>'];
const XML = [
  '<mediawiki xml:lang="en">',
  ...page(['    <title>Algeria</title>', '    <ns>0</ns>', '    <id>2195</id>', '    <revision>', '      <id>5049871</id>',
    '      <text bytes="60" xml:space="preserve">==Regions==', '{{Regionlist', '| region1name=[[Northern Algeria]]', '}}</text>',
    '    </revision>']),
  ...page(['    <title>Alger</title>', '    <ns>0</ns>', '    <id>40211</id>', '    <redirect title="Algiers" />',
    '      <text bytes="20" xml:space="preserve">#REDIRECT [[Algiers]]</text>']),
  ...page(['    <title>Template:Regionlist</title>', '    <ns>10</ns>', '    <id>77</id>',
    '      <text bytes="9" xml:space="preserve">{{{1}}}</text>']),
  ...page(['    <title>Northern Algeria</title>', '    <ns>0</ns>', '    <id>2196</id>',
    '      <text bytes="12" xml:space="preserve">Coastal cities.</text>']),
  '</mediawiki>',
];
const PROPS_LINES = [
  'CREATE TABLE `page_props` (', '  `pp_page` int NOT NULL,', '  `pp_propname` varbinary(60) NOT NULL,',
  '  `pp_value` blob NOT NULL,', '  `pp_sortkey` float DEFAULT NULL,', '  PRIMARY KEY (`pp_page`,`pp_propname`)', ') ENGINE=InnoDB;',
  `INSERT INTO \`page_props\` VALUES (2195,'wikibase_item','${ALGERIA_ITEM}',NULL),(2195,'page_image_free','Algeria.jpg',NULL),`
    + `(77,'wikibase_item','${TEMPLATE_ITEM}',NULL),(2196,'wikibase_item','not an item',NULL);`,
];

/** The file whose verification fails, when a test names one. */
let damaged: string | null = null;
/** Whether the run has finished its page properties. */
let propsFinished = true;
/** How many of the article file's lines a test hands over, when it cuts the file short. */
let articleLines: number | null = null;

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const all = dumpFile.fileName.endsWith(PROPS) ? PROPS_LINES : XML;
    const lines = dumpFile.fileName.endsWith(ARTICLES) && articleLines !== null ? all.slice(0, articleLines) : all;
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
  wikiRunFile: vi.fn(async (_read: unknown, _key: unknown, _wiki: string, _dir: string, _job: string, suffix: string) =>
    (propsFinished ? file(suffix) : null)),
}));

const { pool } = await import('../../../db/index.js');
const { buildPages } = await import('./pageBuild.js');
const { latestPages } = await import('./pageTables.js');

let buildId = 0;

/** A new running build, the one before it closed: a dump has one active build at a time. */
async function newBuild(): Promise<number> {
  await pool.query("UPDATE dump_builds SET status = 'success' WHERE dump = 'wikivoyage-pages' AND status = 'running'");
  return (await pool.query<{ id: number }>(
    `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikivoyage-pages', 'local', 'running') RETURNING id`,
  )).rows[0].id;
}

const build = () => buildPages(file(ARTICLES), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
const kept = async () => (await pool.query(
  'SELECT title, page_id, redirect_to, wikitext, wikidata_id FROM wikivoyage_pages ORDER BY title',
)).rows;

async function clear(): Promise<void> {
  await pool.query('TRUNCATE wikivoyage_pages_builds, wikivoyage_pages');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'wikivoyage-pages'");
}

beforeEach(async () => {
  damaged = null;
  propsFinished = true;
  articleLines = null;
  await clear();
  buildId = await newBuild();
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("English Wikivoyage's pages from its dump (#2089)", () => {
  it('keeps every article and redirect of namespace 0 with the item its page properties name, and records the build', async () => {
    const result = await build();

    expect(await kept()).toEqual([
      { title: 'Alger', page_id: 40211, redirect_to: 'Algiers', wikitext: '#REDIRECT [[Algiers]]', wikidata_id: null },
      { title: 'Algeria', page_id: 2195, redirect_to: null, wikitext: '==Regions==\n{{Regionlist\n| region1name=[[Northern Algeria]]\n}}', wikidata_id: ALGERIA_ITEM },
      { title: 'Northern Algeria', page_id: 2196, redirect_to: null, wikitext: 'Coastal cities.', wikidata_id: null },
    ]);
    expect((await pool.query('SELECT articles, redirects, items FROM wikivoyage_pages_builds WHERE build_id = $1', [buildId])).rows)
      .toEqual([{ articles: 2, redirects: 1, items: 1 }]);
    expect(await latestPages()).toMatchObject({ dumpDate: '2026-10-01', needs: 'nothing' });
    expect(result.summary).toContain('kept 2 articles and 1 redirects');
  });

  it('replaces the pages in place whole on the next build', async () => {
    await build();
    buildId = await newBuild();
    await build();

    expect((await kept()).map(row => row.title)).toEqual(['Alger', 'Algeria', 'Northern Algeria']);
    expect((await pool.query('SELECT count(*)::int AS n FROM wikivoyage_pages_builds')).rows[0].n).toBe(2);
  });

  it('leaves the pages in place where the run has not finished its page properties', async () => {
    await build();
    buildId = await newBuild();
    propsFinished = false;

    await expect(build()).rejects.toThrow('has not finished English Wikivoyage\'s page properties');
    expect(await kept()).toHaveLength(3);
  });

  it('leaves the pages in place where the article file fails its checksum or ends inside a text', async () => {
    await build();
    buildId = await newBuild();
    damaged = file(ARTICLES).fileName;
    await expect(build()).rejects.toThrow('checksum mismatch');

    damaged = null;
    articleLines = 8;
    await expect(build()).rejects.toThrow('ends inside a page\'s text');

    expect(await kept()).toHaveLength(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM wikivoyage_pages_builds')).rows[0].n).toBe(1);
    expect((await pool.query("SELECT to_regclass('workbench.wikivoyage_pages_next') AS t")).rows[0].t).toBeNull();
  });
});

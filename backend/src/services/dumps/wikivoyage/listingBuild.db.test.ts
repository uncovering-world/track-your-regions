import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';

/**
 * The Wikivoyage listings (#1768, ADR-0128), against PostgreSQL, with the dump
 * files' lines stood in. English Wikivoyage lists the Roman Baths in Bath and
 * German Wikivoyage the Arles Amphitheatre; a talk page names Stapleton
 * International Airport, which no article lists. Every other edition's
 * articles are empty.
 */

const DATE = '20261001';
const BATHS = 'Q2540426';
const ARLES = 'Q181189';
const STAPLETON = 'Q1436575';

const file = (wiki: string): DumpFile => ({
  key: 'wikivoyage-listings', fileName: `${wiki}-${DATE}-pages-articles.xml.bz2`,
  url: `https://dumps.wikimedia.org/${wiki}/${DATE}/${wiki}-${DATE}-pages-articles.xml.bz2`,
  date: '2026-10-01', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 100, compression: 'bzip2',
});

const page = (title: string, ns: number, text: string) => ['<page>', `<title>${title}</title>`, `<ns>${ns}</ns>`, text, '</page>'];

const FILES: Record<string, string[]> = {
  enwikivoyage: [
    ...page('Bath', 0, `* {{see | name=Roman Baths | wikidata=${BATHS} }}`),
    ...page('Talk:Denver', 1, `{{see | name=Stapleton | wikidata=${STAPLETON} }}`),
  ],
  dewikivoyage: page('Arles', 0, `{{vCard | name=Amphitheater | wikidata=${ARLES} }}`),
};

/** The file whose verification fails, when a test names one. */
let damaged: string | null = null;
/** An edition whose run has not finished its articles, when a test names one. */
let unfinishedWiki: string | null = null;
const read: string[] = [];

vi.mock('../read.js', () => ({
  readDump: vi.fn(async (dumpFile: DumpFile, consumer: DumpConsumer) => {
    const lines = FILES[dumpFile.fileName.split('-')[0]] ?? [];
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
  wikiRunFile: vi.fn(async (_read: unknown, _key: unknown, wiki: string) => (wiki === unfinishedWiki ? null : file(wiki))),
}));

const { pool } = await import('../../../db/index.js');
const { buildListings, WIKIVOYAGE_EDITIONS } = await import('./listingBuild.js');
const { latestListings, listedAmong } = await import('./listingTables.js');

let buildId = 0;

const newBuild = async () => (await pool.query<{ id: number }>(
  `INSERT INTO dump_builds (dump, mode, status) VALUES ('wikivoyage-listings', 'local', 'running') RETURNING id`,
)).rows[0].id;

async function build(): Promise<Awaited<ReturnType<typeof buildListings>>> {
  return buildListings(file('enwikivoyage'), { buildId, signal: new AbortController().signal, onPhase: () => undefined });
}

async function clear(): Promise<void> {
  await pool.query('TRUNCATE wikivoyage_listing_builds, wikivoyage_listings');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'wikivoyage-listings'");
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

describe('buildListings (#1768)', () => {
  it("keeps the item each article's listing names, with its edition and article, in every edition, and records the build", async () => {
    const result = await build();
    expect(await rows('SELECT item, site, title FROM wikivoyage_listings ORDER BY site')).toEqual([
      { item: ARLES, site: 'dewikivoyage', title: 'Arles' },
      { item: BATHS, site: 'enwikivoyage', title: 'Bath' },
    ]);
    expect(read).toHaveLength(WIKIVOYAGE_EDITIONS.length);
    expect(read[0]).toBe(`enwikivoyage-${DATE}-pages-articles.xml.bz2`);
    const [record] = await rows('SELECT dump_date::text AS date, editions FROM wikivoyage_listing_builds');
    expect(record.date).toBe('2026-10-01');
    expect(record.editions).toMatchObject({ enwikivoyage: 1, dewikivoyage: 1, itwikivoyage: 0 });
    expect(result.summary).toMatch(/kept 2 listings that name a Wikidata item in 28 Wikivoyage editions \(English 1\)/);
    expect(await latestListings()).toMatchObject({ dumpDate: '2026-10-01', needs: 'nothing' });
    expect(await listedAmong([BATHS, ARLES, STAPLETON])).toEqual(new Set([BATHS, ARLES]));
  });

  it("swaps nothing in while an edition's articles of the date are not finished, and names it", async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    unfinishedWiki = 'dewikivoyage';
    await expect(build()).rejects.toThrow(/has not finished the articles of 1 Wikivoyage editions \(dewikivoyage\), so the listings in place stay/);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_listings')).toEqual([{ n: 2 }]);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_listing_builds')).toEqual([{ n: 1 }]);
  });

  it('keeps the listings in place when a file fails its check, and leaves no copy behind', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    damaged = `dewikivoyage-${DATE}-pages-articles.xml.bz2`;
    await expect(build()).rejects.toThrow(/checksum mismatch/);
    expect(await rows('SELECT count(*)::int AS n FROM wikivoyage_listings')).toEqual([{ n: 2 }]);
    expect(await rows("SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'wikivoyage_listings_next'")).toEqual([{ n: 0 }]);
  });

  it('says no listings are in place before a first build', async () => {
    expect(await latestListings()).toBeNull();
  });
});

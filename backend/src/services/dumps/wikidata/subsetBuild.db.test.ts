import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from '../../../db/index.js';
import type { DumpFile } from '../catalog.js';
import type { DumpConsumer } from '../read.js';
import { at, dumpLine, item, unknown } from './dumpLineFixture.js';

/**
 * A build of the local Wikidata subset against PostgreSQL (ADR-0105): the
 * reads of the dump are replaced by a handful of lines written the way the
 * dump writes them, and everything after them is the real thing — the scope,
 * the compact entities, the labels ring, the derived tables, the indexes and
 * the swap. The tables are the test database's own.
 */

let lines: string[] = [];
let failOnPass: number | null = null;
let pass = 0;

vi.mock('../read.js', () => ({
  readDump: async (_file: DumpFile, consumer: DumpConsumer) => {
    pass += 1;
    try {
      // As the read does: a consumer that splits lines itself gets the text in a piece.
      if (consumer.chunk) await consumer.chunk(new TextEncoder().encode(`${['[', ...lines, ']'].join('\n')}\n`));
      else for (const line of ['[', ...lines, ']']) await consumer.line(line);
      if (failOnPass === pass) throw new Error('the stream was cut');
      await consumer.commit();
    } catch (error) {
      await consumer.abort();
      throw error;
    }
    return { bytes: 1, lines: lines.length + 2, checksumActual: null };
  },
}));

const { buildSubset } = await import('./subsetBuild.js');

const LOUVRE_PALACE = 1075988;
const LOUVRE = 19675;
const SULLY_WING = 17309954;
const ROOM_325 = 19119449;
const CAPITAL = 106692454;
const MONA_LISA = 12418;
const PAINTING = 3305213;
const WORK_OF_ART = 838948;
const MUSEUM = 33506;
const LEONARDO = 762;

const DUMP = [
  dumpLine('P31', 'instance of', [], { datatype: 'wikibase-item' }),
  dumpLine('P279', 'subclass of', [], { datatype: 'wikibase-item' }),
  dumpLine('P276', 'location', [], { datatype: 'wikibase-item' }),
  dumpLine('P361', 'part of', [], { datatype: 'wikibase-item' }),
  dumpLine('P170', 'creator', [], { datatype: 'wikibase-item' }),
  dumpLine('P625', 'coordinate location', [], { datatype: 'globe-coordinate' }),
  // A NUL and a lone surrogate, which the dump holds and Postgres stores in
  // neither text nor jsonb: one in a spooled label, two in a kept entity's.
  dumpLine(`Q${LEONARDO}`, 'Leonardo da Vinci', [{ property: 31, value: item(5) }], { labels: { fr: 'Léonard de Vinci\0', ru: 'Леонардо да Винчи' } }),
  dumpLine(`Q${LOUVRE_PALACE}`, 'Louvre Palace', [{ property: 625, value: at(48.861, 2.336) }], { labels: { es: 'Palacio del Louvre\0', it: 'Palazzo \uD800del Louvre' } }),
  dumpLine(`Q${LOUVRE}`, 'Louvre Museum', [
    { property: 31, value: item(MUSEUM) }, { property: 276, value: item(LOUVRE_PALACE) },
    { property: 625, value: at(48.861, 2.3358) },
  ], { sitelinks: { enwiki: 'Louvre', frwiki: 'Musée du Louvre' } }),
  dumpLine(`Q${SULLY_WING}`, 'Sully Wing', [
    { property: 361, value: item(LOUVRE_PALACE) }, { property: 625, value: at(48.8605, 2.3383) },
  ]),
  dumpLine(`Q${ROOM_325}`, 'Room 325', [{ property: 276, value: item(SULLY_WING) }]),
  // A maker stated as an unknown value, as many ancient objects carry one.
  dumpLine(`Q${CAPITAL}`, 'Hathoric capital N 384', [
    { property: 276, value: item(ROOM_325) }, { property: 170, value: unknown },
  ]),
  dumpLine(`Q${MONA_LISA}`, 'Mona Lisa', [
    { property: 31, value: item(PAINTING) }, { property: 170, value: item(LEONARDO) },
    { property: 276, value: item(LOUVRE), rank: 'preferred' },
  ], { sitelinks: { enwiki: 'Mona Lisa' }, descriptions: { de: 'Gemälde von Leonardo da Vinci' } }),
  dumpLine(`Q${PAINTING}`, 'painting', [{ property: 279, value: item(WORK_OF_ART) }]),
  dumpLine(`Q${WORK_OF_ART}`, 'work of art', [{ property: 279, value: item(2342494) }]),
  dumpLine(`Q${MUSEUM}`, 'museum', [{ property: 279, value: item(1030034) }]),
];

const file: DumpFile = {
  key: 'wikidata-entities', fileName: 'subset-fixture-all.json.gz', url: 'https://dumps.wikimedia.org/subset-fixture-all.json.gz',
  date: '2026-10-05', checksum: null, expectedBytes: null, compression: 'gzip',
};

async function newBuild(): Promise<number> {
  const result = await pool.query<{ id: number }>(
    // Closed at once: only one build of a dump may be running, and this spec runs several in turn.
    `INSERT INTO dump_builds (dump, file_name, dump_date, url, mode, status) VALUES ('wikidata-entities', $1, '2026-10-05', $2, 'local', 'success') RETURNING id`,
    [file.fileName, file.url],
  );
  return result.rows[0].id;
}

async function build(): Promise<void> {
  pass = 0;
  await buildSubset(file, { buildId: await newBuild(), signal: new AbortController().signal, onPhase: () => undefined });
}

const ids = async (table: string) => (await pool.query<{ id: string }>(`SELECT DISTINCT id FROM ${table}`)).rows.map(r => r.id).sort();

beforeAll(async () => {
  lines = DUMP;
  await build();
});

afterAll(async () => {
  await pool.query('DELETE FROM wikidata_subset_builds');
  await pool.query("DELETE FROM dump_builds WHERE file_name = 'subset-fixture-all.json.gz'");
  for (const table of ['wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks', 'wikidata_class_closure']) {
    await pool.query(`TRUNCATE ${table}`);
  }
  await pool.end();
});

describe('a build of the local Wikidata subset (#1434)', () => {
  it('keeps the places, the works that name them, the chains and the classes, and every property', async () => {
    expect(await ids('wikidata_entities')).toEqual([
      'P170', 'P276', 'P279', 'P31', 'P361', 'P625',
      `Q${MONA_LISA}`, `Q${LOUVRE}`, `Q${ROOM_325}`, `Q${LOUVRE_PALACE}`, `Q${SULLY_WING}`, `Q${PAINTING}`,
      `Q${MUSEUM}`, `Q${CAPITAL}`, `Q${WORK_OF_ART}`,
    ].sort());
  });

  it('keeps an entity in its compact form', async () => {
    const { rows: [row] } = await pool.query(`SELECT sitelink_count, entity FROM wikidata_entities WHERE id = 'Q${MONA_LISA}'`);
    expect(row.sitelink_count).toBe(1);
    expect(row.entity.claims.P276[0]).toMatchObject({ value: `Q${LOUVRE}`, rank: 'preferred' });
    expect(row.entity.sitelinks).toEqual({ enwiki: 'Mona Lisa' });
  });

  it("gives every kept entity its labels and descriptions in the subset's languages", async () => {
    // A label with no description in one language, a description with no label in another: a row for each.
    const { rows } = await pool.query(`SELECT language, label, description FROM wikidata_labels WHERE id = 'Q${MONA_LISA}' ORDER BY language`);
    expect(rows).toEqual([
      { language: 'de', label: null, description: 'Gemälde von Leonardo da Vinci' },
      { language: 'en', label: 'Mona Lisa', description: null },
    ]);
  });

  it('keeps a label holding a NUL or a lone surrogate as Postgres can store it', async () => {
    const { rows: [row] } = await pool.query(`SELECT entity FROM wikidata_entities WHERE id = 'Q${LOUVRE_PALACE}'`);
    expect(row.entity.labels).toMatchObject({ es: 'Palacio del Louvre', it: 'Palazzo \uFFFDdel Louvre' });
    const { rows } = await pool.query(`SELECT language, label FROM wikidata_labels WHERE id = 'Q${LOUVRE_PALACE}' AND language IN ('es', 'it') ORDER BY language`);
    expect(rows).toEqual([{ language: 'es', label: 'Palacio del Louvre' }, { language: 'it', label: 'Palazzo \uFFFDdel Louvre' }]);
  });

  it('derives the claims, an item value apart from any other', async () => {
    const { rows } = await pool.query(
      `SELECT subject, property, rank, value_item, value FROM wikidata_claims WHERE subject IN ('Q${MONA_LISA}', 'Q${LOUVRE}') ORDER BY subject, property`,
    );
    expect(rows).toContainEqual({ subject: `Q${MONA_LISA}`, property: 'P276', rank: 1, value_item: `Q${LOUVRE}`, value: null });
    const coordinate = rows.find(r => r.subject === `Q${LOUVRE}` && r.property === 'P625');
    expect(coordinate).toMatchObject({ value_item: null, value: { latitude: 48.861, longitude: 2.3358 } });
  });

  it('keeps an unknown value out of value_item', async () => {
    const { rows } = await pool.query(`SELECT value_item, value FROM wikidata_claims WHERE subject = 'Q${CAPITAL}' AND property = 'P170'`);
    expect(rows).toEqual([{ value_item: null, value: { somevalue: true } }]);
  });

  it('names the maker a kept work names, in the subset\'s languages only', async () => {
    const { rows } = await pool.query(`SELECT language, label FROM wikidata_labels WHERE id = 'Q${LEONARDO}' ORDER BY language`);
    expect(rows).toEqual([{ language: 'en', label: 'Leonardo da Vinci' }, { language: 'fr', label: 'Léonard de Vinci' }]);
    expect(await ids('wikidata_entities')).not.toContain(`Q${LEONARDO}`);
  });

  it('derives the sitelinks and the class tree above each class a kept item is an instance of', async () => {
    const { rows: links } = await pool.query(`SELECT site, title FROM wikidata_sitelinks WHERE id = 'Q${LOUVRE}' ORDER BY site`);
    expect(links).toEqual([{ site: 'enwiki', title: 'Louvre' }, { site: 'frwiki', title: 'Musée du Louvre' }]);
    const { rows: above } = await pool.query(`SELECT ancestor FROM wikidata_class_closure WHERE class = 'Q${PAINTING}' ORDER BY ancestor`);
    expect(above.map(r => r.ancestor)).toEqual([`Q${PAINTING}`, 'Q2342494', `Q${WORK_OF_ART}`].sort());
  });

  it('records the build in place, and replaces the subset whole on the next one', async () => {
    lines = DUMP.filter(line => !line.includes('"Hathoric capital N 384"'));
    await build();
    expect(await ids('wikidata_entities')).not.toContain(`Q${CAPITAL}`);
    const { rows } = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'wikidata_claims' ORDER BY indexname");
    expect(rows.map(r => r.indexname)).toEqual(['idx_wikidata_claims_subject', 'idx_wikidata_claims_value_item']);
    const { rows: builds } = await pool.query('SELECT dump_date::text, counts FROM wikidata_subset_builds ORDER BY swapped_at');
    expect(builds).toHaveLength(2);
    expect(builds[1]).toMatchObject({ dump_date: '2026-10-05', counts: { coordinates: 3, classes: 3, chains: 0 } });
  });

  it('keeps nothing from a build cancelled after its reads', async () => {
    lines = DUMP;
    const controller = new AbortController();
    pass = 0;
    const build = buildSubset(file, {
      buildId: await newBuild(), signal: controller.signal,
      onPhase: message => { if (message.startsWith('Deriving')) controller.abort(); },
    });
    await expect(build).rejects.toThrow();
    expect(await ids('wikidata_entities')).not.toContain(`Q${CAPITAL}`);
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'wikidata_%_next'");
    expect(rows).toEqual([]);
  });

  it('leaves the subset in place when a build fails, with no half-built copy behind', async () => {
    lines = DUMP;
    failOnPass = 2;
    await expect(build()).rejects.toThrow('the stream was cut');
    failOnPass = null;
    expect(await ids('wikidata_entities')).not.toContain(`Q${CAPITAL}`);
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'wikidata_%_next'");
    expect(rows).toEqual([]);
  });

  it('reads the first pass back from beside a local copy instead of scanning the dump again (#1468)', async () => {
    lines = DUMP;
    const dir = mkdtempSync(join(tmpdir(), 'subset-'));
    try {
      const run = async () => {
        pass = 0;
        await buildSubset(file, { buildId: await newBuild(), dumpsDir: dir, signal: new AbortController().signal, onPhase: () => undefined });
        return pass;
      };
      expect(await run()).toBe(2);
      expect(existsSync(join(dir, `${file.fileName}.scope`))).toBe(true);
      expect(await run()).toBe(1);
      expect(await ids('wikidata_entities')).toContain(`Q${CAPITAL}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
/** On the failing pass, after how many pieces the read is cut, and with what. */
let cut: { afterPieces: number; error: Error } | null = null;
let pass = 0;
/** The pieces handed to a chunk consumer on the last pass. */
let handed = 0;
const LINES_PER_PIECE = 3;

// A build here starts its worker threads afresh for each pass, which takes seconds on a loaded
// machine, and several cases run two or three builds.
vi.setConfig({ testTimeout: 30_000 });

/** Wait until `count` pieces are recorded, as long as the workers take to start under load. */
async function piecesWritten(count: number): Promise<void> {
  for (let waited = 0; waited < 20_000; waited += 100) {
    const { rows: [row] } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM wikidata_build_pieces_next');
    if (row.n >= count) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

vi.mock('../read.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../read.js')>()),
  readDump: async (_file: DumpFile, consumer: DumpConsumer) => {
    pass += 1;
    handed = 0;
    const all = ['[', ...lines, ']'];
    try {
      // As the read does: a consumer that splits lines itself gets numbered
      // pieces of the text, the same pieces on every read of the file.
      if (consumer.chunk) {
        for (let at = 0; at < all.length; at += LINES_PER_PIECE) {
          if (failOnPass === pass && cut && handed === cut.afterPieces) {
            // Let the pieces already handed be written before the cut lands: a cut
            // stops the workers, and a piece a worker has not answered for is lost.
            await piecesWritten(cut.afterPieces);
            throw cut.error;
          }
          await consumer.chunk(new TextEncoder().encode(`${all.slice(at, at + LINES_PER_PIECE).join('\n')}\n`), at / LINES_PER_PIECE);
          handed += 1;
        }
      } else {
        for (const line of all) await consumer.line(line);
      }
      if (failOnPass === pass && !cut) throw new Error('the stream was cut');
      await consumer.commit();
    } catch (error) {
      await consumer.abort();
      throw error;
    }
    return { bytes: 1, lines: all.length, checksumActual: null };
  },
}));

const disk = vi.hoisted(() => ({ free: Number.MAX_SAFE_INTEGER }));
vi.mock('../localCopies.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../localCopies.js')>()),
  diskOf: async () => ({ device: 1, blocks: 1, bsize: 1, free: disk.free }),
}));

const { buildSubset, rederiveSubset } = await import('./subsetBuild.js');
const { createNextTables } = await import('./subsetTables.js');

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

async function build(notes: string[] = []): Promise<void> {
  pass = 0;
  await buildSubset(file, {
    buildId: await newBuild(), signal: new AbortController().signal, onPhase: () => undefined, onNote: note => notes.push(note),
  });
}

const nextTables = async () =>
  (await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE tablename LIKE 'wikidata_%_next' ORDER BY tablename")).rows.map(r => r.tablename);

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

  it('runs every step of a trial into copies and drops them, leaving the subset in place as it was (#1527)', async () => {
    lines = DUMP;
    const swapped = async () => (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM wikidata_subset_builds')).rows[0].n;
    const before = await swapped();
    pass = 0;
    const phases: string[] = [];
    const measured: Array<[number, number]> = [];
    const result = await buildSubset(file, {
      buildId: await newBuild(), signal: new AbortController().signal, onPhase: message => phases.push(message), trial: true,
      onMeasure: (read, total) => measured.push([read, total]),
    });
    expect(phases).toContain('Walking the class tree...');
    // What each long step says while it runs (#1519): the parts of a derivation, the index being built, the spool read.
    expect(phases.some(phase => /^Deriving the claims, labels and sitelinks: sitelinks, (\d+) of \1 parts done\.\.\.$/.test(phase))).toBe(true);
    expect(phases.some(phase => /^Indexing: index 1 of \d+, \w+\.\.\.$/.test(phase))).toBe(true);
    expect(measured.at(-1)?.[0]).toBe(measured.at(-1)?.[1]);
    expect(phases.at(-1)).toBe('Throwing the trial\'s tables away...');
    expect(result.summary).toMatch(/^kept \d+ of \d+ items .*the tables took \d+\.\d+ GB/);
    // The trial read the capital; the subset in place, built without it, is untouched.
    expect(await ids('wikidata_entities')).not.toContain(`Q${CAPITAL}`);
    expect(await swapped()).toBe(before);
    expect(await nextTables()).toEqual([]);
  });

  it('drops what a trial stopped before its end left, and runs (#1527)', async () => {
    // As a worker killed mid-trial leaves it: the copies, and the sample's spool named as theirs.
    await createNextTables('a trial that never ended', '/dumps/sample-4gb-wikidata-20261005-all.json.gz.terms.gz');
    pass = 0;
    await buildSubset({ ...file, fileName: 'sample-4gb-subset-fixture-all.json.gz' }, {
      buildId: await newBuild(), signal: new AbortController().signal, onPhase: () => undefined, trial: true,
    });
    expect(await nextTables()).toEqual([]);
  });

  it('refuses the write pass when the disk cannot hold it, before any copy is made (#1466)', async () => {
    lines = DUMP;
    disk.free = 0;
    try {
      await expect(build()).rejects.toThrow(/but it has 0 GB/);
    } finally {
      disk.free = Number.MAX_SAFE_INTEGER;
    }
    expect(pass).toBe(1);
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'wikidata_%_next'");
    expect(rows).toEqual([]);
  });

  it('leaves the subset in place when a build fails in pass 2, and keeps what the pass wrote (#1493)', async () => {
    lines = DUMP;
    failOnPass = 2;
    const notes: string[] = [];
    await expect(build(notes)).rejects.toThrow('the stream was cut');
    failOnPass = null;
    expect(await ids('wikidata_entities')).not.toContain(`Q${CAPITAL}`);
    expect(await nextTables()).toContain('wikidata_build_pieces_next');
    expect(notes).toContain('what pass 2 wrote is kept: the next build of this file picks up after it');
  });

  it('refuses a trial while a cut build\'s copies wait for the next build of its file (#1527)', async () => {
    const waiting = await nextTables();
    pass = 0;
    await expect(buildSubset({ ...file, fileName: 'sample-4gb-subset-fixture-all.json.gz' }, {
      buildId: await newBuild(), signal: new AbortController().signal, onPhase: () => undefined, trial: true,
    })).rejects.toThrow(/Finish that build first/);
    expect(await nextTables()).toEqual(waiting);
  });

  it('picks up after the pieces an earlier build wrote, and ends with what an uncut build makes (#1493)', async () => {
    // The previous case left a build cut after its whole read; cut this one after two pieces.
    lines = DUMP;
    await pool.query("DROP TABLE IF EXISTS wikidata_build_pieces_next, wikidata_build_resume_next");
    failOnPass = 2;
    cut = { afterPieces: 2, error: new Error('the worker was stopped') };
    await expect(build()).rejects.toThrow('the worker was stopped');
    failOnPass = null;
    cut = null;
    const { rows: [{ count }] } = await pool.query<{ count: string }>('SELECT count(*) FROM wikidata_build_pieces_next');
    expect(Number(count)).toBeGreaterThan(0);
    expect(Number(count)).toBeLessThanOrEqual(2);

    const notes: string[] = [];
    await build(notes);
    expect(notes.some(note => note.startsWith(`picked up after ${count} pieces`))).toBe(true);
    expect(await nextTables()).toEqual([]);
    expect(await ids('wikidata_entities')).toContain(`Q${CAPITAL}`);
    // Each entity labelled once, though a piece written again spooled its terms twice.
    const { rows } = await pool.query(`SELECT language, label FROM wikidata_labels WHERE id = 'Q${LEONARDO}' ORDER BY language`);
    expect(rows).toEqual([{ language: 'en', label: 'Leonardo da Vinci' }, { language: 'fr', label: 'Léonard de Vinci' }]);
    const { rows: [latest] } = await pool.query('SELECT counts FROM wikidata_subset_builds ORDER BY swapped_at DESC LIMIT 1');
    const { rows: [first] } = await pool.query('SELECT counts FROM wikidata_subset_builds ORDER BY swapped_at LIMIT 1');
    expect(latest.counts).toEqual(first.counts);
  });

  it('starts afresh after copies made for another file, scope or way of writing a line (#1493)', async () => {
    lines = DUMP;
    failOnPass = 2;
    cut = { afterPieces: 2, error: new Error('the worker was stopped') };
    await expect(build()).rejects.toThrow('the worker was stopped');
    failOnPass = null;
    cut = null;
    // As a raised WRITE_VERSION, another checksum or another scope would read.
    await pool.query("UPDATE wikidata_build_resume_next SET key = 'written by another version'");
    const notes: string[] = [];
    await build(notes);
    expect(notes.some(note => note.startsWith('picked up after'))).toBe(false);
    expect(await nextTables()).toEqual([]);
    expect(await ids('wikidata_entities')).toContain(`Q${CAPITAL}`);
  });

  it('starts afresh when the copies are there and their spool is not (#1493)', async () => {
    lines = DUMP;
    failOnPass = 2;
    // Past the third piece, whose Leonardo is spooled: the first two hold properties only.
    cut = { afterPieces: 4, error: new Error('the worker was stopped') };
    await expect(build()).rejects.toThrow('the worker was stopped');
    failOnPass = null;
    cut = null;
    // As a recreated container loses the spool in its temporary directory.
    rmSync(join(tmpdir(), `${file.fileName}.terms.gz`), { force: true });
    const notes: string[] = [];
    await build(notes);
    expect(notes).toContain('an earlier build\'s copies were found without its spool: starting afresh');
    expect(await nextTables()).toEqual([]);
    const { rows } = await pool.query(`SELECT language, label FROM wikidata_labels WHERE id = 'Q${LEONARDO}' ORDER BY language`);
    expect(rows).toEqual([{ language: 'en', label: 'Leonardo da Vinci' }, { language: 'fr', label: 'Léonard de Vinci' }]);
  });

  it('keeps nothing of a read the file did not pass, so no build picks up after it (#1493)', async () => {
    lines = DUMP;
    failOnPass = 2;
    cut = { afterPieces: 2, error: Object.assign(new Error('incorrect header check'), { code: 'Z_DATA_ERROR' }) };
    await expect(build()).rejects.toThrow('incorrect header check');
    failOnPass = null;
    cut = null;
    expect(await nextTables()).toEqual([]);
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

describe('deriving the subset again from the entities in place (#1526)', () => {
  const rederive = async (signal = new AbortController().signal, onPhase: (message: string) => void = () => undefined) =>
    rederiveSubset({ buildId: await newBuild(), signal, onPhase });
  const rows = async (sql: string) => (await pool.query(sql)).rows;
  const derived = async () => ({
    claims: await rows('SELECT subject, property, statement_id, rank, value_item, value FROM wikidata_claims ORDER BY statement_id'),
    labels: await rows('SELECT id, language, label, description FROM wikidata_labels ORDER BY id, language'),
    sitelinks: await rows('SELECT id, site, title FROM wikidata_sitelinks ORDER BY id, site'),
    closure: await rows('SELECT class, ancestor FROM wikidata_class_closure ORDER BY class, ancestor'),
  });

  it('makes the tables a build from the dump makes, the ring\'s labels carried over, and records itself', async () => {
    lines = DUMP;
    await build();
    const fromTheDump = await derived();
    const { rows: [before] } = await pool.query('SELECT dump_date::text, counts FROM wikidata_subset_builds ORDER BY swapped_at DESC LIMIT 1');
    // As a change to a derivation finds them: tables that no longer say what the entities do.
    await pool.query("DELETE FROM wikidata_claims WHERE property = 'P276'");
    await pool.query('TRUNCATE wikidata_class_closure');
    pass = 0;
    await rederive();
    expect(pass).toBe(0);
    expect(await derived()).toEqual(fromTheDump);
    expect(fromTheDump.labels).toContainEqual({ id: `Q${LEONARDO}`, language: 'fr', label: 'Léonard de Vinci', description: null });
    const { rows: indexes } = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'wikidata_claims' ORDER BY indexname");
    expect(indexes.map(r => r.indexname)).toEqual(['idx_wikidata_claims_subject', 'idx_wikidata_claims_value_item']);
    const { rows: [after] } = await pool.query('SELECT dump_date::text, counts FROM wikidata_subset_builds ORDER BY swapped_at DESC LIMIT 1');
    expect(after).toEqual(before);
    expect(await nextTables()).toEqual([]);
  });

  it('leaves the subset and a cut build\'s copies as they were when it is cancelled', async () => {
    lines = DUMP;
    failOnPass = 2;
    cut = { afterPieces: 2, error: new Error('the worker was stopped') };
    await expect(build()).rejects.toThrow('the worker was stopped');
    failOnPass = null;
    cut = null;
    const kept = await nextTables();
    const before = await derived();
    const controller = new AbortController();
    await expect(rederive(controller.signal, message => { if (message.startsWith('Walking')) controller.abort(); })).rejects.toThrow();
    expect(await derived()).toEqual(before);
    expect(await nextTables()).toEqual(kept.filter(table => ['wikidata_entities_next', 'wikidata_build_pieces_next', 'wikidata_build_resume_next'].includes(table)));
    expect(await nextTables()).toContain('wikidata_build_pieces_next');
    // The next build of the file still picks up after the cut one.
    const notes: string[] = [];
    await build(notes);
    expect(notes.some(note => note.startsWith('picked up after'))).toBe(true);
  });

  it('refuses where the database\'s disk cannot hold the copies, before any is made', async () => {
    disk.free = 0;
    // The test stack names no path on the database's disk; the disk itself is the mocked one.
    process.env.DB_DISK_DIR = tmpdir();
    try {
      await expect(rederive()).rejects.toThrow(/Deriving the tables again would write about .* but it has 0 GB/);
    } finally {
      disk.free = Number.MAX_SAFE_INTEGER;
      delete process.env.DB_DISK_DIR;
    }
    expect(await nextTables()).toEqual([]);
  });

  it('refuses over entities a crash of the database emptied, though the record says a subset is in place', async () => {
    // Unlogged: a crash truncates the table and leaves the logged wikidata_subset_builds row.
    await pool.query('TRUNCATE wikidata_entities');
    await expect(rederive()).rejects.toThrow(/entities are empty/);
    expect(await nextTables()).toEqual([]);
  });
});

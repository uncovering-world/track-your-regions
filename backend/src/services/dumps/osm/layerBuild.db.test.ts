import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';

/**
 * The OpenStreetMap layer's build (#1437, ADR-0134) against PostgreSQL, with
 * the tools stood in: osmium cuts nothing, and osm2pgsql's load is the rows
 * the flex style would write for Stonehenge (a node tagged with its item), the
 * Pompeii excavations (a way) and a bakery a curator linked (a node kept only
 * because the catalogue names it). The swap, the record and the cleanup are
 * the real ones.
 */

const planet: DumpFile = {
  key: 'osm-planet', fileName: 'planet-261012.osm.pbf', url: 'https://planet.openstreetmap.org/pbf/planet-261012.osm.pbf',
  date: '2026-10-12', checksum: { kind: 'md5', value: 'c'.repeat(32) }, expectedBytes: 668, compression: 'none',
};

const dir = mkdtempSync(join(tmpdir(), 'osm-layer-'));
writeFileSync(join(dir, planet.fileName), 'planet');

const calls: string[][] = [];
let loadFails = false;
/** What `osmium getid` answers: every named object found, or some gone, or an error it does not explain. */
let getid: { code: number; stderr: string } = { code: 0, stderr: '' };
let rowsLoaded: Array<[string, number, string, string | null, string]> = [];

vi.mock('../read.js', () => ({
  holdVerifiedCopy: vi.fn(async () => ({ bytes: 668, lines: 0, checksumActual: 'c'.repeat(32), path: join(dir, planet.fileName) })),
}));
vi.mock('./layerSelection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./layerSelection.js')>(),
  pinnedObjects: vi.fn(async () => ['n20']),
}));
vi.mock('./tools.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./tools.js')>();
  return {
    ...real,
    runTool: vi.fn(async (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push([command.split('/').pop()!, ...args]);
      const answer = { stdout: '', stderr: '', code: 0 };
      if (args[0] === 'fileinfo') return { ...answer, stdout: '2026-10-12T00:59:59Z\n' };
      if (args[0] === 'getid') return { ...answer, ...getid };
      if (command === real.OSM2PGSQL) {
        const { pool: db } = await import('../../../db/index.js');
        if (loadFails) {
          await db.query('CREATE TABLE workbench.osm_layer_middle_nodes (id bigint)');
          throw new Error('osm2pgsql --create failed (1): out of memory');
        }
        await db.query(`CREATE TABLE workbench.${options.env!.OSM_LAYER_TABLE} (osm_type char(1) NOT NULL, osm_id bigint NOT NULL,
          tags jsonb NOT NULL, wikidata text, wikipedia text, geom geometry(Geometry, 4326))`);
        await db.query('CREATE TABLE workbench.osm2pgsql_properties (property text, value text)');
        for (const [type, id, tags, wikidata, wkt] of rowsLoaded) {
          await db.query(`INSERT INTO workbench.${options.env!.OSM_LAYER_TABLE} VALUES ($1, $2, $3, $4, NULL, ST_GeomFromText($5, 4326))`,
            [type, id, tags, wikidata, wkt]);
        }
      }
      return answer;
    }),
  };
});

const { pool } = await import('../../../db/index.js');
const { buildLayer } = await import('./layerBuild.js');
const { latestLayer } = await import('./layerTables.js');
const { pinnedObjects } = await vi.importActual<typeof import('./layerSelection.js')>('./layerSelection.js');

const STONEHENGE: [string, number, string, string | null, string] = ['N', 1, '{"historic":"archaeological_site","wikidata":"Q39671"}', 'Q39671', 'POINT(-1.8262 51.1789)'];
const POMPEII: [string, number, string, string | null, string] = ['W', 10, '{"historic":"archaeological_site","addr:city":"Pompei"}', null,
  'POLYGON((14.485 40.75,14.485 40.751,14.487 40.751,14.487 40.75,14.485 40.75))'];
const BAKERY: [string, number, string, string | null, string] = ['N', 20, '{"shop":"bakery"}', null, 'POINT(2.2945 48.8584)'];

let buildId = 0;
const newBuild = async () => (await pool.query<{ id: number }>(
  `INSERT INTO dump_builds (dump, mode, status) VALUES ('osm-planet', 'local', 'running') RETURNING id`,
)).rows[0].id;
const notes: string[] = [];
const build = () => buildLayer(planet, {
  buildId, dumpsDir: dir, signal: new AbortController().signal, onPhase: () => undefined, onNote: note => notes.push(note),
});
const rows = async (sql: string) => (await pool.query(sql)).rows;

async function clear(): Promise<void> {
  await pool.query('TRUNCATE osm_layer_builds, osm_objects');
  await pool.query('DROP TABLE IF EXISTS workbench.osm_objects_next, workbench.osm2pgsql_properties');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'osm-planet'");
}

beforeEach(async () => {
  calls.length = 0;
  notes.length = 0;
  loadFails = false;
  getid = { code: 0, stderr: '' };
  rowsLoaded = [STONEHENGE, POMPEII, BAKERY];
  await clear();
  buildId = await newBuild();
});

afterAll(async () => {
  await clear();
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildLayer (#1437)', () => {
  it('cuts the selection and the named objects, loads them, and swaps the layer in with its replication timestamp', async () => {
    const result = await build();
    expect(calls.map(call => call.slice(0, 2))).toEqual([
      ['osmium', 'tags-filter'], ['osmium', 'getid'], ['osmium', 'merge'], ['osmium', 'fileinfo'], ['osm2pgsql', '--create'],
    ]);
    expect(calls[1]).toEqual(expect.arrayContaining(['-r', '--verbose-ids']));
    expect(calls[4].join(' ')).not.toMatch(/PGPASSWORD|password/i);
    expect(await rows("SELECT osm_type, osm_id, wikidata, GeometryType(geom) AS geom FROM osm_objects ORDER BY osm_type, osm_id")).toEqual([
      { osm_type: 'N', osm_id: '1', wikidata: 'Q39671', geom: 'POINT' },
      { osm_type: 'N', osm_id: '20', wikidata: null, geom: 'POINT' },
      { osm_type: 'W', osm_id: '10', wikidata: null, geom: 'POLYGON' },
    ]);
    expect(await rows("SELECT indexname FROM pg_indexes WHERE schemaname = 'workbench' AND tablename = 'osm_objects' ORDER BY 1")).toEqual([
      { indexname: 'osm_objects_geom' }, { indexname: 'osm_objects_pkey' }, { indexname: 'osm_objects_wikidata' }, { indexname: 'osm_objects_wikipedia' },
    ]);
    const [record] = await rows("SELECT planet_file, dump_date::text AS date, replicated_at, objects::int, pinned, pinned_gone FROM osm_layer_builds");
    expect(record).toMatchObject({ planet_file: planet.fileName, date: '2026-10-12', objects: 3, pinned: 1, pinned_gone: 0 });
    expect((record.replicated_at as Date).toISOString()).toBe('2026-10-12T00:59:59.000Z');
    expect(result.summary).toMatch(/kept 3 OpenStreetMap objects from planet-261012.osm.pbf, current to 2026-10-12T00:59:59.000Z, with the 1 objects the catalogue names/);
    expect(await latestLayer()).toMatchObject({ dumpDate: '2026-10-12', needs: 'nothing' });
    expect(await rows("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'workbench' AND tablename = 'osm2pgsql_properties'")).toEqual([{ n: 0 }]);
    expect(readdirSync(dir)).toEqual([planet.fileName]);
  });

  it('goes on when an object the catalogue names is gone from the planet, and says which', async () => {
    getid = { code: 1, stderr: '[ 0:00] Did not find 1 object(s).\nMissing node IDs: 20\nMissing way IDs: \n[ 0:00] Done.\n' };
    const result = await build();
    expect(result.summary).toMatch(/\(1 of them no longer in the planet\)/);
    expect(notes).toEqual(['1 objects the catalogue names are no longer in the planet: n20']);
    expect(await rows('SELECT pinned, pinned_gone FROM osm_layer_builds')).toEqual([{ pinned: 1, pinned_gone: 1 }]);
  });

  it('fails on an error of osmium getid that is not a gone object', async () => {
    getid = { code: 1, stderr: 'Error: PBF error: invalid BlobHeader size\n' };
    await expect(build()).rejects.toThrow(/osmium getid failed \(1\): Error: PBF error/);
    expect(await latestLayer()).toBeNull();
  });

  it('empties a cut a stopped build left behind before it cuts again', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'osm-layer-cut'), { recursive: true });
    writeFileSync(join(dir, 'osm-layer-cut', 'layer.osm.pbf'), 'left by a restart');
    await build();
    expect(readdirSync(dir)).toEqual([planet.fileName]);
  });

  it('keeps the layer in place when the load fails, and leaves no copy or cut behind', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    loadFails = true;
    await expect(build()).rejects.toThrow(/out of memory/);
    expect(await rows('SELECT count(*)::int AS n FROM osm_objects')).toEqual([{ n: 3 }]);
    expect(await rows('SELECT count(*)::int AS n FROM osm_layer_builds')).toEqual([{ n: 1 }]);
    expect(await rows("SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('osm_objects_next', 'osm2pgsql_properties') OR tablename LIKE 'osm_layer_middle%'")).toEqual([{ n: 0 }]);
    expect(readdirSync(dir)).toEqual([planet.fileName]);
  });

  it('swaps nothing in from a cut that kept no object', async () => {
    rowsLoaded = [];
    await expect(build()).rejects.toThrow('The cut kept no object, so the layer in place stays');
    expect(await latestLayer()).toBeNull();
  });

  it('reads the objects the catalogue names from the places as they are stored', async () => {
    await expect(pinnedObjects()).resolves.toEqual(expect.any(Array));
  });
});

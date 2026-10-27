import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DumpFile } from '../catalog.js';

/**
 * The OpenStreetMap layer's build (#1437, ADR-0134) against PostgreSQL, with
 * the tools and the host stood in: the weekly planet of Monday 2026-10-12 is
 * current to 2026-10-12T00:00:02Z and the newest daily diff is 5153, ending
 * 2026-10-22T00:00Z, as on that day; osmium writes what it is asked to, and
 * osm2pgsql's load is the rows the flex style would write for Stonehenge (a
 * node tagged with its item), the Pompeii excavations (a way) and a bakery a
 * curator linked (a node kept only because the catalogue names it). The swap,
 * the record, the current planet on disk and the cleanup are the real ones.
 */

const planet: DumpFile = {
  key: 'osm-planet', fileName: 'planet-261012.osm.pbf', url: 'https://planet.openstreetmap.org/pbf/planet-261012.osm.pbf',
  date: '2026-10-12', checksum: { kind: 'md5', value: 'c'.repeat(32) }, expectedBytes: 668, compression: 'none',
};

const dir = mkdtempSync(join(tmpdir(), 'osm-layer-'));

/** Daily diff `n` ends at midnight UTC, 5143 on 2026-10-12. */
const endOf = (sequence: number) => new Date(Date.UTC(2026, 9, 12) + (sequence - 5143) * 86_400_000).toISOString().replace('.000', '');
const stateText = (sequence: number) => `sequenceNumber=${sequence}\ntimestamp=${endOf(sequence).replaceAll(':', '\\:')}\n`;
let newestDiff = 5153;
const diffsDownloaded: string[] = [];

const calls: string[][] = [];
let loadFails = false;
/** What `osmium getid` answers: every named object found, or some gone, or an error it does not explain. */
let getid: { code: number; stderr: string } = { code: 0, stderr: '' };
let rowsLoaded: Array<[string, number, string, string | null, string]> = [];
/** The items the layer keeps whole (fixture QIDs, not real ones). */
let drawnItems: { named: string[]; listed: string[] } = { named: [], listed: [] };

vi.mock('../fetch.js', () => ({
  fetchText: vi.fn(async (url: string) => {
    if (url.endsWith('/day/state.txt')) return stateText(newestDiff);
    const match = /day\/(\d{3})\/(\d{3})\/(\d{3})\.state\.txt$/.exec(url);
    return stateText(Number(match!.slice(1).join('')));
  }),
  downloadTo: vi.fn(async (url: string, path: string) => {
    diffsDownloaded.push(url);
    writeFileSync(path, 'diff');
    return 4;
  }),
}));
vi.mock('../read.js', () => ({
  holdVerifiedCopy: vi.fn(async () => ({ bytes: 668, lines: 0, checksumActual: 'c'.repeat(32), path: join(dir, planet.fileName) })),
}));
vi.mock('./layerSelection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./layerSelection.js')>(),
  pinnedObjects: vi.fn(async () => ['n20']),
  drawnItems: vi.fn(async () => drawnItems),
}));
let refillFails = false;
vi.mock('./layerShapes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./layerShapes.js')>();
  return {
    ...real,
    refillRegionShapes: vi.fn(async (items: readonly string[]) => {
      if (refillFails) throw new Error('store refused');
      return real.refillRegionShapes(items);
    }),
  };
});
vi.mock('./tools.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./tools.js')>();
  return {
    ...real,
    runTool: vi.fn(async (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push([command.split('/').pop()!, ...args]);
      const answer = { stdout: '', stderr: '', code: 0 };
      if (args[0] === 'fileinfo') return { ...answer, stdout: '2026-10-12T00:00:02Z\n' };
      if (args[0] === 'apply-changes') writeFileSync(args[args.indexOf('-o') + 1], 'current planet');
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
const { buildLayer, hasCurrentPlanet, updateLayer } = await import('./layerBuild.js');
const { latestLayer } = await import('./layerTables.js');
const { LAYER_DRAWN, pinnedObjects } = await vi.importActual<typeof import('./layerSelection.js')>('./layerSelection.js');

const STONEHENGE: [string, number, string, string | null, string] = ['N', 1, '{"historic":"archaeological_site","wikidata":"Q39671"}', 'Q39671', 'POINT(-1.8262 51.1789)'];
const POMPEII: [string, number, string, string | null, string] = ['W', 10, '{"historic":"archaeological_site","addr:city":"Pompei"}', null,
  'POLYGON((14.485 40.75,14.485 40.751,14.487 40.751,14.487 40.75,14.485 40.75))'];
const BAKERY: [string, number, string, string | null, string] = ['N', 20, '{"shop":"bakery"}', null, 'POINT(2.2945 48.8584)'];
/** A region an import names, drawn by its boundary relation and, larger, by a way that carries the same item. */
const REGION: [string, number, string, string | null, string] = ['R', 30, '{"boundary":"administrative","wikidata":"Q1000001"}', 'Q1000001',
  'MULTIPOLYGON(((10 10,10 11,11 11,11 10,10 10)))'];
const REGION_WAY: [string, number, string, string | null, string] = ['W', 31, '{"place":"region","wikidata":"Q1000001"}', 'Q1000001',
  'POLYGON((10 10,10 12,12 12,12 10,10 10))'];
/** A region an import names that the layer holds only as a point. */
const REGION_POINT: [string, number, string, string | null, string] = ['N', 32, '{"place":"region","wikidata":"Q1000002"}', 'Q1000002', 'POINT(20 20)'];
/** A district a mapshape on an imported region's page lists, which no import names (#2105). */
const DISTRICT: [string, number, string, string | null, string] = ['R', 33, '{"boundary":"administrative","wikidata":"Q1000004"}', 'Q1000004',
  'MULTIPOLYGON(((12 10,12 11,13 11,13 10,12 10)))'];

let buildId = 0;
const newBuild = async () => (await pool.query<{ id: number }>(
  `INSERT INTO dump_builds (dump, mode, status) VALUES ('osm-planet', 'local', 'running') RETURNING id`,
)).rows[0].id;
const notes: string[] = [];
const options = () => ({ buildId, dumpsDir: dir, signal: new AbortController().signal, onPhase: () => undefined, onNote: (note: string) => notes.push(note) });
const build = () => buildLayer(planet, options());
const update = () => updateLayer(options());
const rows = async (sql: string) => (await pool.query(sql)).rows;

async function clear(): Promise<void> {
  await pool.query('TRUNCATE osm_layer_builds, osm_objects');
  await pool.query('DROP TABLE IF EXISTS workbench.osm_objects_next, workbench.osm2pgsql_properties');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'osm-planet'");
  await pool.query("DELETE FROM wikidata_geoshapes WHERE wikidata_id LIKE 'Q100000_' OR wikidata_id = 'commons:Test_region.map'");
}

beforeEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  writeFileSync(join(dir, planet.fileName), 'weekly planet');
  newestDiff = 5153;
  diffsDownloaded.length = 0;
  calls.length = 0;
  notes.length = 0;
  loadFails = false;
  getid = { code: 0, stderr: '' };
  rowsLoaded = [STONEHENGE, POMPEII, BAKERY];
  drawnItems = { named: [], listed: [] };
  refillFails = false;
  await clear();
  buildId = await newBuild();
});

afterAll(async () => {
  await clear();
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
});

const CURRENT = ['planet-current.osm.pbf', 'planet-current.state.json'];

describe('buildLayer (#1437)', () => {
  it('brings the weekly planet forward with the daily diffs since, cuts the layer from it, and swaps it in current to the newest diff', async () => {
    const result = await build();
    expect(calls.map(call => call.slice(0, 2))).toEqual([
      ['osmium', 'fileinfo'], ['osmium', 'apply-changes'], ['osmium', 'tags-filter'], ['osmium', 'getid'], ['osmium', 'merge'], ['osm2pgsql', '--create'],
    ]);
    expect(diffsDownloaded).toHaveLength(10);
    expect(diffsDownloaded[0]).toBe('https://planet.openstreetmap.org/replication/day/000/005/144.osc.gz');
    expect(calls[3]).toEqual(expect.arrayContaining(['-r', '--verbose-ids', join(dir, 'planet-current.osm.pbf')]));
    // osmium writes lz4 for itself, and the cut osm2pgsql reads uncompressed, which its Debian build needs.
    expect(calls[1]).toContain('--output-format=pbf,pbf_compression=lz4');
    expect(calls[4]).toContain('--output-format=pbf,pbf_compression=none');
    expect(calls[5].join(' ')).not.toMatch(/PGPASSWORD|password/i);
    expect(await rows("SELECT osm_type, osm_id, wikidata, GeometryType(geom) AS geom FROM osm_objects ORDER BY osm_type, osm_id")).toEqual([
      { osm_type: 'N', osm_id: '1', wikidata: 'Q39671', geom: 'POINT' },
      { osm_type: 'N', osm_id: '20', wikidata: null, geom: 'POINT' },
      { osm_type: 'W', osm_id: '10', wikidata: null, geom: 'POLYGON' },
    ]);
    expect(await rows("SELECT indexname FROM pg_indexes WHERE schemaname = 'workbench' AND tablename = 'osm_objects' ORDER BY 1")).toEqual([
      // The reference index the review card's hints are found by (#1853), copied like the rest.
      { indexname: 'osm_objects_geom' }, { indexname: 'osm_objects_pkey' }, { indexname: 'osm_objects_ref_whc' },
      { indexname: 'osm_objects_wikidata' }, { indexname: 'osm_objects_wikipedia' },
    ]);
    const [record] = await rows("SELECT planet_file, dump_date::text AS date, replicated_at, objects::int, pinned, pinned_gone, drawn FROM osm_layer_builds");
    expect(record).toMatchObject({ planet_file: planet.fileName, date: '2026-10-22', objects: 3, pinned: 1, pinned_gone: 0 });
    // The rule its full geometries were kept by, which a reader holds a keep rule to (ADR-0136).
    expect(record.drawn).toEqual(LAYER_DRAWN);
    expect((record.replicated_at as Date).toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(result.summary).toMatch(/kept 3 OpenStreetMap objects from planet-261012.osm.pbf brought forward with 10 daily diffs to diff 5153, current to 2026-10-22T00:00:00.000Z, with the 1 objects the catalogue names/);
    expect(notes).toContain('removed planet-261012.osm.pbf: the current planet, brought forward to daily diff 5153, replaces it');
    expect(await latestLayer()).toMatchObject({ dumpDate: '2026-10-22', needs: 'nothing' });
    expect(await rows("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'workbench' AND tablename = 'osm2pgsql_properties'")).toEqual([{ n: 0 }]);
    expect(readdirSync(dir).sort()).toEqual(CURRENT);
  });

  it('brings the current planet forward from where it was, without the weekly planet', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    calls.length = 0;
    diffsDownloaded.length = 0;
    newestDiff = 5155;
    vi.stubEnv('DUMPS_DIR', dir);
    expect(await hasCurrentPlanet()).toBe(true);
    vi.unstubAllEnvs();
    await update();
    expect(calls.map(call => call.slice(0, 2))[0]).toEqual(['osmium', 'apply-changes']);
    expect(calls[0][2]).toBe(join(dir, 'planet-current.osm.pbf'));
    expect(diffsDownloaded).toEqual([
      'https://planet.openstreetmap.org/replication/day/000/005/154.osc.gz', 'https://planet.openstreetmap.org/replication/day/000/005/155.osc.gz',
    ]);
    expect(await latestLayer()).toMatchObject({ dumpDate: '2026-10-24' });
  });

  it('starts the current planet again from a weekly planet the admin names, dropping the one kept', async () => {
    await build();
    await pool.query("UPDATE dump_builds SET status = 'success' WHERE id = $1", [buildId]);
    buildId = await newBuild();
    writeFileSync(join(dir, planet.fileName), 'weekly planet again');
    calls.length = 0;
    await build();
    expect(calls.map(call => call.slice(0, 2)).slice(0, 2)).toEqual([['osmium', 'fileinfo'], ['osmium', 'apply-changes']]);
    expect(calls[1][2]).toBe(join(dir, planet.fileName));
    expect(readdirSync(dir).sort()).toEqual(CURRENT);
  });

  it('refuses to bring forward a current planet that is not kept', async () => {
    await expect(update()).rejects.toThrow('No current planet is kept to bring forward');
    expect(await latestLayer()).toBeNull();
  });

  it('goes on when an object the catalogue names is gone from the planet, and says which', async () => {
    getid = { code: 1, stderr: '[ 0:00] Did not find 1 object(s).\nMissing node IDs: 20\nMissing way IDs: \n[ 0:00] Done.\n' };
    const result = await build();
    expect(result.summary).toMatch(/\(1 of them no longer in the planet\)/);
    expect(notes).toContain('1 objects the catalogue names are no longer in the planet: n20');
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
    expect(readdirSync(dir).sort()).toEqual(CURRENT);
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
    expect(readdirSync(dir).sort()).toEqual(CURRENT);
  });

  it('swaps nothing in from a cut that kept no object', async () => {
    rowsLoaded = [];
    await expect(build()).rejects.toThrow('The cut kept no object, so the layer in place stays');
    expect(await latestLayer()).toBeNull();
  });

  it('keeps the shape of each region an import names and each item a mapshape lists, a relation before a way, and leaves the Commons shapes (#2085, #2105)', async () => {
    drawnItems = { named: ['Q1000001', 'Q1000002'], listed: ['Q1000004', 'Q1000005'] };
    rowsLoaded = [STONEHENGE, REGION, REGION_WAY, REGION_POINT, DISTRICT];
    await pool.query(`INSERT INTO wikidata_geoshapes (wikidata_id, geom, licence) VALUES
      ('Q1000003', ST_GeomFromText('MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))', 4326), 'ODbL-1.0'),
      ('commons:Test_region.map', ST_GeomFromText('MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))', 4326), 'CC0-1.0')`);

    const result = await build();

    expect(result.summary).toMatch(
      /; 1 of the 2 items the world-view imports name have a region shape, and 1 of the 2 other items their pages' mapshapes list$/,
    );
    expect(await rows(`SELECT wikidata_id, licence, round(ST_Area(geom)::numeric, 2)::float AS area FROM wikidata_geoshapes
      WHERE wikidata_id LIKE 'Q100000_' OR wikidata_id = 'commons:Test_region.map' ORDER BY wikidata_id COLLATE "C"`)).toEqual([
      { wikidata_id: 'Q1000001', licence: 'ODbL-1.0', area: 1 },
      { wikidata_id: 'Q1000004', licence: 'ODbL-1.0', area: 1 },
      { wikidata_id: 'commons:Test_region.map', licence: 'CC0-1.0', area: 1 },
    ]);
  });

  it('keeps the layer it swapped in when the region shapes cannot be kept, and says so', async () => {
    drawnItems = { named: ['Q1000001'], listed: [] };
    rowsLoaded = [STONEHENGE, REGION];
    refillFails = true;

    const result = await build();

    expect(result.summary).not.toMatch(/region shape/);
    expect(notes).toContain("the region shapes were not refreshed from this layer, and the store keeps the last build's: store refused");
    expect(await rows('SELECT count(*)::int AS n FROM osm_objects')).toEqual([{ n: 2 }]);
    expect(await rows("SELECT 1 FROM wikidata_geoshapes WHERE wikidata_id = 'Q1000001'")).toEqual([]);
  });

  it('reads the objects the catalogue names from the places as they are stored', async () => {
    await expect(pinnedObjects()).resolves.toEqual(expect.any(Array));
  });
});

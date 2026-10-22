import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SparqlBinding } from '../wikidataUtils.js';
import type { OsmDoor } from './readOsmObjects.js';
import type { DigTags, KeepWkt } from './types.js';

/**
 * The OpenStreetMap layer as a door (ADR-0134 decisions 4 and 5) against
 * PostgreSQL. The layer holds:
 * - Stonehenge, a node tagged with its item;
 * - the Pompeii excavations, an area whose geometry the keep rule draws;
 * - a living town's node, whose point it does not;
 * - a dig named only by its article;
 * - a `ruins=no` object, which is no dig.
 *
 * Overpass, the live door, answers for Troy.
 */

const { pool } = await import('../../../db/index.js');
const { layerVouches, localDigsReader, localOsmReader } = await import('./localOsm.js');

const STONEHENGE = 'Q39671';
const POMPEII = 'Q43332';
const ATHENS = 'Q1524';
const TROY = 'Q22647';
const VIMINACIUM = 'Q1231824';
const KEEP: KeepWkt = { historic: ['archaeological_site', 'ruins'], manMade: [], boundary: ['protected_area'] };
const DIGS: DigTags = { historic: ['archaeological_site'], keys: ['ruins', 'archaeological_site'] };
const run = { phase: vi.fn(), step: vi.fn(async () => undefined) };

const liveRows: SparqlBinding[] = [
  { q: { value: TROY }, s: { value: 'https://www.openstreetmap.org/way/77' }, historic: { value: 'archaeological_site' } },
];
const live: OsmDoor & { send: ReturnType<typeof vi.fn> } = {
  name: 'overpass',
  question: (qids) => `objects of ${qids.join(',')}`,
  digsQuestions: () => ['every dig'],
  send: vi.fn(async (query: string) => (query === 'every dig'
    ? [{ q: { value: TROY }, s: { value: 'https://www.openstreetmap.org/way/77' }, historic: { value: 'archaeological_site' } }]
    : liveRows)),
};

const DAY = 86_400_000;
let currentTo = new Date();

async function layer(age: number | null, drawn: KeepWkt | null = null): Promise<void> {
  await pool.query('TRUNCATE osm_layer_builds, osm_objects');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'osm-planet'");
  const rows: Array<[string, number, Record<string, string>, string | null, string | null, string]> = [
    ['N', 1, { historic: 'archaeological_site', name: 'Stonehenge', wikidata: STONEHENGE, website: 'https://example.org' }, STONEHENGE, null, 'POINT(-1.8262 51.1789)'],
    ['W', 10, { historic: 'archaeological_site', name: 'Pompeii', 'addr:city': 'Pompei', wikidata: POMPEII }, POMPEII, null,
      'POLYGON((14.485 40.75,14.485 40.751,14.487 40.751,14.487 40.75,14.485 40.75))'],
    ['N', 20, { place: 'city', name: 'Athens', wikidata: ATHENS }, ATHENS, null, 'POINT(23.7267 37.9715)'],
    ['N', 30, { historic: 'archaeological_site', wikipedia: 'en:Çatalhöyük' }, null, 'en:Çatalhöyük', 'POINT(32.83 37.67)'],
    ['N', 40, { ruins: 'no', historic: 'castle', wikidata: 'Q99999' }, 'Q99999', null, 'POINT(10 50)'],
    // A closed ring that crosses itself, which osm2pgsql keeps as its line.
    ['W', 50, { historic: 'archaeological_site', name: 'Viminacium', wikidata: VIMINACIUM }, VIMINACIUM, null,
      'LINESTRING(21.21 44.73,21.23 44.74,21.23 44.73,21.21 44.74,21.21 44.73)'],
  ];
  for (const [type, id, tags, wikidata, wikipedia, wkt] of rows) {
    await pool.query('INSERT INTO osm_objects VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326))', [type, id, tags, wikidata, wikipedia, wkt]);
  }
  if (age === null) return;
  currentTo = new Date(Date.now() - age * DAY);
  const build = (await pool.query<{ id: number }>("INSERT INTO dump_builds (dump, mode, status) VALUES ('osm-planet', 'local', 'success') RETURNING id")).rows[0].id;
  await pool.query(
    "INSERT INTO osm_layer_builds (build_id, planet_file, dump_date, replicated_at, objects, pinned, drawn) VALUES ($1, 'planet-261012.osm.pbf', $2::timestamptz::date, $2::timestamptz, 5, 0, $3)",
    [build, currentTo, drawn === null ? null : JSON.stringify(drawn)],
  );
}

beforeEach(() => {
  live.send.mockClear();
});

afterAll(async () => {
  await pool.query('TRUNCATE osm_layer_builds, osm_objects');
  await pool.query("DELETE FROM dump_builds WHERE dump = 'osm-planet'");
  await pool.end();
});

describe('the layer as a door (ADR-0134)', () => {
  it('answers each item from a fresh layer, misses as facts, with the keep rule\'s geometry and its own tags', async () => {
    await layer(2);
    const found = await localOsmReader(live)([STONEHENGE, POMPEII, ATHENS, TROY], KEEP, run);
    expect(live.send).not.toHaveBeenCalled();
    expect(found.get(TROY)).toEqual([]);
    const [pompeii] = found.get(POMPEII)!;
    expect(pompeii).toMatchObject({
      ref: 'way/10', kind: 'way', geometryType: 'POLYGON', tags: { historic: 'archaeological_site', name: 'Pompeii' },
      source: { door: 'local', asOf: currentTo.toISOString() },
    });
    expect(pompeii.wkt).toMatch(/^POLYGON\(\(14\.485 40\.75/);
    expect(pompeii.tags).not.toHaveProperty('addr:city');
    // The layer keeps a point for what no kind draws (ADR-0136): it says where
    // Athens is, not what shape it has.
    expect(found.get(ATHENS)![0]).toMatchObject({ ref: 'node/20', tags: { place: 'city' }, wkt: null, geometryType: null });
    expect(found.get(STONEHENGE)![0].tags).not.toHaveProperty('website');
  });

  it('asks Overpass for the misses of a stale layer, and only those, naming the door they came through', async () => {
    await layer(9);
    const found = await localOsmReader(live)([STONEHENGE, TROY], KEEP, run);
    expect(live.send).toHaveBeenCalledTimes(1);
    expect(live.send.mock.calls[0][0]).toBe(`objects of ${TROY}`);
    expect(found.get(STONEHENGE)![0].source).toEqual({ door: 'local', asOf: currentTo.toISOString() });
    expect(found.get(TROY)).toEqual([expect.objectContaining({ ref: 'way/77', source: { door: 'overpass', asOf: expect.any(String) } })]);
  });

  it('draws a closed way as its area, as the live doors do, even where its ring crosses itself', async () => {
    await layer(2);
    const [viminacium] = (await localOsmReader(live)([VIMINACIUM], KEEP, run)).get(VIMINACIUM)!;
    expect(viminacium).toMatchObject({ ref: 'way/50', geometryType: 'POLYGON' });
    expect(viminacium.wkt).toMatch(/^POLYGON\(\(21\.21 44\.73,/);
  });

  it('leaves a miss the live door did not answer unread, never mapped as nothing', async () => {
    await layer(9);
    const found = await localOsmReader(live, undefined, async () => new Map())([STONEHENGE, TROY], KEEP, run);
    expect(found.get(STONEHENGE)![0].source).toEqual({ door: 'local', asOf: currentTo.toISOString() });
    expect(found.has(TROY)).toBe(false);
  });

  it('asks live, whole, a read wanting outlines the fresh layer was cut without (ADR-0136)', async () => {
    await layer(2, KEEP);
    const memorials: KeepWkt = { ...KEEP, historic: [...KEEP.historic, 'memorial'] };
    const found = await localOsmReader(live)([STONEHENGE, TROY], memorials, run);
    expect(live.send.mock.calls[0][0]).toBe(`objects of ${STONEHENGE},${TROY}`);
    expect(found.get(TROY)![0].source!.door).toBe('overpass');
    // Within the rule it was cut with, the same layer answers.
    live.send.mockClear();
    await localOsmReader(live)([STONEHENGE, TROY], KEEP, run);
    expect(live.send).not.toHaveBeenCalled();
  });

  it('asks Overpass for every item while no layer is in place', async () => {
    await layer(null);
    await localOsmReader(live)([STONEHENGE, TROY], KEEP, run);
    expect(live.send.mock.calls[0][0]).toBe(`objects of ${STONEHENGE},${TROY}`);
  });

  it('enumerates the digs from a fresh layer, by item or, with none, by article, and no key whose value is no', async () => {
    await layer(1);
    const digs = await localDigsReader(live, DIGS)(run);
    expect(live.send).not.toHaveBeenCalled();
    expect([...digs.byItem.keys()].sort()).toEqual([STONEHENGE, POMPEII, VIMINACIUM].sort());
    expect([...digs.byArticle.keys()]).toEqual(['en:Çatalhöyük']);
    expect(digs.byItem.get(POMPEII)![0].wkt).toBeNull();
  });

  it('hands the enumeration to Overpass whole on a stale layer', async () => {
    await layer(9);
    const digs = await localDigsReader(live, DIGS)(run);
    expect(live.send).toHaveBeenCalledWith('every dig', expect.anything());
    expect([...digs.byItem.keys()]).toEqual([TROY]);
    expect(digs.byItem.get(TROY)![0].source).toEqual({ door: 'overpass', asOf: expect.any(String) });
  });

  it('vouches for its misses while it is at most eight days old', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(layerVouches({ currentTo: '2026-10-22T00:00:00Z' }, now)).toBe(true);
    expect(layerVouches({ currentTo: '2026-10-21T23:59:59Z' }, now)).toBe(false);
    expect(layerVouches(null, now)).toBe(false);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { MEMBERSHIPS } from './membership.js';
import { linedItems, placedByLines, writeLines } from './pathWriter.js';
import { assignRegionsForExperiences } from '../services/sync/regionAssignmentService.js';

/**
 * A place's line read from the OpenStreetMap layer (ADR-0212), against
 * PostgreSQL: which of the layer's objects carrying a bridge's item make its
 * line, who may write it, and where the line then places the bridge
 * (ADR-0207).
 *
 * The fixture is a world view of its own: a root (9831) over two one-degree
 * leaves side by side, A (9832) and B (9833). A bridge (9834) stands at the
 * western end of a crossing from A into B, as the Øresund Bridge runs from
 * Denmark into Sweden; its item is carried by a motorway, the bridge's own
 * outline, a train route, a pipeline laid along the crossing into B's far
 * side, the lake behind it, a road of the same item 6.7 km away and a bridge
 * relation naming the river that passes under it. A dam
 * waiting for a curator (9835), a bridge whose line a curator drew (9836)
 * and one whose line another source drew (9837) sit beside it. Fixture items,
 * not real ones. Everything is deleted before and after; the dependants
 * cascade.
 */

const WORLD_VIEW = 9830;
const ROOT = 9831;
const LEAF_A = 9832;
const LEAF_B = 9833;
const BRIDGE = 9834;
const DAM = 9835;
const CLAIMED = 9836;
const OTHERS = 9837;
const PLACES = [BRIDGE, DAM, CLAIMED, OTHERS];
const ITEM = (place: number) => `Q${place}001`;
const AT = new Date('2026-11-14T00:00:00Z');

/** The objects of the fixture's layer, ids 98340001 up. */
const OBJECTS: Array<[string, number, Record<string, string>, string]> = [
  ['W', 98340001, { highway: 'motorway' }, 'LINESTRING(10.44 50, 10.5 50)'],
  ['W', 98340002, { man_made: 'bridge' }, 'POLYGON((10.5 49.999, 10.56 49.999, 10.56 50.001, 10.5 50.001, 10.5 49.999))'],
  ['R', 98340003, { type: 'route', route: 'train' }, 'GEOMETRYCOLLECTION(LINESTRING(10.44 50.002, 10.56 50.002), POINT(10.45 50.002))'],
  ['W', 98340004, { man_made: 'pipeline' }, 'LINESTRING(10.44 50.003, 11.4 50.003)'],
  ['R', 98340005, { type: 'multipolygon', natural: 'water' }, 'MULTIPOLYGON(((10.3 50.01, 10.43 50.01, 10.43 50.03, 10.3 50.03, 10.3 50.01)))'],
  ['W', 98340006, { highway: 'primary' }, 'LINESTRING(10.45 50.06, 10.46 50.06)'],
  ['R', 98340007, { type: 'bridge' }, 'GEOMETRYCOLLECTION(LINESTRING(10.44 50, 10.5 50), LINESTRING(10.47 49.6, 10.47 50.4))'],
];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM osm_objects WHERE osm_id BETWEEN 98340001 AND 98349999');
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

let sourceId = 0;

/** A place of Bridges & engineering marvels with one point, its record offered or waiting. */
async function bridge(id: number, lon: number, lat: number, state: 'auto' | 'pending'): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, sourceId, ITEM(id), `A crossing (line fixture ${id})`, lon, lat],
  );
  await pool.query(
    `INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, $3::text, CASE WHEN $3::text = 'auto' THEN NOW() END FROM experience_sources s WHERE s.id = $4`,
    [id, ITEM(id), state, sourceId],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     VALUES ($1, 'fixture point', 1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'auto')`,
    [id, lon, lat],
  );
}

/** Lay the fixture's objects into the layer, every one carrying the item of `place`. */
async function layer(place: number, objects = OBJECTS): Promise<void> {
  for (const [type, id, tags, wkt] of objects) {
    await pool.query(
      `INSERT INTO osm_objects (osm_type, osm_id, tags, wikidata, geom) VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326))`,
      [type, id, { ...tags, wikidata: ITEM(place) }, ITEM(place), wkt],
    );
  }
}

async function line(id: number): Promise<{ ref: string | null; source: number | null; at: Date | null; metres: number | null }> {
  const result = await pool.query<{ ref: string | null; source: number | null; at: Date | null; metres: number | null }>(
    `SELECT path_source_ref AS ref, path_source_id AS source, path_updated_at AS at,
            round(ST_Length(path::geography))::int AS metres
       FROM experiences WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

/** The bridge's regions in the fixture's world view. */
const regions = async () => (await pool.query<{ region_id: number }>(
  `SELECT er.region_id FROM experience_regions er JOIN regions r ON r.id = er.region_id AND r.world_view_id = $2
    WHERE er.experience_id = $1 ORDER BY er.region_id`, [BRIDGE, WORLD_VIEW],
)).rows.map(row => row.region_id);

const written = async () => {
  const lines = await writeLines(sourceId, AT);
  return lines.changed.filter(id => PLACES.includes(id));
};

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Bridges & engineering marvels'`);
  expect(source.rowCount).toBe(1);
  sourceId = source.rows[0].id;
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Line fixture', false)`, [WORLD_VIEW]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
       ($1, $4, 'Root', NULL, false, NULL),
       ($2, $4, 'Leaf A', $1, true, ST_Multi(ST_MakeEnvelope(9.5, 49.5, 10.5, 50.5, 4326))),
       ($3, $4, 'Leaf B', $1, true, ST_Multi(ST_MakeEnvelope(10.5, 49.5, 11.5, 50.5, 4326)))`,
    [ROOT, LEAF_A, LEAF_B, WORLD_VIEW],
  );
  await bridge(BRIDGE, 10.45, 50.0, 'auto');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a bridge's line from the OpenStreetMap layer (ADR-0212)", () => {
  it("draws the line from the objects that are the structure, near its point, an area by its outer ring", async () => {
    await layer(BRIDGE);

    expect(await written()).toEqual([BRIDGE]);
    // The motorway (4.3 km), the bridge's outline (2 x 4.3 km and its two
    // ends) and the route (8.6 km); not the pipeline, the lake, the far road
    // or the bridge relation's river.
    expect(await line(BRIDGE)).toEqual({ ref: 'osm:R98340003,W98340001,W98340002', source: sourceId, at: AT, metres: 21953 });
  });

  it('places the bridge in every leaf its line crosses, as the Øresund Bridge is in Denmark and Sweden', async () => {
    await assignRegionsForExperiences([BRIDGE], WORLD_VIEW);
    expect(await regions()).toEqual([ROOT, LEAF_A]);

    await layer(BRIDGE);
    await written();
    await assignRegionsForExperiences([BRIDGE], WORLD_VIEW);

    expect(await regions()).toEqual([ROOT, LEAF_A, LEAF_B]);
  });

  it('names for placement every place a line decides, and one whose line is gone until it is placed again', async () => {
    await layer(BRIDGE);
    await written();
    expect(await placedByLines()).toContain(BRIDGE);
    await assignRegionsForExperiences([BRIDGE], WORLD_VIEW);
    expect(await regions()).toEqual([ROOT, LEAF_A, LEAF_B]);

    // The objects go: the line goes, and its regions stay until the place is placed again.
    await pool.query('DELETE FROM osm_objects WHERE osm_id BETWEEN 98340001 AND 98349999');
    await written();
    expect(await placedByLines()).toContain(BRIDGE);
    await assignRegionsForExperiences([BRIDGE], WORLD_VIEW);
    expect(await regions()).toEqual([ROOT, LEAF_A]);
    expect(await placedByLines()).not.toContain(BRIDGE);
  });

  it('answers a line only when it changed, and stamps the layer it was read from', async () => {
    await layer(BRIDGE);
    await written();

    const later = new Date('2026-11-15T00:00:00Z');
    const again = await writeLines(sourceId, later);
    expect(again.changed.filter(id => PLACES.includes(id))).toEqual([]);
    expect((await line(BRIDGE)).at).toEqual(later);
  });

  it('takes the line away from a place whose objects are gone, or that its kind no longer offers', async () => {
    await layer(BRIDGE);
    await written();
    await pool.query('DELETE FROM osm_objects WHERE osm_id BETWEEN 98340001 AND 98349999');

    expect(await written()).toEqual([BRIDGE]);
    expect(await line(BRIDGE)).toEqual({ ref: null, source: null, at: null, metres: null });

    await layer(BRIDGE);
    await written();
    await pool.query(`UPDATE ${MEMBERSHIPS} SET admission = 'refused' WHERE experience_id = $1`, [BRIDGE]);
    expect(await written()).toEqual([BRIDGE]);
    expect((await line(BRIDGE)).ref).toBeNull();
  });

  it("draws no line for a place waiting for a curator, nor over a curator's or another source's", async () => {
    await bridge(DAM, 10.45, 50.0, 'pending');
    await bridge(CLAIMED, 10.45, 50.0, 'auto');
    await bridge(OTHERS, 10.45, 50.0, 'auto');
    const drawn = 'ST_Multi(ST_GeomFromText(\'LINESTRING(10.4 50, 10.41 50)\', 4326))';
    await pool.query(`UPDATE experiences SET path = ${drawn}, curated_fields = '["path"]'::jsonb WHERE id = $1`, [CLAIMED]);
    await pool.query(
      `UPDATE experiences SET path = ${drawn}, path_source_id = s.id FROM experience_sources s
        WHERE experiences.id = $1 AND s.name = 'Archaeology'`, [OTHERS],
    );
    for (const place of [DAM, CLAIMED, OTHERS]) await layer(place, OBJECTS.slice(0, 1).map(([t, id, tags, wkt]) => [t, id + place - BRIDGE + 100, tags, wkt]));

    expect(await written()).toEqual([]);
    expect(await line(DAM)).toEqual({ ref: null, source: null, at: null, metres: null });
    expect((await line(CLAIMED)).metres).toBe(717);
    expect((await line(OTHERS)).source).not.toBe(sourceId);
    expect(await linedItems(sourceId)).not.toContain(ITEM(DAM));
    expect(await linedItems(sourceId)).toEqual(expect.arrayContaining([ITEM(BRIDGE), ITEM(CLAIMED)]));
  });
});

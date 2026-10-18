import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { unplacedAssertions } from './unplacedAssertions.js';

/**
 * An object no region holds names the region a curator would put it in (#469),
 * against PostgreSQL. The fixture is Gorée's case drawn small: two leaf regions
 * side by side, "Coast Fixture" between 44.70° and 44.82° east and "Inland
 * Fixture" east of it, a neighbouring place placed in the coast so the world
 * view counts as placed, and an island about 850 m off the coast that no region
 * holds.
 */

const assertion = unplacedAssertions.find(a => a.id === 'held-by-no-region')!;
const ISLAND = 9981;
const NEIGHBOUR = 9982;
const VIEW = 'Unplaced fixture (#469)';
let worldView = 0;
let coast = 0;

const square = (west: number, east: number) =>
  `ST_Multi(ST_MakeEnvelope(${west}, 40.10, ${east}, 40.20, 4326))`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [[ISLAND, NEIGHBOUR]]);
  await pool.query('DELETE FROM world_views WHERE name = $1', [VIEW]);
}

/** An offered World Heritage place at a longitude, the way a run leaves one. */
async function offer(id: number, name: string, longitude: number, latitude = 40.15): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1::int, s.id, $1::text, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [id, name, longitude, latitude],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1::int, s.kind_id, s.id, $1::text, 'auto', NOW() FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [id],
  );
}

beforeEach(async () => {
  await clear();
  worldView = (await pool.query<{ id: number }>(`INSERT INTO world_views (name) VALUES ($1) RETURNING id`, [VIEW])).rows[0].id;
  coast = (await pool.query<{ id: number }>(
    `INSERT INTO regions (world_view_id, name, geom) VALUES ($1, 'Coast Fixture', ${square(44.70, 44.82)}) RETURNING id`,
    [worldView],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO regions (world_view_id, name, geom) VALUES ($1, 'Inland Fixture', ${square(44.82, 44.95)})`,
    [worldView],
  );
  await offer(NEIGHBOUR, 'Unplaced fixture harbour', 44.75);
  await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')`, [NEIGHBOUR, coast]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

type Suggestion = { view: string; region: string; metres: number; next: string | null; next_metres: number | null };

/** The island's row, if it is asked about, and what it suggests in the fixture's world view. */
async function island(): Promise<{ row: Record<string, unknown>; ours?: Suggestion } | undefined> {
  const row = (await pool.query(assertion.sql)).rows.find(r => r.experience_id === ISLAND);
  if (!row) return undefined;
  return { row, ours: (row.suggestions as Suggestion[] | null)?.find(s => s.view === VIEW) };
}

describe('an object no region holds, and the region it is near (#469)', () => {
  it('names the nearest leaf and the next, nearest first', async () => {
    // 44.69 is about 850 m west of the coast at 40.15° N, and 11 km from the inland region.
    await offer(ISLAND, 'Unplaced fixture island', 44.69);
    const found = await island();
    expect(found?.ours).toMatchObject({ region: 'Coast Fixture', next: 'Inland Fixture' });
    expect(found!.ours!.metres).toBeGreaterThan(800);
    expect(found!.ours!.metres).toBeLessThan(900);
    expect(found!.ours!.next_metres).toBeGreaterThan(10_000);
    expect(found!.ours!.next_metres).toBeLessThan(12_000);
    expect(assertion.describe(found!.row)).toContain(`nearest Coast Fixture (${VIEW}) at ${found!.ours!.metres} m, next Inland Fixture at`);
  });

  it('ranks the leaves by their distance on the sphere, not by degrees', async () => {
    // At 55° N a degree of longitude is 0.57 of a degree of latitude: a leaf
    // 0.12° north is 13.3 km away, one 0.15° east is 9.6 km away.
    await pool.query(
      `INSERT INTO regions (world_view_id, name, geom) VALUES
         ($1, 'North Fixture', ST_Multi(ST_MakeEnvelope(9.95, 55.12, 10.05, 55.20, 4326))),
         ($1, 'East Fixture', ST_Multi(ST_MakeEnvelope(10.15, 54.95, 10.25, 55.05, 4326)))`,
      [worldView],
    );
    await offer(ISLAND, 'Unplaced fixture island', 10.0, 55.0);
    const ours = (await island())?.ours;
    expect(ours).toMatchObject({ region: 'East Fixture', next: 'North Fixture' });
    expect(ours!.metres).toBeLessThan(ours!.next_metres!);
  });

  it('suggests nothing past the reach, and nothing in a world view no run has placed into', async () => {
    // 44.30 is about 34 km west of the coast.
    await offer(ISLAND, 'Unplaced fixture island', 44.30);
    expect((await island())?.ours).toBeUndefined();

    await pool.query('UPDATE experiences SET location = ST_SetSRID(ST_MakePoint(44.69, 40.15), 4326) WHERE id = $1', [ISLAND]);
    expect((await island())?.ours).toBeDefined();
    await pool.query('DELETE FROM experience_regions WHERE experience_id = $1', [NEIGHBOUR]);
    expect((await island())?.ours).toBeUndefined();
  });

  it('is silent once a curator has added the object to a region by hand', async () => {
    await offer(ISLAND, 'Unplaced fixture island', 44.69);
    expect(await island()).toBeDefined();
    await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`, [ISLAND, coast]);
    expect(await island()).toBeUndefined();
  });
});

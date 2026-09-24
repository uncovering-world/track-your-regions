import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * A write to region_members clears the region whose union it changed, and the
 * geom trigger carries that to its ancestors (#718, ADR-0068), executed
 * against PostgreSQL: what is asserted is what the triggers write, which no
 * mocked pool can say.
 *
 * The fixture is its own world view: Europe holding two leaves, Iberia and
 * France, each with a stored outline, and three made-up divisions — Spain,
 * Portugal and France. Deleted before and after.
 */

const WORLD_VIEW_ID = 9500;
const EUROPE = 9501;
const IBERIA = 9502;
const FRANCE = 9503;
const SPAIN_DIV = 99501;
const PORTUGAL_DIV = 99502;
const FRANCE_DIV = 99503;

const SQUARE = (x: number) => `MULTIPOLYGON(((${x} 40, ${x + 5} 40, ${x + 5} 45, ${x} 45, ${x} 40)))`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[SPAIN_DIV, PORTUGAL_DIV, FRANCE_DIV]]);
}

/** Which of the fixture's regions still hold a stored outline. */
async function withGeometry(): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    'SELECT id FROM regions WHERE world_view_id = $1 AND geom IS NOT NULL ORDER BY id',
    [WORLD_VIEW_ID],
  );
  return result.rows.map((r) => r.id);
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, geom) VALUES
       ($1, 'Spain', ST_GeomFromText($4, 4326)),
       ($2, 'Portugal', ST_GeomFromText($5, 4326)),
       ($3, 'France', ST_GeomFromText($6, 4326))`,
    [SPAIN_DIV, PORTUGAL_DIV, FRANCE_DIV, SQUARE(-5), SQUARE(-10), SQUARE(0)],
  );
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Members fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $4, 'Europe', NULL, false), ($2, $4, 'Iberia', $1, true), ($3, $4, 'France', $1, true)`,
    [EUROPE, IBERIA, FRANCE, WORLD_VIEW_ID],
  );
  await pool.query(
    'INSERT INTO region_members (region_id, division_id) VALUES ($1, $3), ($2, $4)',
    [IBERIA, FRANCE, SPAIN_DIV, FRANCE_DIV],
  );
  // Outlines last, leaves before their parent: a leaf's write clears the
  // parent, which is the rule these specs are about.
  await pool.query('UPDATE regions SET geom = ST_GeomFromText($2, 4326) WHERE id = $1', [IBERIA, SQUARE(-5)]);
  await pool.query('UPDATE regions SET geom = ST_GeomFromText($2, 4326) WHERE id = $1', [FRANCE, SQUARE(0)]);
  await pool.query('UPDATE regions SET geom = ST_GeomFromText($2, 4326) WHERE id = $1', [EUROPE, 'MULTIPOLYGON(((-5 40, 5 40, 5 45, -5 45, -5 40)))']);
  expect(await withGeometry()).toEqual([EUROPE, IBERIA, FRANCE]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a member change clears its region and the ancestors above it (#718)', () => {
  it('clears Iberia and Europe when Portugal is added to Iberia, and leaves France', async () => {
    await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [IBERIA, PORTUGAL_DIV]);
    expect(await withGeometry()).toEqual([FRANCE]);
  });

  it('clears the region a member leaves', async () => {
    await pool.query('DELETE FROM region_members WHERE region_id = $1', [FRANCE]);
    expect(await withGeometry()).toEqual([IBERIA]);
  });

  it('clears both regions when a member moves between them', async () => {
    await pool.query('UPDATE region_members SET region_id = $1 WHERE region_id = $2', [IBERIA, FRANCE]);
    expect(await withGeometry()).toEqual([]);
  });

  it('clears a region whose member is cut to a part of its division', async () => {
    await pool.query(
      'UPDATE region_members SET custom_geom = ST_GeomFromText($2, 4326) WHERE region_id = $1',
      [IBERIA, 'MULTIPOLYGON(((-5 40, -2 40, -2 45, -5 45, -5 40)))'],
    );
    expect(await withGeometry()).toEqual([FRANCE]);
  });

  it('leaves every outline when a part is only renamed, since it draws the same shape', async () => {
    await pool.query("UPDATE region_members SET custom_name = 'Castile and the rest' WHERE region_id = $1", [IBERIA]);
    expect(await withGeometry()).toEqual([EUROPE, IBERIA, FRANCE]);
  });

  it('leaves a hand-drawn region as drawn, and so nothing above it', async () => {
    await pool.query('UPDATE regions SET is_custom_boundary = true WHERE id = $1', [IBERIA]);
    await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [IBERIA, PORTUGAL_DIV]);
    expect(await withGeometry()).toEqual([EUROPE, IBERIA, FRANCE]);
  });
});

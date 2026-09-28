import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * A write to regions that changes what a tile draws bumps its world view's
 * tile_version, once per transaction, at commit (#688, ADR-0075), executed
 * against PostgreSQL: the bump is made by deferred triggers, which no mocked
 * pool runs.
 *
 * The fixture is two world views of their own: Europe holding Iberia and
 * France, and an empty second one a region can be moved to. Deleted before
 * and after.
 */

const WORLD_VIEW_ID = 9800;
const OTHER_WORLD_VIEW_ID = 9810;
const EUROPE = 9801;
const IBERIA = 9802;
const FRANCE = 9803;

const SQUARE = (x: number) => `MULTIPOLYGON(((${x} 40, ${x + 5} 40, ${x + 5} 45, ${x} 45, ${x} 40)))`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = ANY($1::int[])', [[WORLD_VIEW_ID, OTHER_WORLD_VIEW_ID]]);
}

async function tileVersion(worldViewId = WORLD_VIEW_ID): Promise<number> {
  const result = await pool.query<{ tile_version: number }>('SELECT tile_version FROM world_views WHERE id = $1', [worldViewId]);
  return result.rows[0].tile_version;
}

/** Run `statements` in one transaction, on one client, and commit. */
async function inTransaction(statements: Array<[string, unknown[]]>, commit = true): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [text, params] of statements) await client.query(text, params);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO world_views (id, name, is_default, tile_version) VALUES
       ($1, 'Tile version fixture', false, 0), ($2, 'Tile version fixture, other', false, 0)`,
    [WORLD_VIEW_ID, OTHER_WORLD_VIEW_ID],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, geom) VALUES
       ($1, $4, 'Europe', NULL, NULL),
       ($2, $4, 'Iberia', $1, ST_GeomFromText($5, 4326)),
       ($3, $4, 'France', $1, ST_GeomFromText($6, 4326))`,
    [EUROPE, IBERIA, FRANCE, WORLD_VIEW_ID, SQUARE(-5), SQUARE(0)],
  );
  await pool.query('UPDATE world_views SET tile_version = 0 WHERE id = ANY($1::int[])', [[WORLD_VIEW_ID, OTHER_WORLD_VIEW_ID]]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a write that changes what a tile draws bumps tile_version', () => {
  it('bumps on a rename, a recolour, a reparent and a uses_hull flip', async () => {
    await pool.query("UPDATE regions SET name = 'Hispania' WHERE id = $1", [IBERIA]);
    expect(await tileVersion()).toBe(1);
    await pool.query("UPDATE regions SET color = '#aa3300' WHERE id = $1", [IBERIA]);
    expect(await tileVersion()).toBe(2);
    await pool.query('UPDATE regions SET parent_region_id = NULL WHERE id = $1', [FRANCE]);
    expect(await tileVersion()).toBe(3);
    await pool.query('UPDATE regions SET uses_hull = NOT COALESCE(uses_hull, false) WHERE id = $1', [FRANCE]);
    expect(await tileVersion()).toBe(4);
  });

  it('bumps on a drawn outline, a hull and a cleared outline', async () => {
    await pool.query('UPDATE regions SET geom = ST_GeomFromText($2, 4326) WHERE id = $1', [IBERIA, SQUARE(-6)]);
    expect(await tileVersion()).toBe(1);
    await pool.query('UPDATE regions SET hull_geom = ST_GeomFromText($2, 4326) WHERE id = $1', [FRANCE, SQUARE(0)]);
    expect(await tileVersion()).toBe(2);
    await pool.query('UPDATE regions SET geom = NULL WHERE id = $1', [FRANCE]);
    expect(await tileVersion()).toBe(3);
  });

  it('bumps on an insert and on a delete', async () => {
    await pool.query("INSERT INTO regions (world_view_id, name, parent_region_id) VALUES ($1, 'Italy', $2)", [WORLD_VIEW_ID, EUROPE]);
    expect(await tileVersion()).toBe(1);
    await pool.query('DELETE FROM regions WHERE id = $1', [FRANCE]);
    expect(await tileVersion()).toBe(2);
  });

  it('bumps both world views when a region moves between them', async () => {
    await pool.query('UPDATE regions SET world_view_id = $2, parent_region_id = NULL WHERE id = $1', [FRANCE, OTHER_WORLD_VIEW_ID]);
    expect(await tileVersion()).toBe(1);
    expect(await tileVersion(OTHER_WORLD_VIEW_ID)).toBe(1);
  });
});

describe('what does not change a tile does not bump it', () => {
  it('leaves tile_version alone on a form saved unchanged', async () => {
    await pool.query('UPDATE regions SET name = name, color = color, parent_region_id = parent_region_id WHERE id = $1', [IBERIA]);
    expect(await tileVersion()).toBe(0);
  });

  it('leaves tile_version alone on a column no tile reads', async () => {
    await pool.query("UPDATE regions SET description = 'The peninsula', is_custom_boundary = true WHERE id = $1", [IBERIA]);
    expect(await tileVersion()).toBe(0);
  });

  it('leaves tile_version alone when the transaction rolls back', async () => {
    await inTransaction([["UPDATE regions SET name = 'Hispania' WHERE id = $1", [IBERIA]]], false);
    expect(await tileVersion()).toBe(0);
  });
});

describe('a transaction bumps once per world view, at its commit', () => {
  it('bumps once for several writes of one world view', async () => {
    await inTransaction([
      ["UPDATE regions SET name = 'Hispania' WHERE id = $1", [IBERIA]],
      ['UPDATE regions SET geom = ST_GeomFromText($2, 4326) WHERE id = $1', [FRANCE, SQUARE(1)]],
      ["INSERT INTO regions (world_view_id, name, parent_region_id) VALUES ($1, 'Italy', $2)", [WORLD_VIEW_ID, EUROPE]],
    ]);
    expect(await tileVersion()).toBe(1);
  });

  it('bumps nothing another session can see before the commit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE regions SET name = 'Hispania' WHERE id = $1", [IBERIA]);
      expect(await tileVersion()).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await tileVersion()).toBe(1);
  });

  it('bumps again in the next transaction on the same connection', async () => {
    const client = await pool.connect();
    try {
      for (const name of ['Hispania', 'Iberia']) {
        await client.query('BEGIN');
        await client.query('UPDATE regions SET name = $2 WHERE id = $1', [IBERIA, name]);
        await client.query('COMMIT');
      }
    } finally {
      client.release();
    }
    expect(await tileVersion()).toBe(2);
  });
});

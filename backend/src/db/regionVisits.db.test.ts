import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { pool } from './index.js';
import { deleteRegion } from '../controllers/worldView/regionCrud.js';
import { deleteWorldView } from '../controllers/worldView/worldViewCrud.js';

/**
 * A hierarchy edit never deletes a traveller's visit (#764), executed against
 * PostgreSQL: what is asserted is what the foreign key refuses and what the
 * world view delete's one statement removes, which a mocked pool cannot say.
 *
 * The fixture is a world view of its own (Europe with Malta under it, the
 * traveller's visit on Malta) and one user, deleted before and after; the
 * smoke fixture sharing this database is never touched.
 */

const WORLD_VIEW_ID = 9200;
const EUROPE_ID = 9201;
const MALTA_ID = 9202;
const USER_UUID = '00000000-0000-4000-8000-000000009200';

let userId = 0;

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM user_visited_regions WHERE user_id IN (SELECT id FROM users WHERE uuid = $1)',
    [USER_UUID],
  );
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

async function visitsOnMalta(): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM user_visited_regions WHERE region_id = $1',
    [MALTA_ID],
  );
  return result.rows[0].n;
}

function answer(): Response & { statusCode?: number } {
  const res = {
    status(code: number) { res.statusCode = code; return res; },
    send() { return res; },
    json() { return res; },
  } as unknown as Response & { statusCode?: number };
  return res;
}

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A traveller') RETURNING id`,
    [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Visits fixture', false)`,
    [WORLD_VIEW_ID],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $3, 'Europe', NULL, false),
       ($2, $3, 'Malta', $1, true)`,
    [EUROPE_ID, MALTA_ID, WORLD_VIEW_ID],
  );
  await pool.query(
    'INSERT INTO user_visited_regions (user_id, region_id) VALUES ($1, $2)',
    [userId, MALTA_ID],
  );
});

afterEach(clear);
afterAll(() => pool.end());

describe('a visited region', () => {
  it('is not deleted by a plain delete, whichever writer sends it', async () => {
    await expect(pool.query('DELETE FROM regions WHERE id = $1', [MALTA_ID]))
      .rejects.toMatchObject({ code: '23503', constraint: 'user_visited_regions_region_id_fkey' });
    expect(await visitsOnMalta()).toBe(1);
  });

  it('refuses deleteRegion on its parent before anything is moved or deleted', async () => {
    const req = { params: { regionId: String(EUROPE_ID) }, query: {} } as unknown as Request;
    await expect(deleteRegion(req, answer())).rejects.toMatchObject({ statusCode: 409 });

    const left = await pool.query<{ id: number; parent_region_id: number | null }>(
      'SELECT id, parent_region_id FROM regions WHERE world_view_id = $1 ORDER BY id',
      [WORLD_VIEW_ID],
    );
    expect(left.rows).toEqual([
      { id: EUROPE_ID, parent_region_id: null },
      { id: MALTA_ID, parent_region_id: EUROPE_ID },
    ]);
    expect(await visitsOnMalta()).toBe(1);
  });

  it('lets deleteRegion move the visited child up and delete only the parent', async () => {
    const req = {
      params: { regionId: String(EUROPE_ID) },
      query: { moveChildrenToParent: 'true' },
    } as unknown as Request;
    const res = answer();
    await deleteRegion(req, res);

    expect(res.statusCode).toBe(204);
    const malta = await pool.query<{ parent_region_id: number | null }>(
      'SELECT parent_region_id FROM regions WHERE id = $1',
      [MALTA_ID],
    );
    expect(malta.rows).toEqual([{ parent_region_id: null }]);
    expect(await visitsOnMalta()).toBe(1);
  });

  it('goes with its world view, whose delete the admin confirmed', async () => {
    const req = { params: { worldViewId: String(WORLD_VIEW_ID) } } as unknown as Request;
    const res = answer();
    await deleteWorldView(req, res);

    expect(res.statusCode).toBe(204);
    expect(await visitsOnMalta()).toBe(0);
    const regions = await pool.query('SELECT 1 FROM regions WHERE world_view_id = $1', [WORLD_VIEW_ID]);
    expect(regions.rowCount).toBe(0);
  });
});

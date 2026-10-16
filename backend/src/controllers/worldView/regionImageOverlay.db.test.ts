import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/**
 * A region's reference map kept in the database (#595, ADR-0113), executed
 * against PostgreSQL: the upsert, the region it must name and the cascade are
 * the statement's and the schema's, which a mocked pool cannot say.
 *
 * The fixture is its own world view with one region, Flanders, and an admin.
 */

const getRoute = routeAt(worldViewRoutes, '/regions/:regionId/image-overlay', 'get');
const putRoute = routeAt(worldViewRoutes, '/regions/:regionId/image-overlay', 'put');
const deleteRoute = routeAt(worldViewRoutes, '/regions/:regionId/image-overlay', 'delete');

const WORLD_VIEW_ID = 9310;
const FLANDERS_ID = 9311;
const ADMIN_UUID = '00000000-0000-4000-8000-000000009310';

/** The smallest PNG there is: one transparent pixel. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CORNERS = [[2.5, 51.5], [5.9, 51.5], [5.9, 50.7], [2.5, 50.7]];

let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN_UUID]);
}

function res(): { statusCode?: number; body?: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown; send: () => unknown; end: () => unknown } {
  const r = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) { r.statusCode = code; return r; },
    json(body: unknown) { r.body = body; return r; },
    send() { return r; },
    end() { return r; },
  };
  return r;
}

function overlay(opacity: number, name = 'Provinces of Flanders.png') {
  return {
    imageDataUrl: `data:image/png;base64,${PNG}`, imageName: name, imageWidth: 1, imageHeight: 1, corners: CORNERS, opacity,
  };
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN_UUID],
  )).rows[0].id;
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Overlay fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES ($1, $2, 'Flanders', NULL, true)`,
    [FLANDERS_ID, WORLD_VIEW_ID],
  );
});

afterEach(clear);
afterAll(() => pool.end());

const params = { regionId: String(FLANDERS_ID) };

describe("a region's reference map (#595)", () => {
  it('is none until saved, then the image it was given, and a second save replaces it', async () => {
    const none = res();
    await answerRoute(getRoute, { params, user: { id: adminId, role: 'admin' } as Express.User }, none);
    expect(none.statusCode).toBe(204);

    await answerRoute(putRoute, { params, body: overlay(0.7), user: { id: adminId, role: 'admin' } as Express.User }, res());
    const replaced = res();
    await answerRoute(putRoute, { params, body: overlay(0.4, 'Flanders, redrawn.png'), user: { id: adminId, role: 'admin' } as Express.User }, replaced);
    expect(replaced.statusCode).toBe(204);

    const read = res();
    await answerRoute(getRoute, { params, user: { id: adminId, role: 'admin' } as Express.User }, read);
    expect(read.body).toMatchObject({
      regionId: FLANDERS_ID, imageDataUrl: `data:image/png;base64,${PNG}`, imageName: 'Flanders, redrawn.png',
      corners: CORNERS, opacity: expect.closeTo(0.4, 5),
    });
    const rows = await pool.query<{ n: string; updated_by: number }>(
      'SELECT count(*) OVER () AS n, updated_by FROM region_image_overlays WHERE region_id = $1', [FLANDERS_ID],
    );
    expect(rows.rows).toEqual([{ n: '1', updated_by: adminId }]);
  });

  it('refuses a region that does not exist, writing nothing', async () => {
    const missing = res();
    await answerRoute(putRoute, { params: { regionId: String(FLANDERS_ID + 99) }, body: overlay(0.7), user: { id: adminId, role: 'admin' } as Express.User }, missing);
    expect(missing.statusCode).toBe(404);
    expect((await pool.query('SELECT 1 FROM region_image_overlays WHERE region_id = $1', [FLANDERS_ID + 99])).rowCount).toBe(0);
  });

  it('goes with its region, and can be taken away on its own', async () => {
    await answerRoute(putRoute, { params, body: overlay(0.7), user: { id: adminId, role: 'admin' } as Express.User }, res());
    const removed = res();
    await answerRoute(deleteRoute, { params, user: { id: adminId, role: 'admin' } as Express.User }, removed);
    expect(removed.statusCode).toBe(204);
    expect((await pool.query('SELECT 1 FROM region_image_overlays WHERE region_id = $1', [FLANDERS_ID])).rowCount).toBe(0);

    await answerRoute(putRoute, { params, body: overlay(0.7), user: { id: adminId, role: 'admin' } as Express.User }, res());
    await pool.query('DELETE FROM regions WHERE id = $1', [FLANDERS_ID]);
    expect((await pool.query('SELECT 1 FROM region_image_overlays WHERE region_id = $1', [FLANDERS_ID])).rowCount).toBe(0);
  });
});

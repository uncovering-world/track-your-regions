import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/**
 * A region's groups in the Create Subregions dialog kept in the database
 * (#595), executed against PostgreSQL: which member rows read as assigned, and
 * what the replace keeps and leaves out, are the statements' own.
 *
 * The fixture is its own world view: Belgium with Flanders under it, two
 * made-up divisions in Belgium (Antwerp and Limburg) and one in Flanders (Ghent).
 */

const getRoute = routeAt(worldViewRoutes, '/regions/:regionId/subdivision-groups', 'get');
const putRoute = routeAt(worldViewRoutes, '/regions/:regionId/subdivision-groups', 'put');
const deleteRoute = routeAt(worldViewRoutes, '/regions/:regionId/subdivision-groups', 'delete');

const WORLD_VIEW_ID = 9320;
const BELGIUM_ID = 9321;
const FLANDERS_ID = 9322;
const DIVISIONS = [99321, 99322, 99323];
const SQUARE = 'MULTIPOLYGON(((3 50, 4 50, 4 51, 3 51, 3 50)))';
const ADMIN = { id: 1, role: 'admin' } as Express.User;

let antwerp = 0;
let limburg = 0;
let ghent = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [DIVISIONS]);
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

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, geom)
     SELECT id, name, ST_GeomFromText($3, 4326) FROM unnest($1::int[], $2::text[]) AS d(id, name)`,
    [DIVISIONS, ['Antwerp', 'Limburg', 'Ghent'], SQUARE],
  );
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Groups fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $3, 'Belgium', NULL, false), ($2, $3, 'Flanders', $1, true)`,
    [BELGIUM_ID, FLANDERS_ID, WORLD_VIEW_ID],
  );
  const rows = await pool.query<{ id: number; division_id: number }>(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $3), ($1, $4), ($2, $5) RETURNING id, division_id`,
    [BELGIUM_ID, FLANDERS_ID, ...DIVISIONS],
  );
  const byDivision = new Map(rows.rows.map((r) => [r.division_id, r.id]));
  [antwerp, limburg, ghent] = DIVISIONS.map((d) => byDivision.get(d)!);
});

afterEach(clear);
afterAll(() => pool.end());

const params = { regionId: String(BELGIUM_ID) };

async function read(): Promise<unknown> {
  const r = res();
  await answerRoute(getRoute, { params, user: ADMIN }, r);
  return r.body;
}

describe("a region's groups in the Create Subregions dialog (#595)", () => {
  it('reads back in their order, with their colour, child region and members', async () => {
    expect(await read()).toEqual({ groups: [] });
    const saved = res();
    await answerRoute(putRoute, {
      params, user: ADMIN,
      body: { groups: [
        { name: 'Flanders', color: '#e41a1c', existingRegionId: FLANDERS_ID, memberRowIds: [antwerp] },
        { name: 'Wallonia', color: null, memberRowIds: [] },
        { name: 'Limburg', memberRowIds: [limburg] },
      ] },
    }, saved);
    expect(saved.statusCode).toBe(204);
    expect(await read()).toEqual({ groups: [
      { name: 'Flanders', color: '#e41a1c', existingRegionId: FLANDERS_ID, memberRowIds: [antwerp] },
      { name: 'Wallonia', color: null, existingRegionId: null, memberRowIds: [] },
      { name: 'Limburg', color: null, existingRegionId: null, memberRowIds: [limburg] },
    ] });
  });

  it("leaves out another region's member and a child region that is none, and replaces the set whole", async () => {
    await answerRoute(putRoute, {
      params, user: ADMIN,
      body: { groups: [{ name: 'Old', memberRowIds: [antwerp, limburg] }] },
    }, res());
    await answerRoute(putRoute, {
      params, user: ADMIN,
      // Ghent is Flanders' member, not Belgium's; Belgium is no child of itself.
      body: { groups: [{ name: 'New', existingRegionId: BELGIUM_ID, memberRowIds: [limburg, ghent] }] },
    }, res());
    expect(await read()).toEqual({ groups: [{ name: 'New', color: null, existingRegionId: null, memberRowIds: [limburg] }] });
  });

  it('refuses a member in two groups, writing nothing', async () => {
    const refused = res();
    await answerRoute(putRoute, {
      params, user: ADMIN,
      body: { groups: [{ name: 'A', memberRowIds: [antwerp] }, { name: 'B', memberRowIds: [antwerp] }] },
    }, refused);
    expect(refused.statusCode).toBe(400);
    expect(await read()).toEqual({ groups: [] });
  });

  it('stops reading a member that moved to another region, and goes with its region', async () => {
    await answerRoute(putRoute, { params, user: ADMIN, body: { groups: [{ name: 'Flanders', memberRowIds: [antwerp, limburg] }] } }, res());
    await pool.query('UPDATE region_members SET region_id = $1 WHERE id = $2', [FLANDERS_ID, antwerp]);
    expect(await read()).toEqual({ groups: [{ name: 'Flanders', color: null, existingRegionId: null, memberRowIds: [limburg] }] });

    const dropped = res();
    await answerRoute(deleteRoute, { params, user: ADMIN }, dropped);
    expect(dropped.statusCode).toBe(204);
    expect(await read()).toEqual({ groups: [] });

    await answerRoute(putRoute, { params, user: ADMIN, body: { groups: [{ name: 'Again', memberRowIds: [limburg] }] } }, res());
    await pool.query('DELETE FROM regions WHERE id = $1', [BELGIUM_ID]);
    expect((await pool.query('SELECT 1 FROM region_subdivision_groups WHERE region_id = $1', [BELGIUM_ID])).rowCount).toBe(0);
  });

  it("takes over a moved member's stale assignment rather than failing the save", async () => {
    // Belgium puts Antwerp in a group; Antwerp's row then moves to Flanders keeping its id,
    // as Create does, so the old assignment row still holds it.
    await answerRoute(putRoute, { params, user: ADMIN, body: { groups: [{ name: 'Flanders', memberRowIds: [antwerp] }] } }, res());
    await pool.query('UPDATE region_members SET region_id = $1 WHERE id = $2', [FLANDERS_ID, antwerp]);

    const saved = res();
    await answerRoute(putRoute, {
      params: { regionId: String(FLANDERS_ID) }, user: ADMIN, body: { groups: [{ name: 'Antwerp province', memberRowIds: [antwerp] }] },
    }, saved);
    expect(saved.statusCode).toBe(204);
    const flanders = res();
    await answerRoute(getRoute, { params: { regionId: String(FLANDERS_ID) }, user: ADMIN }, flanders);
    expect(flanders.body).toEqual({ groups: [{ name: 'Antwerp province', color: null, existingRegionId: null, memberRowIds: [antwerp] }] });
    expect(await read()).toEqual({ groups: [{ name: 'Flanders', color: null, existingRegionId: null, memberRowIds: [] }] });
  });

  it('refuses a region that does not exist', async () => {
    const missing = res();
    await answerRoute(putRoute, { params: { regionId: String(BELGIUM_ID + 99) }, user: ADMIN, body: { groups: [] } }, missing);
    expect(missing.statusCode).toBe(404);
  });
});

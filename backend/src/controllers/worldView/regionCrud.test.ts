import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const updateRegionRoute = routeAt(worldViewRoutes, '/regions/:regionId', 'put');
const deleteRegionRoute = routeAt(worldViewRoutes, '/regions/:regionId', 'delete');
const getRegionAncestorsRoute = routeAt(worldViewRoutes, '/regions/:regionId/ancestors', 'get');

const poolQuery = vi.fn();
const client = { query: vi.fn(), release: vi.fn() };

vi.mock('../../db/index.js', () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    connect: async () => client,
  },
}));


/**
 * A structural change is the one thing the geometry trigger cannot see.
 *
 * Since #680 a write to `regions.geom` marks the derived ancestors above it
 * stale from inside the writing statement, so no writer of geometry has to
 * remember anything. Moving a region between parents and deleting one write no
 * geometry at all, and both change what a parent's union holds — so these two
 * handlers name their rows themselves, and this is the only place that can
 * check they still do.
 *
 * The reparent case is the sharp one.
 * Nulling the moved region reaches its new parent through the trigger only
 * while that statement writes a row, and for a hand-drawn region it writes
 * none: `invalidateRegionGeometry` excludes `is_custom_boundary` so that a
 * member edit cannot wipe a shape somebody drew (#283). A parent's union does
 * hold a hand-drawn child — it collects every child that has geometry and
 * filters none out — so without the explicit third call, moving a drawn region
 * into a continent leaves that continent short of what it holds, with geometry
 * of its own and nothing NULL beneath it: outside every later run's closure,
 * recoverable only by a forced run (#667).
 */

/** A region as the region SELECT hands it over, for a write's answer to read back. */
function regionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42, world_view_id: 5, name: 'Chile', description: null, parent_region_id: 9, color: '#3388ff',
    is_custom_boundary: false, uses_hull: false, focus_bbox: [-109.5, -56, -66.4, -17.5], anchor_point: [-71.5, -35.7],
    has_subregions: false, has_hull_children: false, source_url: null, region_map_url: null, ...overrides,
  };
}

/** Whether a statement is the read every region answer is made of. */
const isRegionRead = (sql: string) => sql.includes('LEFT JOIN region_import_state ris') && sql.includes('WHERE cg.id = $1');

/** The ids the handler asked to invalidate, in order. */
function invalidatedIds(): unknown[] {
  return poolQuery.mock.calls
    .filter(([sql]) => /(?<!\w)geom\s*=\s*NULL/.test(String(sql)))
    .map(([, params]) => (params as unknown[])[0]);
}

describe('updateRegion invalidates both sides of a reparent (#680)', () => {
  const REGION = 42;
  const OLD_PARENT = 7;
  const NEW_PARENT = 9;

  beforeEach(() => {
    poolQuery.mockReset();
    client.query.mockReset();
    client.query.mockResolvedValue({ rows: [] });
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT name, parent_region_id, uses_hull')) {
        return { rows: [{ name: 'Chile', parent_region_id: OLD_PARENT, uses_hull: false }] };
      }
      if (s.includes('UPDATE regions') && s.includes('RETURNING world_view_id')) {
        return { rows: [{ world_view_id: 5 }] };
      }
      if (isRegionRead(s)) return { rows: [regionRow({ parent_region_id: NEW_PARENT })] };
      return { rows: [], rowCount: 0 };
    });
  });

  function reparent(): Promise<void> {
    const req = {
      params: { regionId: String(REGION) },
      body: { parentRegionId: NEW_PARENT },
    } as unknown as Request;
    const res = { json: vi.fn() } as unknown as Response;
    return answerRoute(updateRegionRoute, req, res);
  }

  it('names the moved region, the parent it left and the parent it joined', async () => {
    await reparent();
    // The new parent is the one the trigger cannot be trusted to reach: for a
    // hand-drawn region the moved region's own statement writes no row, so
    // nothing fires.
    expect(invalidatedIds()).toEqual([REGION, OLD_PARENT, NEW_PARENT]);
  });

  it('leaves geometry alone when the parent did not change', async () => {
    const req = {
      params: { regionId: String(REGION) },
      body: { parentRegionId: OLD_PARENT, name: 'Chile' },
    } as unknown as Request;
    await answerRoute(updateRegionRoute, req, { json: vi.fn() } as unknown as Response);

    expect(invalidatedIds()).toEqual([]);
  });
});

describe('deleteRegion invalidates the parent it left behind (#680)', () => {
  const REGION = 42;
  const PARENT = 7;

  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT parent_region_id FROM regions')) {
        return { rows: [{ parent_region_id: PARENT }] };
      }
      if (String(sql).includes('user_visited_regions')) return { rows: [{ visits: 0 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it('does so from the handler, since a DELETE fires no trigger on geom', async () => {
    const req = { params: { regionId: String(REGION) }, query: {} } as unknown as Request;
    const res = { status: vi.fn(() => ({ send: vi.fn(), json: vi.fn() })) } as unknown as Response;

    await answerRoute(deleteRegionRoute, req, res);

    expect(invalidatedIds()).toEqual([PARENT]);
  });

  it('has nothing to name when the region was a root', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT parent_region_id FROM regions')) {
        return { rows: [{ parent_region_id: null }] };
      }
      if (String(sql).includes('user_visited_regions')) return { rows: [{ visits: 0 }] };
      return { rows: [], rowCount: 0 };
    });
    const req = { params: { regionId: String(REGION) }, query: {} } as unknown as Request;
    const res = { status: vi.fn(() => ({ send: vi.fn(), json: vi.fn() })) } as unknown as Response;

    await answerRoute(deleteRegionRoute, req, res);

    expect(invalidatedIds()).toEqual([]);
  });

  it('refuses before its first write when a traveller has visited the branch (#764)', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT parent_region_id FROM regions')) {
        return { rows: [{ parent_region_id: PARENT }] };
      }
      if (String(sql).includes('user_visited_regions')) return { rows: [{ visits: 2 }] };
      return { rows: [], rowCount: 0 };
    });
    const req = { params: { regionId: String(REGION) }, query: {} } as unknown as Request;
    const status = vi.fn(() => ({ send: vi.fn(), json: vi.fn() }));

    await answerRoute(deleteRegionRoute, req, { status });

    expect(status).toHaveBeenCalledWith(409);

    const writes = poolQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => /\b(UPDATE|DELETE|INSERT)\b/.test(sql));
    expect(writes).toEqual([]);
    expect(invalidatedIds()).toEqual([]);
  });
});

/**
 * A `uses_hull` flip is a geometry write, and this one bumps the tile version
 * beside it.
 *
 * Not because every writer of a rendered rung does — they do not, and
 * `regionCrud.ts` records which ones. The flag chooses what the four derived
 * rungs are made of (rule 19) and
 * `trg_regions_geom_3857` rebuilds them on it, so the tiles are built from
 * different geometry at unchanged URLs — which without a bump a reader gets back
 * out of Martin's cache at cache speed, reading as the change having landed.
 * Compared against the stored value rather than fired on the field's presence,
 * or a form saved unchanged would bust every tile URL of the world view.
 */
describe('updateRegion bumps the tile version when the hull flag flips (#685)', () => {
  const REGION = 42;
  const WORLD_VIEW = 5;

  /** The world-view ids whose tile_version the handler bumped, in order. */
  function bumpedWorldViews(): unknown[] {
    return poolQuery.mock.calls
      .filter(([sql]) => /UPDATE world_views SET tile_version/.test(String(sql)))
      .map(([, params]) => (params as unknown[])[0]);
  }

  function mockRegion(usesHull: boolean): void {
    poolQuery.mockReset();
    client.query.mockReset();
    client.query.mockResolvedValue({ rows: [] });
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      // The stored flag is named in the matcher, not just in the row: without it
      // a handler that stopped selecting uses_hull would still be handed one
      // here, read undefined as false, and pass the flip-off case by accident.
      if (s.includes('SELECT name, parent_region_id, uses_hull')) {
        return { rows: [{ name: 'Fiji', parent_region_id: 9, uses_hull: usesHull }] };
      }
      if (s.includes('UPDATE regions') && s.includes('RETURNING world_view_id')) {
        return { rows: [{ world_view_id: WORLD_VIEW }] };
      }
      if (isRegionRead(s)) return { rows: [regionRow({ name: 'Fiji', uses_hull: !usesHull })] };
      if (s.includes('UPDATE world_views SET tile_version')) {
        return { rows: [{ tile_version: 12 }] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  async function setUsesHull(usesHull: boolean, stored: boolean): Promise<unknown> {
    mockRegion(stored);
    const json = vi.fn();
    await answerRoute(updateRegionRoute, 
      { params: { regionId: String(REGION) }, body: { usesHull } } as unknown as Request,
      { json } as unknown as Response,
    );
    return json.mock.calls[0]?.[0];
  }

  it('bumps the world view and answers with the new version', async () => {
    const body = await setUsesHull(true, false) as { tileVersion?: number; usesHull: boolean };
    expect(bumpedWorldViews()).toEqual([WORLD_VIEW]);
    expect(body.tileVersion).toBe(12);
    expect(body.usesHull).toBe(true);
  });

  it('bumps it turning the flag off as well as on', async () => {
    await setUsesHull(false, true);
    expect(bumpedWorldViews()).toEqual([WORLD_VIEW]);
  });

  it('leaves the version alone when the flag is sent unchanged', async () => {
    await setUsesHull(true, true);
    expect(bumpedWorldViews()).toEqual([]);
  });

  it('leaves it alone for a write that does not name the flag', async () => {
    mockRegion(false);
    await answerRoute(updateRegionRoute, 
      { params: { regionId: String(REGION) }, body: { name: 'Fiji' } } as unknown as Request,
      { json: vi.fn() } as unknown as Response,
    );
    expect(bumpedWorldViews()).toEqual([]);
  });
});

/**
 * The client takes the last ancestor as the selected region itself: it
 * completes a selection made on the map from it, and a region restored from the
 * address has nothing else to be completed from. So each ancestor is the whole
 * row every region answer carries, read by the same SELECT.
 */
describe('getRegionAncestors', () => {
  it('answers each ancestor as the whole region row, root first', async () => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('WITH RECURSIVE ancestors') && s.includes('LEFT JOIN region_import_state ris')) {
        return {
          rows: [
            regionRow({ id: 6737, name: 'Europe', parent_region_id: null, has_subregions: true }),
            regionRow({ id: 7323, name: 'Switzerland', parent_region_id: 6737, has_subregions: true }),
            regionRow({ id: 7349, name: 'Zürich', parent_region_id: 7323, source_url: 'https://en.wikivoyage.org/wiki/Zürich' }),
          ],
        };
      }
      return { rows: [] };
    });
    const json = vi.fn();
    await answerRoute(getRegionAncestorsRoute, { params: { regionId: '7349' } } as unknown as Request, { json } as unknown as Response);

    // Root first is the query's to decide (the recursion counts depth up from
    // the region); the mock hands the rows over in that order, so the order is
    // held on the SQL itself.
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/ORDER BY a\.depth DESC/);
    const answer = json.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answer.map((r) => r.name)).toEqual(['Europe', 'Switzerland', 'Zürich']);
    expect(answer[2]).toMatchObject({
      isCustomBoundary: false, hasHullChildren: false, description: null,
      sourceUrl: 'https://en.wikivoyage.org/wiki/Zürich',
    });
  });
});

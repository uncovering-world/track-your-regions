/**
 * What a world-view geometry run picks up, and in what order.
 *
 * A parent's geometry is the union of its children, so the run has to be a
 * closure rather than a filter: taking `geom IS NULL` alone never revisits a
 * parent that already has one, and a child computed after its parent stays
 * outside the parent's outline for good. Four of the eight top-level regions of
 * the Administrative world view were in that state — North America drew Mexico
 * and the Caribbean, 18.3 % of what it holds (#667).
 *
 * The order is the other half: deepest first, so a parent is unioned after the
 * children it is the union of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { runningComputations } from './types.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const computeWorldViewGeometriesRoute = routeAt(worldViewRoutes, '/:worldViewId/compute-geometries', 'post');
const getComputationStatusRoute = routeAt(worldViewRoutes, '/:worldViewId/compute-geometries/status', 'get');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * The run answers the request and then works in the background, so the mock has
 * to satisfy every query it makes: an empty group list ends the work at once,
 * and the total is read straight after the selection.
 */
function stubDatabase(): void {
  mockedQuery.mockImplementation((sql: string) => {
    if (String(sql).includes('COUNT(*)::int as count')) return Promise.resolve({ rows: [{ count: 0 }] });
    return Promise.resolve({ rows: [] });
  });
}

/**
 * The SQL of the group selection, for one run.
 *
 * A world view id of its own per call: the module holds a running-computation
 * slot per world view and answers 409 to a second run of the same one.
 */
let nextWorldView = 900;
async function selectionSqlFor(force: boolean): Promise<string> {
  stubDatabase();
  mockedQuery.mockClear();
  nextWorldView += 1;
  const req = { params: { worldViewId: String(nextWorldView) }, query: force ? { force: 'true' } : {} } as never;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as never;
  await answerRoute(computeWorldViewGeometriesRoute, req, res);
  const call = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('group_depth'));
  if (!call) throw new Error('the run issued no group selection');
  return String(call[0]).replace(/\s+/g, ' ');
}

describe('the regions a world-view run computes', () => {
  beforeEach(() => {
    stubDatabase();
    mockedQuery.mockClear();
  });

  it('takes a region with no geometry and every ancestor of one', async () => {
    const sql = await selectionSqlFor(false);
    expect(sql).toContain('needs_geometry AS');
    expect(sql).toContain('r.geom IS NULL');
    // The upward walk: a region joins because a descendant needs geometry.
    expect(sql).toContain('JOIN needs_geometry n ON n.parent_region_id = p.id');
    expect(sql).toContain('gd.id IN (SELECT id FROM needs_geometry)');
  });

  it('takes every region when forced, and only then', async () => {
    const forced = await selectionSqlFor(true);
    expect(forced).not.toContain('needs_geometry');
    expect(forced).not.toContain('geom IS NULL');
  });

  it('computes deepest first on both arms, since a parent is a union of its children', async () => {
    for (const force of [false, true]) {
      expect(await selectionSqlFor(force)).toContain('ORDER BY gd.depth DESC, gd.id');
    }
  });

  it('never recomputes a user-drawn boundary, on either arm (#283)', async () => {
    for (const force of [false, true]) {
      expect(await selectionSqlFor(force)).toContain('cg.is_custom_boundary IS NOT TRUE');
    }
  });

  /**
   * The closure walks a tree that may hold user-drawn boundaries, and they stop
   * it in both directions. A custom boundary with no geometry is not a region
   * awaiting computation -- it is a shape nobody has drawn yet, and computing
   * its parent would not change what the parent contains. A custom boundary
   * partway up is not made stale by a descendant either: its outline is drawn,
   * not unioned, so it does not move, and neither does anything above it.
   * Without the guard, an empty hand-drawn region would put a continent through
   * a hundred seconds of union for nothing.
   */
  it('lets a user-drawn boundary neither seed the closure nor pass it on', async () => {
    const sql = await selectionSqlFor(false);
    // The seed: only a derived region with nothing to draw.
    expect(sql).toContain('WHERE r.geom IS NULL AND r.is_custom_boundary IS NOT TRUE');
    // The upward walk: the region being climbed to is checked as well.
    expect(sql).toContain('JOIN regions pr ON pr.id = p.id');
    expect(sql).toContain('JOIN needs_geometry n ON n.parent_region_id = p.id WHERE pr.is_custom_boundary IS NOT TRUE');
  });
});

/**
 * Regression test: the status payload has to use the key the client reads.
 *
 * `ComputationStatus.currentRegion` is what both consumers read
 * (`GeometryMapPanelParts`, `WorldViewImportReview`); the endpoint sent
 * `currentGroup`, which nothing reads, so the progress line's region name never
 * rendered and `docs/tech/world-views.md` described a screen that did not exist.
 */
describe('the run status a curator polls', () => {
  it('names the region under the key the client reads', async () => {
    stubDatabase();
    mockedQuery.mockClear();
    nextWorldView += 1;
    const req = { params: { worldViewId: String(nextWorldView) }, query: {} } as never;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as never;

    // Polled while the run is still on the books: the entry is cleaned up once
    // the run finishes, and it is the live payload this pins.
    const running = answerRoute(computeWorldViewGeometriesRoute, req, res);
    const statusReq = { params: { worldViewId: String(nextWorldView) } } as never;
    const statusJson = vi.fn();
    const statusRes = { json: statusJson, status: vi.fn().mockReturnThis() } as never;
    await answerRoute(getComputationStatusRoute, statusReq, statusRes);
    await running;

    const payload = statusJson.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload).toHaveProperty('currentRegion');
    expect(payload).not.toHaveProperty('currentGroup');
    // The tally the completion alert turns amber on.
    expect(payload).toHaveProperty('errors');
  });
});

describe('the slot a run holds', () => {
  it('stays with a later run when a cancelled one fails its read after it', async () => {
    nextWorldView += 1;
    const worldViewId = nextWorldView;
    const req = { params: { worldViewId: String(worldViewId) }, query: {} } as never;
    let failFirst: (err: Error) => void = () => {};
    mockedQuery.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }));
    const first = answerRoute(computeWorldViewGeometriesRoute, req, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never);

    // Cancelled while its first read is pending: the guard lets a second run
    // take the slot, which then holds it.
    runningComputations.get(worldViewId)!.cancel = true;
    const later = { cancel: false, progress: 0, total: 1, status: 'Computing', computed: 0, skipped: 0, errors: 0, currentGroup: '', currentMembers: 0 };
    runningComputations.set(worldViewId, later);

    failFirst(new Error('connection terminated'));
    await expect(first).rejects.toThrow('connection terminated');
    expect(runningComputations.get(worldViewId)).toBe(later);
    runningComputations.delete(worldViewId);
  });

  it('is released when a read before the start fails, so the next request is not answered 409', async () => {
    nextWorldView += 1;
    const req = { params: { worldViewId: String(nextWorldView) }, query: {} } as never;
    mockedQuery.mockImplementation(() => Promise.reject(new Error('connection terminated')));
    await expect(answerRoute(computeWorldViewGeometriesRoute, req, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never))
      .rejects.toThrow('connection terminated');

    stubDatabase();
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await answerRoute(computeWorldViewGeometriesRoute, req, res as never);
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: false }));
  });
});

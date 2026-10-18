/**
 * The admin panel's side of a world view's geometry computation (#1658,
 * ADR-0122): a press queues the computation in the ledger for the dump worker
 * and answers how many regions it will compute, a second press while one is
 * queued or running is refused, and the status a poll reads is the row's,
 * whatever process runs it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('./computationScope.js', () => ({
  loadGroupsToCompute: vi.fn(),
}));
vi.mock('./computationLedger.js', async () => {
  const actual = await vi.importActual<typeof import('./computationLedger.js')>('./computationLedger.js');
  return {
    ComputationAlreadyRunning: actual.ComputationAlreadyRunning,
    closeOrphanedComputations: vi.fn(async () => 0),
    enqueueComputation: vi.fn(async () => 1),
    requestComputationCancel: vi.fn(async () => true),
    shownComputationOf: vi.fn(async () => null),
  };
});

import { pool } from '../../db/index.js';
import { Operation } from '../../services/operationProgress.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';
import { loadGroupsToCompute } from './computationScope.js';
import {
  ComputationAlreadyRunning, enqueueComputation, requestComputationCancel, shownComputationOf, type ComputationRow,
} from './computationLedger.js';
import { statusOf } from './computationProgress.js';

/** The declared routes these specs answer through (ADR-0071). */
const startRoute = routeAt(worldViewRoutes, '/:worldViewId/compute-geometries', 'post');
const statusRoute = routeAt(worldViewRoutes, '/:worldViewId/compute-geometries/status', 'get');
const cancelRoute = routeAt(worldViewRoutes, '/:worldViewId/compute-geometries/cancel', 'post');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const admin = { id: 7, role: 'admin' };
const answerOf = async (route: typeof startRoute, req: Record<string, unknown>) => {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await answerRoute(route, { user: admin, query: {}, ...req } as never, res as never);
  return { body: res.json.mock.calls[0]?.[0] as Record<string, unknown> | undefined, res };
};

const row = (over: Partial<ComputationRow>): ComputationRow => ({
  id: 3, world_view_id: 5, status: 'running', force: false, skip_snapping: false, regions: 4, started_by: 7,
  queued_at: new Date(), started_at: new Date(), finished_at: null, heartbeat_at: new Date(), runner: 'worker:fixture',
  progress: null, cancel_requested_at: null, outcome: null, error: null, stale: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [{ count: 10 }] });
  vi.mocked(loadGroupsToCompute).mockResolvedValue([
    { id: 1, name: 'Adygea', depth: 2, parent_region_id: 2 }, { id: 2, name: 'Russia', depth: 1, parent_region_id: null },
  ]);
});

describe("queuing a world view's geometry computation", () => {
  it('queues it for the dump worker with what was asked and who asked, and answers how many regions it takes', async () => {
    const { body } = await answerOf(startRoute, { params: { worldViewId: '5' }, query: { force: 'true', skipSnapping: 'true' } });
    expect(vi.mocked(loadGroupsToCompute)).toHaveBeenCalledWith(5, true);
    expect(vi.mocked(enqueueComputation)).toHaveBeenCalledWith(5, { force: true, skipSnapping: true, regions: 2, startedBy: 7 });
    expect(body).toMatchObject({ started: true, total: 10, needsComputation: 2, alreadyComputed: 8 });
  });

  it('queues nothing when every region already has its geometry', async () => {
    vi.mocked(loadGroupsToCompute).mockResolvedValue([]);
    const { body } = await answerOf(startRoute, { params: { worldViewId: '5' } });
    expect(vi.mocked(enqueueComputation)).not.toHaveBeenCalled();
    expect(body).toMatchObject({ started: false, needsComputation: 0, alreadyComputed: 10 });
  });

  it('refuses a second one while one is queued or running, in any process', async () => {
    vi.mocked(enqueueComputation).mockRejectedValueOnce(new ComputationAlreadyRunning('already'));
    const { res } = await answerOf(startRoute, { params: { worldViewId: '5' } });
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('the status a poll reads', () => {
  it('answers nothing running when no computation is shown', async () => {
    const { body } = await answerOf(statusRoute, { params: { worldViewId: '5' } });
    expect(body).toEqual({ running: false });
  });

  it('says a queued computation waits for the dump worker', async () => {
    vi.mocked(shownComputationOf).mockResolvedValueOnce(row({ status: 'queued', started_at: null, runner: null }));
    const { body } = await answerOf(statusRoute, { params: { worldViewId: '5' } });
    expect(body).toMatchObject({ running: true, status: 'Waiting for the dump worker...', progress: 0, total: 4, percent: 0 });
  });

  /**
   * `currentRegion` is the key both consumers read (`GeometryMapPanelParts`,
   * `WorldViewImportReview`); a status that sent `currentGroup` left the
   * progress line's region name blank.
   */
  it("reads a running computation's progress from its row, under the keys the client reads", async () => {
    const operation = new Operation('[Fixture]', 2, () => {});
    operation.step(1, 'Computing the geometry of 4 regions, deepest first', 4);
    operation.advance();
    vi.mocked(shownComputationOf).mockResolvedValueOnce(row({
      progress: { progress: 1, total: 4, computed: 1, skipped: 6, errors: 0, status: 'Computing: Russia [depth 1]', currentGroup: 'Russia', operation: operation.progress },
    }));
    const { body } = await answerOf(statusRoute, { params: { worldViewId: '5' } });
    expect(body).toMatchObject({
      running: true, status: 'Computing: Russia [depth 1]', currentRegion: 'Russia', progress: 1, total: 4, percent: 25, errors: 0,
      operation: { step: { index: 1, done: 1, total: 4 }, cancelling: false },
    });
    expect(body).not.toHaveProperty('currentGroup');
    expect(body).toHaveProperty('operation.elapsedSeconds');
  });

  it('reads a running row that stopped beating as stopped, so the panel does not poll a frozen region', () => {
    expect(statusOf(row({ stale: true }))).toMatchObject({
      running: false, status: 'Error: The computation stopped: its process ended or restarted. Start it again to compute what is left.',
    });
  });

  it('says a cancel was asked of a running computation before the worker has read it', () => {
    expect(statusOf(row({ cancel_requested_at: new Date() }))).toMatchObject({ running: true, status: 'Cancelling...' });
  });

  it('names how an ended computation ended, in the words the alert reads', () => {
    expect(statusOf(row({ status: 'success', outcome: '4 computed' }))).toMatchObject({ running: false, status: 'Complete' });
    expect(statusOf(row({ status: 'cancelled', error: 'Cancelled.' }))).toMatchObject({ running: false, status: 'Cancelled' });
    expect(statusOf(row({ status: 'failed', error: 'The computation stopped with the dump worker. Start it again to compute what is left.' })))
      .toMatchObject({ running: false, status: 'Error: The computation stopped with the dump worker. Start it again to compute what is left.' });
  });
});

describe("cancelling a world view's geometry computation", () => {
  it('asks the ledger to stop it', async () => {
    const { body } = await answerOf(cancelRoute, { params: { worldViewId: '5' } });
    expect(vi.mocked(requestComputationCancel)).toHaveBeenCalledWith(5);
    expect(body).toEqual({ cancelled: true });
  });
});

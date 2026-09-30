/**
 * Tests for the sync status endpoint's three answers (#1131): the run this
 * process holds, a run another process holds as its log row says, and no run
 * going, with the newest run's row — which says when a restart stopped it and
 * how far it had got — beside the source's last verdict.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, type SyncProgress } from '../../services/sync/index.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';
import type { LatestSyncLogRow } from '../../services/sync/syncUtils.js';

const statusRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/status', 'get');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const SOURCE = { last_sync_at: new Date('2026-09-29T21:00:00Z'), last_sync_status: 'failed' };

/** A museum run 412 of 1,083 objects in, as its progress writes left its row. */
function row(overrides: Partial<LatestSyncLogRow> = {}): LatestSyncLogRow {
  return {
    id: 140, status: 'running', is_dry_run: false,
    started_at: new Date('2026-09-29T20:40:00Z'), completed_at: null,
    phase: 'processing', status_message: 'Processing 412/1083: Rijksmuseum', current_item: 'Rijksmuseum',
    progress_done: 412, progress_total: 1083, progress_at: new Date('2026-09-29T20:58:14Z'),
    total_fetched: 0, total_created: 37, total_updated: 12, total_unchanged: 360, total_missing: 0,
    total_curated_conflicts: 0, total_held: 3, total_filtered: 0, total_errors: 0,
    stopped_by_restart: false, unplaced: 0, placement_stopped_by_restart: false,
    ...overrides,
  };
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

async function statusOf(sourceId = 2) {
  const res = makeRes();
  await answerRoute(statusRoute, { params: { sourceId: String(sourceId) } } as never, res as never);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

describe('getSyncStatus', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    runningSyncs.clear();
  });

  it('answers the run this process holds from memory, and asks no row', async () => {
    runningSyncs.set(2, {
      cancel: false, kind: 'sync', status: 'processing', statusMessage: 'Processing 5/10: Louvre',
      progress: 5, total: 10, created: 1, updated: 0, unchanged: 4, missing: 0, curatedConflicts: 0,
      held: 0, filtered: 0, errors: 0, currentItem: 'Louvre', logId: 141, dryRun: false,
    } satisfies SyncProgress);

    const { body } = await statusOf();

    expect(body).toMatchObject({ running: true, cancellable: true, percent: 50, logId: 141 });
    expect(body.progressAt).toBeUndefined();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('answers a run another process holds from its row, and says it cannot be cancelled here', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [SOURCE] }).mockResolvedValueOnce({ rows: [row()] });

    const { body } = await statusOf();

    expect(body).toEqual({
      running: true, cancellable: false, kind: 'sync', status: 'processing',
      statusMessage: 'Processing 412/1083: Rijksmuseum', progress: 412, total: 1083, percent: 38,
      created: 37, updated: 12, unchanged: 360, missing: 0, curatedConflicts: 0, held: 3, filtered: 0,
      errors: 0, currentItem: 'Rijksmuseum', logId: 140, dryRun: false,
      progressAt: '2026-09-29T20:58:14.000Z',
    });
  });

  it('answers no run going with the last verdict and the run a restart stopped, as far as it got', async () => {
    const killed = row({
      status: 'failed', completed_at: new Date('2026-09-29T21:00:00Z'), total_fetched: 1083,
      stopped_by_restart: true,
    });
    mockedQuery.mockResolvedValueOnce({ rows: [SOURCE] }).mockResolvedValueOnce({ rows: [killed] });

    const { body } = await statusOf();

    expect(body).toEqual({
      running: false,
      lastSyncAt: '2026-09-29T21:00:00.000Z',
      lastSyncStatus: 'failed',
      lastRun: {
        logId: 140, status: 'failed', dryRun: false,
        startedAt: '2026-09-29T20:40:00.000Z', completedAt: '2026-09-29T21:00:00.000Z',
        phase: 'processing', progress: 412, total: 1083, created: 37, updated: 12, held: 3, errors: 0,
        stoppedByRestart: true, unplaced: 0, placementStoppedByRestart: false,
      },
    });
  });

  it('says how many moved objects a run left unplaced, and when a restart stopped its placement (#1152)', async () => {
    const stopped = row({
      status: 'partial', completed_at: new Date('2026-09-29T21:00:00Z'), total_fetched: 1083,
      progress_done: 1083, unplaced: 37, placement_stopped_by_restart: true,
    });
    mockedQuery.mockResolvedValueOnce({ rows: [SOURCE] }).mockResolvedValueOnce({ rows: [stopped] });

    const { body } = await statusOf();

    expect(body.lastRun).toMatchObject({
      status: 'partial', stoppedByRestart: false, unplaced: 37, placementStoppedByRestart: true,
    });
  });

  it('sends no count for a run from before the list', async () => {
    const old = row({ status: 'success', completed_at: new Date('2026-09-29T21:00:00Z'), unplaced: null });
    mockedQuery.mockResolvedValueOnce({ rows: [SOURCE] }).mockResolvedValueOnce({ rows: [old] });

    const { body } = await statusOf();

    expect(body.lastRun.unplaced).toBeNull();
  });

  it('carries the newest run even when it was a preview, which the source\'s own verdict leaves out', async () => {
    const preview = row({
      status: 'failed', is_dry_run: true, phase: 'fetching', progress_done: 0, progress_total: 0,
      total_created: 0, total_updated: 0, completed_at: new Date('2026-09-29T21:00:00Z'), stopped_by_restart: true,
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ ...SOURCE, last_sync_status: 'success' }] })
      .mockResolvedValueOnce({ rows: [preview] });

    const { body } = await statusOf();

    expect(body.lastSyncStatus).toBe('success');
    expect(body.lastRun).toMatchObject({ dryRun: true, phase: 'fetching', total: 0, stoppedByRestart: true });
  });

  it('sends no last run for a source never run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ last_sync_at: null, last_sync_status: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const { body } = await statusOf();

    expect(body).toEqual({ running: false, lastSyncAt: null, lastSyncStatus: null });
  });

  it('reads the newest row of the source asked about, with the restart marker', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [SOURCE] }).mockResolvedValueOnce({ rows: [] });

    await statusOf(5);

    const [sql, params] = mockedQuery.mock.calls[1];
    expect(params).toEqual([5]);
    expect(sql).toMatch(/ORDER BY l\.id DESC\s+LIMIT 1/);
    expect(sql).toContain('"error":"Server restarted while sync was running"');
    expect(sql).toMatch(/unnest\(w\.unplaced_experience_ids\) AS waiting\(id\)[\s\S]*NOT w\.is_dry_run AND w\.status <> 'running'/);
    expect(sql).toContain('"error":"Server restarted while the run was placing what it moved"');
  });

  it('answers 404 for a source that does not exist, before reading any run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const { res } = await statusOf(99);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).toHaveBeenCalledOnce();
  });
});

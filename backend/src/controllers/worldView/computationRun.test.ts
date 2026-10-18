/**
 * A world view's geometry computation as the dump worker runs it (#1658,
 * ADR-0122): the regions deepest first, then the shared borders, with the
 * row closed as the run ended — done, cancelled by an admin through the row,
 * stopped with the worker, or stopped by an error — and never left running.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('./geometryComputeSingle.js', () => ({
  computeRegionGeometryCore: vi.fn(async () => ({ computed: true, points: 10 })),
}));
vi.mock('./computationScope.js', () => ({
  loadGroupsToCompute: vi.fn(async () => [{ id: 1, name: 'Adygea', depth: 2 }, { id: 2, name: 'Russia', depth: 1 }]),
}));
vi.mock('./computationLedger.js', () => ({
  COMPUTATION_BEAT_EVERY_MS: 5_000,
  beatComputation: vi.fn(async () => ({ cancelRequested: false })),
  claimNextComputation: vi.fn(async () => null),
  closeComputation: vi.fn(async () => undefined),
  closeOrphanedComputations: vi.fn(async () => 0),
}));

import { pool } from '../../db/index.js';
import { computeRegionGeometryCore } from './geometryComputeSingle.js';
import { beatComputation, closeComputation } from './computationLedger.js';
import { runComputation } from './computationRun.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const claimed = { id: 3, world_view_id: 5, force: false, skip_snapping: false };

/** The database the run reads: two regions to compute of ten, one parent of two siblings. */
function stubDatabase(onParents: () => void = () => {}): void {
  mockedQuery.mockImplementation((sql: string) => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int as count')) return Promise.resolve({ rows: [{ count: 10 }] });
    if (text.includes('SELECT id FROM regions WHERE id')) return Promise.resolve({ rows: [{ id: 1 }] });
    if (text.includes('SELECT DISTINCT parent_region_id')) {
      onParents();
      return Promise.resolve({ rows: [{ parent_region_id: 7 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const closedWith = () => vi.mocked(closeComputation).mock.calls[0]?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  stubDatabase();
});

describe("the worker's run of a world view's geometry computation", () => {
  it('computes each region, then simplifies the shared borders, and closes the row with what it did', async () => {
    await runComputation(claimed, new AbortController().signal);
    expect(vi.mocked(computeRegionGeometryCore)).toHaveBeenCalledTimes(2);
    expect(mockedQuery).toHaveBeenCalledWith('SELECT simplify_coverage_regions($1::integer)', [7]);
    expect(closedWith()).toMatchObject({
      status: 'success', outcome: '2 computed, 8 skipped, 0 errors', error: null,
      progress: { progress: 2, total: 2, status: 'Complete' },
    });
  });

  it('beats once it knows what it has to do, so the panel reads the count before the first region', async () => {
    await runComputation(claimed, new AbortController().signal);
    expect(vi.mocked(beatComputation).mock.calls[0]).toEqual([3, expect.objectContaining({ total: 2, progress: 0, skipped: 8 })]);
  });

  it("stops after the region in hand when an admin's cancel reaches it through the row", async () => {
    vi.mocked(beatComputation).mockResolvedValueOnce({ cancelRequested: true });
    await runComputation(claimed, new AbortController().signal);
    expect(vi.mocked(computeRegionGeometryCore)).not.toHaveBeenCalled();
    expect(closedWith()).toMatchObject({ status: 'cancelled', error: 'Cancelled.', progress: { status: 'Cancelled' } });
  });

  it('ends as stopped, not done, when the worker stops after the last region (#1356)', async () => {
    const stop = new AbortController();
    // The stop lands while the second step reads its parents.
    stubDatabase(() => stop.abort());
    await runComputation(claimed, stop.signal);
    expect(vi.mocked(computeRegionGeometryCore)).toHaveBeenCalledTimes(2);
    expect(mockedQuery).not.toHaveBeenCalledWith('SELECT simplify_coverage_regions($1::integer)', [7]);
    expect(closedWith()).toMatchObject({ status: 'failed' });
    expect(closedWith()?.error).toContain('stopped with the dump worker');
  });

  it('says to start it again when the worker stops under it', async () => {
    const stop = new AbortController();
    vi.mocked(computeRegionGeometryCore).mockImplementationOnce(async () => {
      stop.abort();
      return { computed: true, points: 10 };
    });
    await runComputation(claimed, stop.signal);
    // The region in hand finishes; the next one is not started.
    expect(vi.mocked(computeRegionGeometryCore)).toHaveBeenCalledTimes(1);
    expect(closedWith()).toMatchObject({ status: 'failed', error: 'The computation stopped with the dump worker. Start it again to compute what is left.' });
  });

  it('stops at once when the worker was stopped while it took the computation', async () => {
    const stop = new AbortController();
    stop.abort();
    await runComputation(claimed, stop.signal);
    expect(vi.mocked(computeRegionGeometryCore)).not.toHaveBeenCalled();
    expect(closedWith()).toMatchObject({ status: 'failed', error: 'The computation stopped with the dump worker. Start it again to compute what is left.' });
  });

  it('closes the row as failed when the run itself throws, never leaving it running', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedQuery.mockImplementation((sql: string) => (String(sql).includes('COUNT(*)')
      ? Promise.reject(new Error('connection terminated'))
      : Promise.resolve({ rows: [] })));
    await runComputation(claimed, new AbortController().signal);
    expect(closedWith()).toMatchObject({ status: 'failed', error: "The computation stopped on an error; the dump worker's log has the cause." });
  });

  it('counts a region whose pipeline failed as skipped, as the run reports it', async () => {
    vi.mocked(computeRegionGeometryCore).mockResolvedValueOnce({ computed: false, error: 'canceling statement due to statement timeout' });
    await runComputation(claimed, new AbortController().signal);
    expect(closedWith()).toMatchObject({ status: 'success', outcome: '1 computed, 9 skipped, 0 errors' });
  });
});

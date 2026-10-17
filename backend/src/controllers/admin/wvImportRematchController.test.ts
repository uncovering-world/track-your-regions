import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const clientQuery = vi.fn();
vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => query(...args), connect: async () => ({ query: clientQuery, release: () => {} }) },
}));
const runMatchingPolicy = vi.fn();
vi.mock('../../services/worldViewImport/index.js', () => ({
  MATCH_RUN_STEPS: { first: 1, names: 2, spatial: 3 },
  runMatchingPolicy: (...args: unknown[]) => runMatchingPolicy(...args),
}));

const { rematchWorldView, getRematchStatus } = await import('./wvImportRematchController.js');

describe('a re-match reports its steps (#1356)', () => {
  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset();
    runMatchingPolicy.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    query.mockResolvedValue({ rows: [{ id: 30, source_type: 'wikivoyage' }] });
    clientQuery.mockResolvedValue({ rows: [] });
  });

  it('answers its status with the step it is on, of the three', async () => {
    let release!: () => void;
    // Held in the matching step, as a run is for hours, so the status is read mid-run.
    runMatchingPolicy.mockImplementation(async (_policy: unknown, _wv: unknown, progress: { operation?: { step: (i: number, s: string) => void } }) => {
      progress.operation?.step(2, 'Matching the countries to GADM by name');
      await new Promise<void>((resolve) => { release = resolve; });
      return { cancelled: false, spatial: null };
    });

    await rematchWorldView({ params: { worldViewId: 30 }, body: {} } as never);
    await vi.waitFor(() => expect(runMatchingPolicy).toHaveBeenCalled());
    const status = await getRematchStatus({ params: { worldViewId: 30 } } as never);

    expect(status.operation?.step).toMatchObject({ index: 2, count: 3, sentence: 'Matching the countries to GADM by name' });
    release();
  });
});

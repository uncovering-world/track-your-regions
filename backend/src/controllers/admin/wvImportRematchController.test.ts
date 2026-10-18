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

const { rematchWorldView, getRematchStatus, cancelRematch } = await import('./wvImportRematchController.js');

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

describe('a running re-match can be cancelled (#1613)', () => {
  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset();
    runMatchingPolicy.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    query.mockResolvedValue({ rows: [{ id: 31, source_type: 'wikivoyage' }] });
    clientQuery.mockResolvedValue({ rows: [] });
  });

  /** A policy that runs until the run is cancelled, then answers what `answer` makes of where it stopped. */
  const untilCancelled = (answer: { cancelled: boolean; spatial: unknown }) =>
    runMatchingPolicy.mockImplementation(async (_policy: unknown, _wv: unknown, progress: { cancel?: boolean }) => {
      await vi.waitFor(() => expect(progress.cancel).toBe(true), { timeout: 2000 });
      return answer;
    });

  it('leaves the world view as the reset left it when the name matcher was running, and says so', async () => {
    untilCancelled({ cancelled: true, spatial: null });
    await rematchWorldView({ params: { worldViewId: 31 }, body: {} } as never);
    await vi.waitFor(() => expect(runMatchingPolicy).toHaveBeenCalled());

    expect(await cancelRematch({ params: { worldViewId: 31 } } as never)).toEqual({ cancelled: true });

    await vi.waitFor(async () => expect((await getRematchStatus({ params: { worldViewId: 31 } } as never)).status).toBe('cancelled'));
    const status = await getRematchStatus({ params: { worldViewId: 31 } } as never);
    expect(status.statusMessage).toContain('as the reset left it');
  });

  it('keeps what the spatial pass made, and says where it stopped', async () => {
    query.mockResolvedValue({ rows: [{ id: 32, source_type: 'wikivoyage' }] });
    untilCancelled({ cancelled: false, spatial: { considered: 3352, seeded: 40, accepted: 12, stoppedAfter: 57 } });
    await rematchWorldView({ params: { worldViewId: 32 }, body: {} } as never);
    await vi.waitFor(() => expect(runMatchingPolicy).toHaveBeenCalled());

    await cancelRematch({ params: { worldViewId: 32 } } as never);

    await vi.waitFor(async () => expect((await getRematchStatus({ params: { worldViewId: 32 } } as never)).status).toBe('complete'));
    const status = await getRematchStatus({ params: { worldViewId: 32 } } as never);
    expect(status.statusMessage).toContain('40 of 3352 leaves with a Wikidata id given suggestions, 12 auto-accepted (cancelled after 57)');
  });

  it('answers that nothing was running to stop', async () => {
    expect(await cancelRematch({ params: { worldViewId: 39 } } as never)).toEqual({ cancelled: false });
  });
});

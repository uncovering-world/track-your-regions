import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { POINT_PAUSE_MS, runSpatialPass, spatialSentence, type SpatialScorers } from './spatialPass.js';
import { createInitialProgress } from './types.js';

/**
 * The automatic spatial pass over what the name matcher left (#622): the geoshape
 * scorer first, the point scorer only where no geoshape could be had, similarity
 * scoring wherever either suggested, one leaf at a time.
 *
 * Kabardino-Balkaria (Q5775) is the leaf names cannot match; the ids are the
 * fixture's own.
 */

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const KABARDINO = 501;
const ADYGEA = 502;
const NOWHERE = 503;

function scorers(over: Partial<SpatialScorers> = {}): SpatialScorers {
  return {
    geoshape: vi.fn().mockResolvedValue({ found: 0, suggestions: [] }),
    point: vi.fn().mockResolvedValue({ found: 0, suggestions: [] }),
    similarity: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** The leftover leaves, then each leaf's status as the similarity step left it. */
function leaves(ids: number[], statuses: Record<number, string> = {}) {
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM regions r')) return { rows: ids.map(id => ({ id })) };
    return { rows: [{ match_status: statuses[params[0] as number] ?? 'needs_review' }] };
  });
}

// A block body: a hook that returns the mock would have it called as the hook's cleanup.
beforeEach(() => { query.mockReset(); });

describe('runSpatialPass', () => {
  it('seeds a leaf from its geoshape and counts it accepted when similarity auto-accepted it', async () => {
    // Unmatched when the pass reaches it, auto-matched once similarity has scored it.
    const statuses: Record<number, string> = { [KABARDINO]: 'no_candidates' };
    leaves([KABARDINO], statuses);
    const s = scorers({
      geoshape: vi.fn().mockResolvedValue({ found: 1, suggestions: [] }),
      similarity: vi.fn().mockImplementation(async () => { statuses[KABARDINO] = 'auto_matched'; }),
    });

    const summary = await runSpatialPass(7, createInitialProgress(), s);

    expect(s.similarity).toHaveBeenCalledWith(KABARDINO);
    expect(s.point).not.toHaveBeenCalled();
    expect(summary).toEqual({ considered: 1, seeded: 1, accepted: 1, stoppedAfter: null });
  });

  it('falls back to the point scorer only where no geoshape could be had, and pauses after it', async () => {
    leaves([ADYGEA, NOWHERE]);
    const s = scorers({
      geoshape: vi.fn()
        .mockResolvedValueOnce({ found: 0, suggestions: [], geoshapeUnavailable: true })
        .mockResolvedValueOnce({ found: 0, suggestions: [] }),
      point: vi.fn().mockResolvedValue({ found: 2, suggestions: [] }),
    });

    const summary = await runSpatialPass(7, createInitialProgress(), s);

    expect(s.point).toHaveBeenCalledTimes(1);
    expect(s.point).toHaveBeenCalledWith(7, ADYGEA);
    expect(s.pause).toHaveBeenNthCalledWith(1, expect.any(Number));
    expect((s.pause as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeGreaterThanOrEqual(POINT_PAUSE_MS);
    expect(summary).toEqual({ considered: 2, seeded: 1, accepted: 0, stoppedAfter: null });
  });

  it('waits after each leaf as long as it took, and at least a second after a point fallback', async () => {
    leaves([KABARDINO, ADYGEA]);
    const s = scorers({
      geoshape: vi.fn()
        .mockResolvedValueOnce({ found: 0, suggestions: [] })
        .mockResolvedValueOnce({ found: 0, suggestions: [], geoshapeUnavailable: true }),
    });

    await runSpatialPass(7, createInitialProgress(), s);

    const pauses = (s.pause as ReturnType<typeof vi.fn>).mock.calls.map(([ms]) => ms as number);
    expect(pauses).toHaveLength(2);
    // A shape off the cache took almost nothing, so its pause is almost nothing.
    expect(pauses[0]).toBeLessThan(POINT_PAUSE_MS);
    expect(pauses[1]).toBeGreaterThanOrEqual(POINT_PAUSE_MS);
  });

  it('reports through the match counters and stops on cancel', async () => {
    leaves([KABARDINO, ADYGEA, NOWHERE]);
    const progress = createInitialProgress();
    const s = scorers({
      geoshape: vi.fn().mockImplementation(async () => {
        progress.cancel = true;
        return { found: 0, suggestions: [] };
      }),
    });

    const summary = await runSpatialPass(7, progress, s);

    expect(progress.matchTotal).toBe(3);
    expect(progress.matchDone).toBe(1);
    expect(s.geoshape).toHaveBeenCalledTimes(1);
    expect(summary.stoppedAfter).toBe(1);
  });

  it("leaves a failing leaf as the name matcher left it and goes on", async () => {
    leaves([KABARDINO, ADYGEA]);
    const s = scorers({
      geoshape: vi.fn()
        .mockRejectedValueOnce(new Error('shape will not fetch'))
        .mockResolvedValueOnce({ found: 1, suggestions: [] }),
    });

    const summary = await runSpatialPass(7, createInitialProgress(), s);

    expect(summary).toEqual({ considered: 2, seeded: 1, accepted: 0, stoppedAfter: null });
  });
});

describe('a leaf matched by hand while the pass ran', () => {
  it('is not scored when the pass reaches it', async () => {
    leaves([KABARDINO, ADYGEA], { [KABARDINO]: 'manual_matched' });
    const s = scorers();

    const summary = await runSpatialPass(7, createInitialProgress(), s);

    expect(s.geoshape).toHaveBeenCalledTimes(1);
    expect(s.geoshape).toHaveBeenCalledWith(7, ADYGEA);
    expect(summary.considered).toBe(2);
  });
});

describe('spatialSentence', () => {
  it('says what the pass did, and nothing when it had nothing to do', () => {
    expect(spatialSentence({ considered: 1302, seeded: 640, accepted: 210, stoppedAfter: null }))
      .toBe(' Spatial pass: 640 of 1302 leaves with a Wikidata id given suggestions, 210 auto-accepted.');
    expect(spatialSentence({ considered: 0, seeded: 0, accepted: 0, stoppedAfter: null })).toBe('');
    expect(spatialSentence({ considered: 1302, seeded: 12, accepted: 3, stoppedAfter: 40 }))
      .toBe(' Spatial pass: 12 of 1302 leaves with a Wikidata id given suggestions, 3 auto-accepted (cancelled after 40).');
  });
});

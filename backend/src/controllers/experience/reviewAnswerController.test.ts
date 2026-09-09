/**
 * Tests for answering many review rows at once (#852).
 *
 * Two rules carry the route. **Every arm calls the writer the single-row
 * card calls** — the dispatch is a table, and what each answer does for each
 * kind is what the table says. **Each object is its own act**: a row that
 * refuses, throws or falls out of scope is one line in the report, and the
 * rest of the batch is answered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('./experienceScope.js', () => ({ resolveExperienceScope: vi.fn() }));
vi.mock('./publishController.js', () => ({ publishUnderLock: vi.fn() }));
vi.mock('./curatorRefusalController.js', () => ({
  refuseArrivalUnderLock: vi.fn(), refuseContentsUnderLock: vi.fn(),
}));
vi.mock('./declineHeldController.js', () => ({ refuseUnderLock: vi.fn() }));
vi.mock('./acceptSourceController.js', () => ({ acceptSourceUnderLock: vi.fn() }));
vi.mock('./declineSourceController.js', () => ({ declineSourceUnderLock: vi.fn() }));
vi.mock('./lifecycleController.js', () => ({
  answerAdmissionUnderLock: vi.fn(), answerStateUnderLock: vi.fn(),
}));
vi.mock('./locationStateController.js', () => ({ answerLocationStateUnderLock: vi.fn() }));

import { pool } from '../../db/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishUnderLock } from './publishController.js';
import { refuseArrivalUnderLock, refuseContentsUnderLock } from './curatorRefusalController.js';
import { refuseUnderLock } from './declineHeldController.js';
import { acceptSourceUnderLock } from './acceptSourceController.js';
import { declineSourceUnderLock } from './declineSourceController.js';
import { answerAdmissionUnderLock, answerStateUnderLock } from './lifecycleController.js';
import { answerLocationStateUnderLock } from './locationStateController.js';
import { answerReviewRows } from './reviewAnswerController.js';
import { missingOpenSql, refusedOpenSql, withdrawnPointOpenSql } from './reviewQueuePredicates.js';
import { arrivalWaitingSql, contentsWaitingSql, heldWaitingSql } from './waitingCounts.js';

type Mock = ReturnType<typeof vi.fn>;
const mockedQuery = pool.query as unknown as Mock;
const mockedScope = resolveExperienceScope as unknown as Mock;
const mockedPublish = publishUnderLock as unknown as Mock;
const mockedRefuseArrival = refuseArrivalUnderLock as unknown as Mock;
const mockedRefuseContents = refuseContentsUnderLock as unknown as Mock;
const mockedRefuseHeld = refuseUnderLock as unknown as Mock;
const mockedAcceptSource = acceptSourceUnderLock as unknown as Mock;
const mockedDeclineSource = declineSourceUnderLock as unknown as Mock;
const mockedAdmission = answerAdmissionUnderLock as unknown as Mock;
const mockedState = answerStateUnderLock as unknown as Mock;
const mockedLocationState = answerLocationStateUnderLock as unknown as Mock;

const CURATOR = { id: 7, role: 'curator' as const };

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function req(rows: Array<{ kind: string; id: number; runId?: number | null }>, answer: string) {
  return { user: CURATOR, body: { rows, answer } } as never;
}

const PUBLISHED = {
  result: {
    appliedFields: [], appliedParts: [], locationsPublished: 2, treasureLinksPublished: 3,
    treasuresPublished: 1, withdrawalsReleased: 0,
  },
};

/**
 * The pool answers the batch's own reads by their shape: the name lookup, a
 * waiting row's sub-kinds, an open refusal, an open missing row, the open
 * withdrawn points. Everything under a lock is a mocked writer.
 */
function poolAnswers({
  names = [{ id: 5, name: 'Chartres Cathedral', category_id: 4 }],
  subs = { arrival: true, held: false, contents: false },
  refusedOpen = true,
  missing = { source_membership: 'present', existence: 'extant', missing_since: new Date('2026-09-01T00:00:00Z') },
  points = [] as Array<Record<string, unknown>>,
} = {}) {
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM experiences WHERE id = ANY')) return { rows: names };
    if (sql.includes(arrivalWaitingSql())) return { rows: [subs] };
    if (sql.includes(refusedOpenSql('m'))) return { rows: refusedOpen ? [{ '?column?': 1 }] : [] };
    if (sql.includes(missingOpenSql('e'))) return { rows: missing ? [missing] : [] };
    if (sql.includes(withdrawnPointOpenSql('el'))) return { rows: points };
    throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedScope.mockResolvedValue({ permitted: true, logRegionId: 12 });
  mockedPublish.mockResolvedValue(PUBLISHED);
  mockedRefuseArrival.mockResolvedValue({ result: { experienceId: 5, admission: 'refused' } });
  mockedRefuseContents.mockResolvedValue({ result: { locationsRefused: 4, treasureLinksRefused: 0 } });
  mockedRefuseHeld.mockResolvedValue({ result: { declinedFields: ['name', 'year'], declinedParts: [{ fields: ['artists'] }] } });
  mockedAcceptSource.mockResolvedValue({ result: { applied: ['name'], released: ['location'] } });
  mockedDeclineSource.mockResolvedValue({ result: { declined: ['name'] } });
  mockedAdmission.mockResolvedValue({
    result: { published: true, locationsPublished: 1, treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0 },
  });
  mockedState.mockResolvedValue({ result: { experienceId: 5 } });
  mockedLocationState.mockResolvedValue({ result: { locationId: 1 } });
  poolAnswers();
});

describe('the dispatch table', () => {
  it('accepts an arrival by publishing the whole object', async () => {
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5, runId: 105 }], 'accept'), res as never);

    expect(mockedPublish).toHaveBeenCalledWith(5, 7, 12, {});
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      answer: 'accept',
      answered: [expect.objectContaining({
        kind: 'waiting', id: 5, name: 'Chartres Cathedral',
        did: expect.objectContaining({ published: 1, locations: 2, treasureLinks: 3 }),
      })],
      refused: [], outOfScope: 0, placementFailed: [],
    }));
  });

  it('accepts a held object against the run the curator saw', async () => {
    poolAnswers({ subs: { arrival: false, held: true, contents: true } });
    await answerReviewRows(req([{ kind: 'waiting', id: 5, runId: 105 }], 'accept'), makeRes() as never);
    expect(mockedPublish).toHaveBeenCalledWith(5, 7, 12, { expectedSyncLogId: 105 });
  });

  it('accepts unread contents alone with a contents publish', async () => {
    poolAnswers({ subs: { arrival: false, held: false, contents: true } });
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), makeRes() as never);
    expect(mockedPublish).toHaveBeenCalledWith(5, 7, 12, { contentsOnly: true });
  });

  it('refuses a held row that names no run rather than guessing one', async () => {
    poolAnswers({ subs: { arrival: false, held: true, contents: false } });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5, runId: null }], 'accept'), res as never);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].refused[0].error).toContain('reload');
  });

  it("rejects an arrival with a curator's refusal", async () => {
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'reject'), makeRes() as never);
    expect(mockedRefuseArrival).toHaveBeenCalledWith(5, 7, 12, {});
    expect(mockedRefuseContents).not.toHaveBeenCalled();
  });

  it('rejects a held object with contents by refusing the whole card, then the contents', async () => {
    poolAnswers({ subs: { arrival: false, held: true, contents: true } });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5, runId: 105 }], 'reject'), res as never);

    expect(mockedRefuseHeld).toHaveBeenCalledWith(5, 7, 12, null, 105);
    expect(mockedRefuseContents).toHaveBeenCalledWith(5, 7, 12, {});
    // Two object fields and the one part's field, counted together; the
    // withdrawal count comes from the contents refusal, the one answer that
    // records it.
    expect(res.json.mock.calls[0][0].answered[0].did).toEqual({
      fields: 3, locations: 4, treasureLinks: 0, withdrawalsReleased: 0,
    });
  });

  it('reads the sub-kinds from the membership and refuses a row waiting on nothing', async () => {
    poolAnswers({ subs: { arrival: false, held: false, contents: false } });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), res as never);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].refused[0].error).toContain('not waiting');
  });

  it.each([
    ['accept', mockedAcceptSource],
    ['reject', mockedDeclineSource],
  ])('%ss every open field of a conflict against the run the curator saw', async (answer, writer) => {
    await answerReviewRows(req([{ kind: 'conflict', id: 5, runId: 98 }], answer), makeRes() as never);
    expect(writer).toHaveBeenCalledWith(5, 7, 12, 'all', 98);
  });

  it.each([
    ['accept', 'override'],
    ['reject', 'confirm'],
  ])('%ss a refusal as the admission card would (%s)', async (answer, decision) => {
    await answerReviewRows(req([{ kind: 'refused', id: 5 }], answer), makeRes() as never);
    expect(mockedAdmission).toHaveBeenCalledWith(5, 7, 12, { decision });
  });

  it('refuses an admission answer on a row that is not an open refusal', async () => {
    poolAnswers({ refusedOpen: false });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'refused', id: 5 }], 'reject'), res as never);
    expect(mockedAdmission).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].refused).toHaveLength(1);
  });

  it.each([
    ['accept', { membership: 'former' }],
    ['reject', { membership: 'present' }],
    ['lost', { existence: 'lost' }],
  ])('answers a missing row with the verdict "%s" names and the row as the queue showed it', async (answer, verdict) => {
    await answerReviewRows(req([{ kind: 'missing', id: 5 }], answer), makeRes() as never);
    expect(mockedState).toHaveBeenCalledWith(5, 7, 12, {
      ...verdict, expected: { membership: 'present', existence: 'extant', flagged: true },
    });
  });

  it('answers every open point of a withdrawn row, each through the point writer', async () => {
    const point = { source_membership: 'present', existence: 'extant', missing_since: new Date() };
    poolAnswers({ points: [{ id: 31, ...point }, { id: 32, ...point }, { id: 33, ...point }] });
    const failed = { placementFailed: true, placementFailedWorldViews: [{ id: 5, name: 'Administrative' }] };
    mockedLocationState
      .mockResolvedValueOnce({ result: { locationId: 31, ...failed } })
      .mockResolvedValueOnce({ refusal: { status: 409, error: 'Someone else answered this first' } })
      .mockResolvedValueOnce({ result: { locationId: 33, ...failed } });
    const res = makeRes();

    await answerReviewRows(req([{ kind: 'withdrawn', id: 5 }], 'lost'), res as never);

    expect(mockedLocationState).toHaveBeenCalledTimes(3);
    expect(mockedLocationState).toHaveBeenCalledWith(31, 5, 7, 12, {
      existence: 'lost', expected: { membership: 'present', existence: 'extant', flagged: true },
    });
    const result = res.json.mock.calls[0][0];
    expect(result.answered[0].did).toEqual({ points: 2, pointsRefused: 1 });
    // One world view failed twice, named once: the sentence is for an admin.
    expect(result.placementFailed).toEqual([{ id: 5, name: 'Chartres Cathedral', worldViews: [{ id: 5, name: 'Administrative' }] }]);
  });

  it('reports a withdrawn row whose every point refused as refused', async () => {
    const point = { id: 31, source_membership: 'present', existence: 'extant', missing_since: new Date() };
    poolAnswers({ points: [point] });
    mockedLocationState.mockResolvedValue({ refusal: { status: 409, error: 'Someone else answered this first' } });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'withdrawn', id: 5 }], 'accept'), res as never);
    expect(res.json.mock.calls[0][0].refused[0].error).toContain('Someone else');
  });

  it('offers Lost to the two kinds that have it and to no other', async () => {
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }, { kind: 'refused', id: 5 }, { kind: 'conflict', id: 5, runId: 9 }], 'lost'), res as never);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(mockedAdmission).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].refused).toHaveLength(3);
  });

  it('reads the three sub-kinds with the waiting fragments the count reads', async () => {
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), makeRes() as never);
    const read = mockedQuery.mock.calls.map(c => c[0] as string).find(s => s.includes(arrivalWaitingSql()));
    expect(read).toContain(heldWaitingSql());
    expect(read).toContain(contentsWaitingSql());
  });
});

describe('each object is its own act', () => {
  it('answers the rest when one throws, and names the one that did', async () => {
    poolAnswers({ names: [
      { id: 5, name: 'Chartres Cathedral', category_id: 4 },
      { id: 6, name: 'Reims Cathedral', category_id: 4 },
    ] });
    mockedPublish
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(PUBLISHED);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = makeRes();

    await answerReviewRows(req([{ kind: 'waiting', id: 5 }, { kind: 'waiting', id: 6 }], 'accept'), res as never);

    const result = res.json.mock.calls[0][0];
    expect(result.refused).toEqual([expect.objectContaining({ id: 5, name: 'Chartres Cathedral' })]);
    expect(result.answered).toEqual([expect.objectContaining({ id: 6 })]);
    expect(errors).toHaveBeenCalledWith('[review-answer] %s %d failed:', 'waiting', 5, expect.any(Error));
    errors.mockRestore();
  });

  it('counts an object outside the scope and does not touch it', async () => {
    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), res as never);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].outOfScope).toBe(1);
  });

  it('lands a scope read that throws in the report, not in a 500', async () => {
    mockedScope.mockRejectedValueOnce(new Error('scope down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), res as never);
    expect(res.json.mock.calls[0][0].refused).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('refuses a row whose object is gone by name and answers a row named twice once', async () => {
    const res = makeRes();
    await answerReviewRows(
      req([{ kind: 'waiting', id: 5 }, { kind: 'waiting', id: 5 }, { kind: 'waiting', id: 404 }], 'accept'),
      res as never);
    expect(mockedPublish).toHaveBeenCalledTimes(1);
    const result = res.json.mock.calls[0][0];
    expect(result.answered).toHaveLength(1);
    expect(result.refused).toEqual([{ kind: 'waiting', id: 404, name: '#404', error: 'Experience not found' }]);
  });

  it("carries a writer's refusal into the report with its words", async () => {
    mockedPublish.mockResolvedValueOnce({ refusal: { status: 409, error: 'This row was turned down by its category' } });
    const res = makeRes();
    await answerReviewRows(req([{ kind: 'waiting', id: 5 }], 'accept'), res as never);
    expect(res.json.mock.calls[0][0].refused[0].error).toBe('This row was turned down by its category');
  });
});

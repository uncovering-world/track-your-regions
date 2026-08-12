/**
 * Tests for releasing what a whole source is holding.
 *
 * Two rules carry this endpoint and neither is visible from its name. **A held
 * proposal is not published here** — it is a change to a row a reader is looking
 * at, so it stays for the card that can show `old → new`. And **each object is
 * its own act**: its own lock, its own audit row, its own outcome, so one object
 * refusing mid-batch neither abandons the rest nor disappears silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('./experienceScope.js', () => ({
  resolveExperienceScope: vi.fn(),
}));

vi.mock('./publishController.js', () => ({
  publishUnderLock: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishUnderLock } from './publishController.js';
import { publishWaiting } from './publishWaitingController.js';
import { arrivalWaitingSql, contentsWaitingSql, heldWaitingSql } from './waitingCounts.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishUnderLock as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const REQ = { params: { categoryId: '2' }, user: { id: 7, role: 'curator' as const } } as never;

/** The two statements the handler runs before publishing anything. */
function mockSelection(rows: Array<{ id: number; name: string; kind: string }>, held = 0) {
  // Selection first, held count last — the handler's order, and the second half of
  // what one of these tests is about.
  mockedQuery
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [{ n: held }] });
}

describe('publishWaiting', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedScope.mockReset();
    mockedPublish.mockReset();
    mockedScope.mockResolvedValue({ permitted: true, logRegionId: null });
    mockedPublish.mockResolvedValue({ result: { locationsPublished: 1, treasuresPublished: 0 } });
  });

  it('never selects a held proposal for publishing, only counts it', async () => {
    mockSelection([], 3);

    await publishWaiting(REQ, makeRes() as never);

    const [selectSql] = mockedQuery.mock.calls[0] as [string];
    const [countSql] = mockedQuery.mock.calls[1] as [string];
    // Asserted positively, as the exact disjunction, rather than as the absence of
    // the held predicate: an absence passes for any reason at all — including the
    // predicate being renamed — while this fails the moment a third kind joins the
    // selection, because the closing parenthesis moves.
    expect(selectSql).toContain(`(${arrivalWaitingSql()} OR ${contentsWaitingSql()})`);
    // And the kind that must not be published appears only in the statement that
    // counts it.
    expect(countSql).toContain(heldWaitingSql());
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('publishes an arrival as an object and a visible row as contents only', async () => {
    mockSelection([
      { id: 6206, name: 'Museo Nacional del Prado', kind: 'arrival' },
      { id: 6215, name: 'Rijksmuseum', kind: 'contents' },
    ]);

    await publishWaiting(REQ, makeRes() as never);

    expect(mockedPublish).toHaveBeenCalledTimes(2);
    // An empty body is an object publish — it marks the row read and releases
    // everything under it, which is what an arrival needs.
    expect(mockedPublish.mock.calls[0][3]).toEqual({});
    // A visible row must keep its own state and any proposal it holds, so it is
    // published `contentsOnly` — an empty body here would mark it read again and,
    // worse, apply held fields nobody looked at.
    expect(mockedPublish.mock.calls[1][3]).toEqual({ contentsOnly: true });
  });

  it('counts what the caller does not cover instead of quietly publishing less', async () => {
    mockSelection([
      { id: 1, name: 'in scope', kind: 'arrival' },
      { id: 2, name: 'out of scope', kind: 'arrival' },
    ]);
    mockedScope
      .mockResolvedValueOnce({ permitted: true, logRegionId: 5 })
      .mockResolvedValueOnce({ permitted: false, logRegionId: null });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    expect(mockedPublish).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.outOfScope).toBe(1);
    expect(payload.published).toHaveLength(1);
    // Scope is resolved per object, not per category: a region-scoped curator
    // covers some of a source's rows and not others.
    expect(mockedScope).toHaveBeenCalledTimes(2);
  });

  it('reports an object that refused and carries on with the rest', async () => {
    mockSelection([
      { id: 1, name: 'first', kind: 'arrival' },
      { id: 2, name: 'raced', kind: 'arrival' },
      { id: 3, name: 'third', kind: 'arrival' },
    ]);
    mockedPublish
      .mockResolvedValueOnce({ result: { locationsPublished: 2, treasuresPublished: 0 } })
      .mockResolvedValueOnce({ refusal: { status: 409, error: 'This row is holding a proposal from a different run — reload to see it' } })
      .mockResolvedValueOnce({ result: { locationsPublished: 0, treasuresPublished: 4 } });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    const payload = res.json.mock.calls[0][0];
    expect(payload.published.map((p: { id: number }) => p.id)).toEqual([1, 3]);
    expect(payload.refused).toEqual([
      { id: 2, name: 'raced', error: 'This row is holding a proposal from a different run — reload to see it' },
    ]);
    // A 200 with the refusal named, not a 500: the batch did what it could, and
    // the curator needs to know which object to open.
    expect(res.status).not.toHaveBeenCalled();
  });

  it('treats a throw like a refusal, because the objects before it are already committed', async () => {
    mockSelection([
      { id: 1, name: 'first', kind: 'arrival' },
      { id: 2, name: 'exploded', kind: 'arrival' },
      { id: 3, name: 'third', kind: 'arrival' },
    ]);
    mockedPublish
      .mockResolvedValueOnce({ result: { locationsPublished: 1, treasuresPublished: 0 } })
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce({ result: { locationsPublished: 1, treasuresPublished: 0 } });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    // `publishUnderLock` rolls back and rethrows anything that is not a refusal.
    // Letting that reject the handler answers 500 to a caller whose first object
    // is already visible to readers — and the page then says nothing was
    // published, which is false for it.
    const payload = res.json.mock.calls[0][0];
    expect(payload.published.map((p: { id: number }) => p.id)).toEqual([1, 3]);
    expect(payload.refused).toEqual([
      { id: 2, name: 'exploded', error: 'Publishing this object failed — open it to see where it stands' },
    ]);
    // The database's own message stays in the server log: a curator can do nothing
    // with "deadlock detected", and the actionable half is which object to open.
    expect(JSON.stringify(payload)).not.toContain('deadlock');
  });

  it('treats a scope lookup that throws like any other failure of that object', async () => {
    mockSelection([
      { id: 1, name: 'first', kind: 'arrival' },
      { id: 2, name: 'scope blew up', kind: 'arrival' },
      { id: 3, name: 'third', kind: 'arrival' },
    ]);
    mockedScope
      .mockResolvedValueOnce({ permitted: true, logRegionId: null })
      .mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
      .mockResolvedValueOnce({ permitted: true, logRegionId: null });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    // `resolveExperienceScope` is a `pool.query` like any other — a recursive CTE run
    // once per row — so a timeout or a reset connection on object 400 is as likely
    // there as inside the publish. Outside the try it rejected the handler and threw
    // away the report of everything already committed.
    const payload = res.json.mock.calls[0][0];
    expect(payload.published.map((p: { id: number }) => p.id)).toEqual([1, 3]);
    expect(payload.refused).toHaveLength(1);
    expect(payload.refused[0].id).toBe(2);
  });

  it('carries a placement failure through, since the curator is the only one who can report it', async () => {
    mockSelection([{ id: 6206, name: 'Museo Nacional del Prado', kind: 'contents' }]);
    mockedPublish.mockResolvedValue({
      result: {
        locationsPublished: 1,
        treasureLinksPublished: 0,
        treasuresPublished: 0,
        placementFailed: true,
        placementFailedWorldViews: [{ id: 4, name: 'Continents' }],
      },
    });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    // Rebuilding a world view is an admin's job, so the curator's one useful act
    // is naming the object and the world views to an admin. Dropped here, a
    // publication that landed with stale regions reads as an unqualified success.
    expect(res.json.mock.calls[0][0].published[0]).toEqual({
      id: 6206,
      name: 'Museo Nacional del Prado',
      locationsPublished: 1,
      treasureLinksPublished: 0,
      treasuresPublished: 0,
      withdrawalsReleased: 0,
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Continents' }],
    });
  });

  it('counts only the held changes the caller could be asked about', async () => {
    mockSelection([], 0);

    await publishWaiting(REQ, makeRes() as never);

    const [countSql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    // Every other number in this response is measured against the caller, and
    // category-wide here would invert the argument `outOfScope` exists for: two
    // regions of a forty-held category would be reported as forty still waiting
    // while the queue offers three.
    expect(countSql).toContain('curator_scoped_regions');
    expect(countSql).toContain('er.experience_id = e.id');
    expect(params).toEqual([7, 2]);
  });

  it('asks the whole source when the caller is an admin', async () => {
    mockSelection([], 0);

    await publishWaiting(
      { params: { categoryId: '2' }, user: { id: 1, role: 'admin' as const } } as never,
      makeRes() as never,
    );

    const [countSql] = mockedQuery.mock.calls[1] as [string];
    // An admin's scope is every category, so the predicate collapses. Asserted
    // against what actually differs between the two paths — the row-level check
    // over `experience_regions` — and not against the name of the function that
    // emits the fragment, which appears in no SQL on either path and so could not
    // have failed. The scoped-regions CTE itself is prefixed either way, matching
    // the queue: it costs one unused CTE for an admin and keeps the two statements
    // the same shape.
    expect(countSql).toContain('AND TRUE');
    expect(countSql).not.toContain('er.experience_id = e.id');
  });

  it('counts the held ones after publishing, not before', async () => {
    // Recorded across *both* mocks, because "last `pool.query` call" proves nothing
    // here: `publishUnderLock` is mocked, so it issues no queries, and the count was
    // the last query before this fix too. The order that matters is the count
    // against the publishing.
    const order: string[] = [];
    mockedQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('pending_change_sync_log_id IS NOT NULL')) {
        order.push('count-held');
        return { rows: [{ n: 2 }] };
      }
      order.push('select-waiting');
      return { rows: [{ id: 1, name: 'one', kind: 'arrival' }] };
    });
    mockedPublish.mockImplementation(async () => {
      order.push('publish');
      return { result: { locationsPublished: 1, treasuresPublished: 0 } };
    });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    // A run can land a held proposal while this is publishing, and the number's
    // job is to explain the remainder the curator sees in the panel a second later.
    expect(order).toEqual(['select-waiting', 'publish', 'count-held']);
    expect(res.json.mock.calls[0][0].heldLeftForReview).toBe(2);
  });

  it('names what it released per object, so the log and the notice agree', async () => {
    mockSelection([{ id: 6206, name: 'Museo Nacional del Prado', kind: 'contents' }], 2);
    mockedPublish.mockResolvedValue({
      result: { locationsPublished: 3, treasureLinksPublished: 12, treasuresPublished: 12 },
    });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    expect(res.json).toHaveBeenCalledWith({
      categoryId: 2,
      published: [{
        id: 6206,
        name: 'Museo Nacional del Prado',
        locationsPublished: 3,
        treasureLinksPublished: 12,
        treasuresPublished: 12,
        withdrawalsReleased: 0,
      }],
      refused: [],
      outOfScope: 0,
      heldLeftForReview: 2,
    });
  });

  it('carries the pins a release took off the map, per object', async () => {
    mockSelection([{ id: 6206, name: 'Museo Nacional del Prado', kind: 'contents' }], 0);
    // Reachable from a batch rather than only from a card: publishing a visible row's
    // unread points releases every withdrawal deferred behind them, so a pin a reader
    // could see yesterday is gone — and "1 object published." would be the only thing
    // said about it. The audit log keeps it per object, which is the forty-clicks
    // answer this endpoint exists to avoid.
    mockedPublish.mockResolvedValue({
      result: { locationsPublished: 3, treasuresPublished: 0, withdrawalsReleased: 2 },
    });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    expect(res.json.mock.calls[0][0].published[0].withdrawalsReleased).toBe(2);
  });

  it('reports a work released as a link only, which the work count alone reads as zero', async () => {
    mockSelection([{ id: 6206, name: 'Museo Nacional del Prado', kind: 'contents' }], 0);
    // The case `contentsWaitingSql` asks both axes for: a work reviewed in one venue and
    // unread in another publishes as a link without its row moving, so a report carrying
    // only `treasuresPublished` says no work was released by a publication that released
    // one. The single-object notice reads the pair as `Math.max` for the same reason.
    mockedPublish.mockResolvedValue({
      result: { locationsPublished: 0, treasureLinksPublished: 1, treasuresPublished: 0 },
    });
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    const entry = res.json.mock.calls[0][0].published[0];
    expect(entry.treasureLinksPublished).toBe(1);
    expect(entry.treasuresPublished).toBe(0);
  });

  it('sends the report when the closing count fails, with the count as null', async () => {
    // The count is the last statement, so a throw from it used to reach
    // `express-async-errors` and answer 500 — discarding a report about publications
    // that are already committed, including the world-view names that reach a person
    // through this response and nowhere else. `null` says "not counted"; a `0` here
    // would be a claim about the source that nothing checked.
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 6206, name: 'Museo Nacional del Prado', kind: 'arrival' }] })
      .mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));
    mockedPublish.mockResolvedValue({
      result: {
        locationsPublished: 1,
        treasureLinksPublished: 0,
        treasuresPublished: 0,
        placementFailed: true,
        placementFailedWorldViews: [{ id: 4, name: 'Wikivoyage' }],
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();

    await publishWaiting(REQ, res as never);

    const body = res.json.mock.calls[0][0];
    expect(body.heldLeftForReview).toBeNull();
    expect(body.published).toHaveLength(1);
    expect(body.published[0].placementFailedWorldViews).toEqual([{ id: 4, name: 'Wikivoyage' }]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

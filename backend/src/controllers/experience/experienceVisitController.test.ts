/**
 * `markVisited` is the write path Major 1 closes: before this, any
 * authenticated caller could POST a guessed id for a `pending` experience,
 * get its name echoed back, and keep a visit to it for ever, since nothing
 * else here ever clears the row the POST just wrote.
 *
 * The same sentence held for a *refused* row one round longer than it should
 * have: the first fix carried `curation_state` alone while its four siblings
 * carried the refusal predicate too. Hence the predicate is now asserted as the
 * composed whole — `experienceOfferedToReaderSql` — rather than by naming the
 * fragments, which is what let half of it pass review.
 *
 * Asserted on the SQL each handler sends, the way its siblings are: the
 * behaviour behind it was checked against a live database, and a mocked
 * query cannot tell a correct predicate from a wrong one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { claimablePlaceSql, experienceOfferedToReaderSql } from '../../db/readerPredicates.js';
import { placeHasKindSql } from '../../db/membership.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { userRoutes } from '../../routes/userRoutes.js';

/** The user routes these specs answer through (ADR-0071). */
const postVisitedExperience = routeAt(userRoutes, '/me/visited-experiences/:experienceId', 'post');
const deleteVisitedExperience = routeAt(userRoutes, '/me/visited-experiences/:experienceId', 'delete');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('markVisited — #520', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('gates the existence check on the whole claim-writer predicate, not half of it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(postVisitedExperience,
      { params: { experienceId: '281' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // The composed predicate rather than its two fragments: this handler shipped
    // once carrying `curation_state` alone, and an assertion naming only the
    // fragment it did carry passed the whole time.
    // Both halves asked of one membership (#822) is the composed fragment's own
    // shape, pinned where it is spelled (`membership.test.ts`) — not re-derived
    // here from two substrings that two separate EXISTS, one membership
    // admitted and another visible, would satisfy just as well.
    expect(sql).toContain(experienceOfferedToReaderSql());
  });

  it('404s a row that fails either half, and writes nothing', async () => {
    // The existence check finds nothing — the shape a pending row and a refused
    // row both produce. Which half rejected it is not observable here and does
    // not need to be: what matters is that no second query runs.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(postVisitedExperience,
      { params: { experienceId: '281' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    // One query, not two: the existence check has to run and fail before the
    // INSERT, or a write-then-check order would create the exact
    // manufactured visit this gate exists to prevent.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('writes the visit once the row passes the gate', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{
        id: 281, name: 'Published Site',
        ticked: { experienceId: 281, name: 'Published Site', longitude: 12.4768, latitude: 41.8986 },
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, marked_at: new Date('2026-01-01T00:00:00.000Z'), notes: null, rating: null, inserted: true }] });
    const res = makeRes();

    await answerRoute(postVisitedExperience,
      { params: { experienceId: '281' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    // One row, on the place itself: a whole it is a part of reads it (#2120),
    // read in the insert under a share lock, as every visit write reads its place.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const insert = String(mockedQuery.mock.calls[1][0]);
    expect(insert).toContain('INSERT INTO user_visited_experiences');
    expect(insert).toMatch(/e\.merged_into_id IS NULL[\s\S]*FOR SHARE OF e/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, experienceId: 281, experienceName: 'Published Site',
    }));
  });
});

describe('unmarkVisited', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('takes back the place\'s own visit, reading the place under a share lock and only while a reader may be shown it', async () => {
    const release = vi.fn();
    mockedConnect.mockResolvedValueOnce({ query: mockedQuery, release });
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })  // the visit, locked
      .mockResolvedValueOnce({
        rows: [{ taken_visits: 1, taken_trips: 0, experience_id: 281, marked_at: null, notes: null, rating: null, trips: [] }],
      })
      .mockResolvedValueOnce({ rows: [] });          // COMMIT

    await answerRoute(deleteVisitedExperience,
      { params: { experienceId: '281' }, user: { id: 5 } } as never, makeRes() as never);

    const calls = mockedQuery.mock.calls as [string, unknown[]?][];
    expect(calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.any(String), expect.any(String), 'COMMIT']);
    // The place and the visit locked by a statement of their own; the delete,
    // held to what an Undo puts back, is the next statement, so its snapshot
    // sees every trip committed on the visit while the lock waited (#2120).
    const [lock, params] = calls[1];
    const [remove, ids] = calls[2];
    expect(lock).toMatch(/FOR SHARE OF e[\s\S]*FOR UPDATE OF v/);
    expect(lock).not.toMatch(/DELETE FROM/);
    expect(lock).toContain(claimablePlaceSql());
    expect(params).toEqual([5, 281]);
    expect(remove).toMatch(/DELETE FROM user_visited_experiences/);
    expect(ids).toEqual([[3]]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('the visited ids of one kind', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('finds a visited place by any of its memberships, not only the one its first source brought', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ place_id: 6214, ticked: true, total: 1, visited: 1 }] });

    await answerRoute(routeAt(userRoutes, '/me/visited-experiences/ids'),
      { query: { kindId: '5' }, user: { id: 5 } } as never,
      makeRes() as never,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // ADR-0084: the Capitoline Museums, brought by Art Museums, are visited in
    // Archaeology too.
    expect(sql).toContain(placeHasKindSql('e', '$2'));
    expect(sql).not.toMatch(/\bm\.kind_id = \$2/);
    expect(params).toEqual([5, 5]);
  });
});

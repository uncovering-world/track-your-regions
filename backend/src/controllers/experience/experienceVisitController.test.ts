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
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { experienceOfferedToReaderSql } from '../../db/readerPredicates.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { userRoutes } from '../../routes/userRoutes.js';

/** The user routes these specs answer through (ADR-0071). */
const postVisitedExperience = routeAt(userRoutes, '/me/visited-experiences/:experienceId', 'post');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

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
      .mockResolvedValueOnce({ rows: [{ id: 281, name: 'Published Site' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, visited_at: new Date('2026-01-01T00:00:00.000Z'), notes: null, rating: null }] });
    const res = makeRes();

    await answerRoute(postVisitedExperience,
      { params: { experienceId: '281' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const insert = String(mockedQuery.mock.calls[1][0]);
    expect(insert).toContain('INSERT INTO user_visited_experiences');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, experienceId: 281, experienceName: 'Published Site',
    }));
  });
});

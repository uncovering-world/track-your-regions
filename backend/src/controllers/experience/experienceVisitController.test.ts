/**
 * `markVisited` is the write path Major 1 closes: before this, any
 * authenticated caller could POST a guessed id for a `pending` experience,
 * get its name echoed back, and have `getVisitedExperiences` hand back the
 * rest of the row — name, description, category, coordinates — for ever,
 * since nothing else here ever clears the row the POST just wrote.
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
import { getVisitedExperiences, markVisited } from './experienceVisitController.js';
import { experienceOfferedToReaderSql } from './experienceLifecycle.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('markVisited — #520', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('gates the existence check on the whole claim-writer predicate, not half of it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await markVisited(
      { params: { experienceId: '281' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // The composed predicate rather than its two fragments: this handler shipped
    // once carrying `curation_state` alone, and an assertion naming only the
    // fragment it did carry passed the whole time.
    expect(sql).toContain(experienceOfferedToReaderSql());
    expect(sql).toMatch(/e\.admission <> 'refused'/);
    expect(sql).toMatch(/e\.curation_state <> 'pending'/);
  });

  it('404s a row that fails either half, and writes nothing', async () => {
    // The existence check finds nothing — the shape a pending row and a refused
    // row both produce. Which half rejected it is not observable here and does
    // not need to be: what matters is that no second query runs.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await markVisited(
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
      .mockResolvedValueOnce({ rows: [{ id: 9, visited_at: '2026-01-01', notes: null, rating: null }] });
    const res = makeRes();

    await markVisited(
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

describe('getVisitedExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ count: '0' }] });
  });

  it('gates the list and the count on curation_state, and only that axis', async () => {
    await getVisitedExperiences(
      { query: {}, user: { id: 5 } } as never, makeRes() as never);

    const [listSql, countSql] = mockedQuery.mock.calls.map(c => String(c[0]));
    expect(listSql, 'the list').toMatch(/e\.curation_state <> 'pending'/);
    expect(countSql, 'the count').toMatch(/e\.curation_state <> 'pending'/);
    // Deliberately unfiltered on the other three, on both statements: a
    // traveller's own history must keep showing a place that has since left
    // the catalogue for any of those three reasons. Checked as the filter
    // fragments themselves, not as bare column names — the list's SELECT
    // carries `existence`/`missing_since` as columns to label the row with
    // (`lifecycleSelectSql`), which is not the same as filtering on them.
    for (const sql of [listSql, countSql]) {
      // Aliased, because the reader's position subquery (`readerPositionSql`)
      // legitimately filters *locations* on the same three columns: an object is
      // never positioned at a place the reader cannot be shown. What must not
      // appear is the filter on the experience itself.
      expect(sql).not.toContain("e.existence <> 'lost'");
      expect(sql).not.toContain("admission <> 'refused'");
      expect(sql).not.toContain('e.missing_since IS NULL');
    }
  });

  it('carries the category filter and the gate together on the count', async () => {
    await getVisitedExperiences(
      { query: { categoryId: '2' }, user: { id: 5 } } as never, makeRes() as never);

    const [, countSql] = mockedQuery.mock.calls.map(c => String(c[0]));
    expect(countSql).toContain('e.category_id = $2');
    expect(countSql).toMatch(/e\.curation_state <> 'pending'/);
  });
});

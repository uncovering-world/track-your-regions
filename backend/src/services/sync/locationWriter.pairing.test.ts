/**
 * Tests for a moved point under a gated source: its withdrawal waits, paired
 * with the arrival that replaces it, until that arrival is published.
 *
 * Like the rest of the writer's tests, these hold the statement rather than a
 * result — `locationWriter.test.ts` says why a mocked client can do no more.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import {
  mockedQuery, mockedConnect, writeExperienceLocations, A, fakeClient, MARK,
  INSERT, PAIR, HOLD, UNPAIR, only,
} from './locationWriter.fixtures.js';

/**
 * A moved point is a withdrawal plus an insert, and under a gated source the
 * two halves become visible at different times: the insert lands `pending`, so
 * applying the withdrawal at once leaves the reader watching the old pin vanish
 * while the new one is invisible. Measured on 2026-08-11, that is not a corner
 * case — 1119 of the catalogue's 1604 experiences hold exactly one point, so for
 * seventy per cent of them a move applied at once is an object still in the list
 * with no pin at all.
 *
 * What a mocked client can see is the statement, and each assertion here names
 * the one it is about. That the pairing comes out right against real geometry is
 * proved by executing these statements on a live PostGIS database.
 */
describe('a withdrawal the run replaced waits for the point that replaces it', () => {
  /** A gated arrival — what the insert returns when the source requires curation. */
  const ARRIVED = [[INSERT, { rows: [{ id: 12, curation_state: 'pending' }] }]] as
    Array<[RegExp, { rows?: unknown[]; rowCount?: number }]>;

  it('names, on the arrival, the point it replaces', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    // Same reference, a different point: the definition of a move, and the only
    // one the data supports. All but one location carries a reference, and for
    // museums and landmarks it is the experience's own Wikidata id — so it
    // cannot change while the experience stays the same.
    await writeExperienceLocations(1, [{ name: 'A', externalRef: 'r1', lon: 10.5, lat: 20 }]);

    const pair = only(statements, PAIR);
    expect(pair).toMatch(/a\.external_ref IS NOT DISTINCT FROM w\.external_ref/);
    // `IS NOT DISTINCT FROM` rather than `=`, and that is load-bearing rather
    // than habit: the one location in the catalogue with no reference at all
    // (8754, "Routes of Santiago de Compostela in France") is that experience's
    // only point, so an `=` here would apply its withdrawal at once and leave a
    // World Heritage site in the list with nothing on the map.
    expect(pair).not.toMatch(/a\.external_ref = w\.external_ref/);
  });

  it('pairs one arrival to one withdrawal even where the reference is repeated', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Nine `(experience_id, external_ref)` pairs are duplicated across nine
    // objects — a UNESCO component crossing a border is listed once per country
    // under one reference. Without the row numbers both withdrawn rows would
    // pair to both arrivals, and each arrival can name only one point.
    const pair = only(statements, PAIR);
    expect(pair).toMatch(/row_number\(\) OVER \(PARTITION BY external_ref ORDER BY id\)/);
    expect(pair).toMatch(/ON a\.external_ref IS NOT DISTINCT FROM w\.external_ref AND a\.rn = w\.rn/);
  });

  it('holds what the references cannot pair, against whatever arrival is left', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Where "hold rather than apply" is actually decided. A source that renumbers
    // a component writes a withdrawal and an insert whose references do not line
    // up at all, and 787 of the 788 single-point UNESCO sites carry a component
    // reference — so the by-reference pass alone takes such a site's only pin off
    // the map under a gate, without the point even having to move.
    //
    // Both halves asserted: the leftovers are taken from what the first pass did
    // not claim — or one arrival would name two points and only the last write
    // would survive — and they are matched by position with no reference
    // condition at all.
    const pair = only(statements, PAIR);
    expect(pair).toMatch(/left_over AS \(/);
    expect(pair).toMatch(/WHERE id NOT IN \(SELECT old_id FROM by_reference\)/);
    expect(pair).toMatch(/WHERE id NOT IN \(SELECT new_id FROM by_reference\)/);
    expect(pair).toMatch(/row_number\(\) OVER \(ORDER BY id\) AS rn FROM withdrawn/);
    // One row per arrival, from the two passes together, each an inner join — so
    // exactly min(withdrawals, arrivals) withdrawals are held, and the points a
    // reader sees after a run are min(what they saw before, what the source now
    // offers): never zero while the source still offers a point. Not "never below
    // the source's list" — an arrival is gated, so a run that adds more than it
    // drops leaves the visible count below the new list on purpose.
    expect(pair).toMatch(/FROM by_reference\s*UNION ALL\s*SELECT old_id, new_id FROM left_over/);
  });

  it('holds only a point a reader can actually see', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The candidates to *be* the held point, and the reason the set is narrower
    // than "everything the source stopped offering". An unread point costs a
    // reader nothing when it goes, and letting one compete builds a chain no path
    // can take apart:
    //
    //   a gated site shows P(r1); a run renumbers and moves it, so A1(r2) holds P;
    //   before anyone publishes, the next run moves it again — A2(r2) matches A1 by
    //   reference, and P is left over with no arrival, surviving only because A1
    //   still names it. Publishing A2 withdraws A1, and A1 can then never be
    //   published, never be revisited by the statements that only touch offered
    //   rows, and never be deleted. P stays visible beside A2 for ever: two pins on
    //   a one-point site, undoable only by hand-written SQL.
    //
    // Asserted on the CTE that chooses the old point, not on the statement as a
    // whole — the arrival's own filter sits three lines away and would satisfy a
    // looser match.
    const withdrawn = /withdrawn AS \([\s\S]*?\n {14}\)/.exec(only(statements, PAIR));
    expect(withdrawn, 'the pairing statement has no withdrawn CTE').not.toBeNull();
    expect(withdrawn![0]).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('holds only a point whose replacement a reader cannot see yet', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The whole reason to wait. An arrival a reader can already see replaces the
    // old pin the moment it lands, so holding the withdrawal would leave the
    // same place on the map twice.
    expect(only(statements, PAIR)).toMatch(/el\.curation_state = 'pending'/);
    // And never a point a curator turned down (ADR-0053): still pending, but
    // nothing publishes it, so a withdrawal held on it could never be released.
    expect(only(statements, PAIR)).toMatch(/el\.refused_at IS NULL/);
  });

  it('asks nothing about pairing when the run added nothing invisible', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(
      [[INSERT, { rows: [{ id: 12, curation_state: 'auto' }] }]]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // `requires_curation` is false on the three sources that predate the gate, so an ungated run
    // has to behave exactly as it did before this existed — not merely reach the
    // same rows, but ask the same questions. The state comes back from the
    // insert's own RETURNING, so this cannot disagree with what was written.
    expect(statements.filter(s => PAIR.test(s))).toEqual([]);
    expect(only(statements, MARK)).toBeDefined();
  });

  it('withdraws a point nothing replaced, at once', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // A source that simply dropped a point offered no replacement, so there is
    // nothing to wait for and nothing to ask.
    expect(statements.filter(s => PAIR.test(s))).toEqual([]);
    expect(only(statements, MARK)).toMatch(/missing_since = NOW\(\)/);
    expect(result.unoffered).toBe(0);
  });

  it('passes over the withdrawal of a point something is waiting on', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The half that makes the pairing mean anything. Without it the row would be
    // paired and withdrawn in the same transaction.
    expect(only(statements, MARK))
      .toMatch(/NOT EXISTS \(\s*SELECT 1 FROM experience_locations waiting\s*WHERE waiting\.experience_id = \$1\s*AND waiting\.withdrawal_deferred_for_location_id = el\.id/);
  });

  it('lets go of a pairing whose point the source is offering again', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Reachable where one reference covers two points — a component listed once
    // per country — and the source lists the replaced point beside its
    // replacement. Nothing is being withdrawn any more, so a pairing standing
    // from an earlier run would hide a point the source offers, the moment the
    // arrival is published. Asked on every changed object, because the case is
    // exactly the one where no withdrawal is left to notice it.
    const unpair = only(statements, UNPAIR);
    expect(unpair).toMatch(/SET withdrawal_deferred_for_location_id = NULL/);
    // Keyed on the decided pairing rather than on nearness to the incoming list. Under a
    // tolerance the held row *is* near the arrival that replaces it — 1.2 cm in the case
    // this test names — so asking about nearness would clear the pointer and leave
    // migration 026 with no handle on the pair. Asking about the pairing says what was
    // meant: the pointer goes when the old row is the row the source is offering.
    expect(unpair).toMatch(/EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = old\.id\s*\)/);
    expect(unpair).not.toMatch(/NOT EXISTS/);
    // Both sides of the join scoped, like the release in `publishController`. The
    // foreign key does not say a pairing stays inside one object; the writer does,
    // and every statement that walks the pairing says so itself rather than
    // trusting the others.
    expect(unpair).toMatch(/n\.experience_id = \$1/);
    expect(unpair).toMatch(/old\.experience_id = \$1/);
  });

  it('lets go of a pairing whose replacement the source withdrew in turn', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // An arrival the source dropped before anyone published it can never be
    // published — the publish statement carries `missing_since IS NULL` — so a
    // pairing left standing on it would hold the old point visible for ever,
    // with nothing able to release it.
    expect(only(statements, MARK)).toMatch(/withdrawal_deferred_for_location_id = NULL/);
  });

  it('takes the held point out of the list without taking it off the map', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Not cosmetic, and not optional. `ordinal` is unique per experience and the
    // next run parks every positive ordinal at its negative before renumbering:
    // a held row left at -3 collides with the arrival's 3 the moment anything
    // else about the object changes, and the whole write for that experience
    // dies on the unique key. NULL is also what the column already means for a
    // row the source no longer lists.
    const hold = only(statements, HOLD);
    expect(hold).toMatch(/SET ordinal = NULL/);
    expect(hold).not.toMatch(/missing_since = NOW/);
    expect(hold).toMatch(/(?<!NOT )EXISTS \(\s*SELECT 1 FROM experience_locations waiting\s*WHERE waiting\.experience_id = \$1/);
    // And it says nothing about a row the pairing kept. Membership of `paired`, not
    // nearness: a row that lost the pairing to a nearer one is *near* the incoming point
    // and must still lose its place, or it keeps the negative ordinal the parking step
    // gave it and the next run collides on `(experience_id, ordinal)`.
    expect(hold).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
  });

  it('does not rewrite a point it was already holding', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A held row keeps failing the fast path until a curator answers, so every
    // run reaches this statement. Without the guard each one would rewrite the
    // row to the value it already holds.
    expect(only(statements, HOLD)).toMatch(/el\.ordinal IS NOT NULL/);
  });

  it('pairs after the row exists to be named, and before the withdrawal reads it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The order is the whole mechanism, not an implementation detail: the column
    // is on the arrival, so it cannot be written before the insert, and the
    // withdrawal decides what to pass over by reading it. Both are asserted
    // because predicates alone cannot make this right.
    const insert = statements.findIndex(s => INSERT.test(s));
    const pair = statements.findIndex(s => PAIR.test(s));
    const mark = statements.findIndex(s => MARK.test(s));
    const hold = statements.findIndex(s => HOLD.test(s));
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(insert).toBeLessThan(pair);
    expect(pair).toBeLessThan(mark);
    expect(pair).toBeLessThan(hold);
    expect(statements.indexOf('COMMIT')).toBeGreaterThan(hold);
  });

  it('reports a held point as neither unoffered nor needing assignment', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'pending' }] }],
      [HOLD, { rowCount: 1 }],
      [MARK, { rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // `unoffered` answers "how many stored points this run was the first to find
    // missing", and a held point is one the run wrote nothing about — the
    // callers turn that number into "place this experience again", which is the
    // arrival's job here and not the held row's.
    expect(result.unoffered).toBe(0);
    expect(result.needsAssignment).toEqual([12]);
  });
});

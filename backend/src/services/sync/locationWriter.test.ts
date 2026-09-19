/**
 * The rule this writer has to keep is "a point that has not moved keeps its
 * row", because `experience_location_regions.location_id` cascades on delete
 * and a lost row is a lost region assignment.
 *
 * What the behaviour actually does was verified against a live PostGIS
 * database — mocked queries cannot tell a correct spatial predicate from a
 * wrong one. These tests hold the line against the regression that shape *can*
 * see: the unconditional delete coming back, and the unchanged case costing
 * writes.
 *
 * The writer's other rules have files of their own: when a stored row is the
 * incoming point (`locationWriter.identity.test.ts`), a withdrawal waiting for
 * the point that replaces it (`locationWriter.pairing.test.ts`), and what a
 * write reports and what a gated source holds back
 * (`locationWriter.delta.test.ts`). They drive the writer through
 * `locationWriter.fixtures.ts`; the source list's own dedupe is
 * `locationIncoming.test.ts`'s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { OBJECT_LOCK } from '../../db/locks.js';
import {
  mockedQuery, mockedConnect, writeExperienceLocations, A, B, fakeClient,
  RESURRECT, KEEP, MARK, INSERT, DECAY, HOLD,
} from './locationWriter.fixtures.js';

describe('writeExperienceLocations', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('writes nothing when the stored rows already say exactly this', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '2', ids: [7, 8] }] });

    const result = await writeExperienceLocations(1, [A, B]);

    // No transaction at all: the common case must not cost writes, or the
    // churn this exists to remove returns in another form.
    expect(mockedConnect).not.toHaveBeenCalled();
    expect(result).toEqual({
      unchanged: [7, 8],
      needsAssignment: [],
      unoffered: 0,
      delta: { added: [], withdrawn: [], returned: [], changed: [] },
    });
  });

  it('binds a point\'s name as a person would type it', async () => {
    // The World Heritage Centre's component names carry runs — *marmalo  IV*,
    // *Geoagiu  / Drumul Romanilor* (#835) — and every source's points pass
    // here, so the statement is bound the tidied name, before the pairing.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [{ ...A, name: ' marmalo  IV ' }]);

    const bound = mockedQuery.mock.calls[0][1] as unknown[];
    expect(bound).toContain('marmalo IV');
    expect(bound).not.toContain(' marmalo  IV ');
  });

  it('deletes no location at all, whether or not the source still offers it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // `user_visited_locations.location_id` and
    // `experience_location_regions.location_id` both cascade, so any delete
    // here destroys a user's record of having been somewhere. There is no
    // longer a delete of any shape to get wrong.
    expect(statements.filter(s => /DELETE FROM experience_locations/i.test(s))).toEqual([]);
  });

  it('marks the point the source stopped offering, and only that point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const mark = statements.filter(s => MARK.test(s));
    expect(mark).toHaveLength(1);
    // Keyed the same way the old delete was: everything the source did not offer this
    // time, and nothing it did. Through the pairing rather than through the predicate —
    // that is where the reference now lives, and asking nearness here would exclude a row
    // that lost the pairing from every arm at once (ADR-0027 decision 5).
    expect(mark[0]).toMatch(/NOT EXISTS/);
    expect(mark[0]).toMatch(/FROM paired_rows p WHERE p\.location_id = el\.id/);
    // A row with no position in the source's list has no ordinal either.
    expect(mark[0]).toMatch(/ordinal = NULL/);
  });

  it('takes back a delisting on a point the source never stopped offering', async () => {
    // Reachable through the verdict endpoint: `former` on an offered point leaves the
    // flag NULL, so the `returned` arm — which matches flagged rows only — never sees
    // it. Ungated, the row would keep `former` for ever, and the withdrawal card reads
    // the axes as "nobody has answered", so its next departure would raise nothing.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    expect(statements.find(s => KEEP.test(s))).toMatch(/source_membership = 'present'/);
  });

  it('does not let the fast path skip a delisting the source has contradicted', async () => {
    // The fast path means "nothing to do", and a row the source lists while recorded as
    // delisted is something to do — so it must not count as matched.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    const [sql] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/AS matched/);
    expect(String(sql)).toMatch(/el\.source_membership = 'present'\) AS matched/);
  });

  it('lets the fast path forgive a claimed name the source never offers', async () => {
    // `upsertSingleLocation` synthesises a null name for every museum's and every
    // landmark's one point, so without this term a curator who names such a point
    // buys the slow path for ever — and buys nothing with it, since `noNameOffered`
    // suppresses the only change that run could have reported.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    const [sql] = mockedQuery.mock.calls[0];
    // The same question `noNameOffered` asks, `COALESCE` included: that guard folds
    // the empty string the UNESCO parser makes of a malformed `name:`, and a term
    // written `IS NULL` would leave exactly that row paying for a silent report.
    expect(String(sql)).toMatch(/el\.curated_fields \? 'name' AND COALESCE\(i\.name, ''\) = ''/);
    // Only where the source offers nothing: a name it does offer is a conflict the
    // keeping arm has to compute, which is what ADR-0029 decision 5 keeps it for.
    expect(String(sql)).toMatch(/el\.name IS NOT DISTINCT FROM i\.name/);
  });

  it('locks the object before parking a single ordinal, as every curator write does', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // This transaction reaches `experiences` twice — the insert's FK key-shares
    // the row, and `retirePassAfterNewContent` at the end really updates it — so a
    // run that parked a point first and then asked for the object, against a
    // curator holding the object and waiting for that point, is a cycle Postgres
    // resolves by failing one of them.
    const object = statements.findIndex(s => s.includes(`FROM experiences WHERE id = $1 ${OBJECT_LOCK}`));
    const park = statements.findIndex(s => /SET ordinal = -ordinal/.test(s));
    expect(object).toBeGreaterThan(-1);
    expect(park).toBeGreaterThan(object);
  });

  it('takes back a curator’s delisting when the source offers a withdrawn point again', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The one direction, as the experience upsert does it (ADR-0021): a listing is
    // evidence about the source's list, and `former` was a claim about that list.
    // Without this the point comes back visible while recorded as delisted — and can
    // never be asked about again, because the withdrawal card reads the axes as
    // "nobody has answered", so its next departure would raise no card at all.
    expect(statements.find(s => RESURRECT.test(s))).toMatch(/source_membership = 'present'/);
    // `existence` is not touched: a source that keeps listing a demolished building
    // does not un-demolish it, and that verdict has to outlive the listing.
    expect(statements.find(s => RESURRECT.test(s))).not.toMatch(/existence =/);
  });

  it('does not restamp a point that was already missing', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // `missing_since` answers "when did this first go missing". A run that
    // finds it missing again is not a new observation, and rewriting the row
    // every run would churn the table for nothing.
    expect(statements.find(s => MARK.test(s))).toMatch(/el\.missing_since IS NULL/);
  });

  it('gives a point that came back its place, and sends it for reassignment', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient([[RESURRECT, { rows: [{ id: 7 }] }]]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // Same row, same id, so the visit record and any manual region assignment
    // on it are still the right ones. Its *auto* assignments are not: they were
    // dropped while it was missing, so placement has to run for it.
    expect(statements.filter(s => RESURRECT.test(s))).toHaveLength(1);
    expect(result.needsAssignment).toContain(7);
    expect(result.unchanged).not.toContain(7);
  });

  it('separates the point that came back from the point that never left', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // Two arms over disjoint sets. Merged into one, a returning point would be
    // reported as unchanged and never placed.
    expect(statements.find(s => RESURRECT.test(s))).toMatch(/el\.missing_since IS NOT NULL/);
    const keep = statements.find(s => KEEP.test(s) && !RESURRECT.test(s));
    expect(keep).toMatch(/el\.missing_since IS NULL/);
  });

  it('renumbers the survivors before it resurrects, or the sets overlap', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // Predicates alone do not make the two arms disjoint: resurrecting first
    // clears `missing_since`, and the survivors' arm would then match the row
    // it had just brought back — reporting it as unchanged as well as needing
    // assignment. The order is the guarantee, so it is asserted rather than
    // left to whoever edits this next.
    const keep = statements.findIndex(s => KEEP.test(s) && !RESURRECT.test(s));
    const resurrect = statements.findIndex(s => RESURRECT.test(s));
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(keep).toBeLessThan(resurrect);
  });

  it('asks the fast path about offered points only', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    // Counting marked rows as stored would fail the comparison on every later
    // run for any experience that ever lost a point — the slow path forever,
    // for an object nothing is changing.
    //
    // Asserted as a property of every subquery rather than as a tally of the term: the
    // count went stale the moment a subquery was added, and a count above a list always
    // will. What the fast path promises is that *no* part of it reads a marked row.
    const sql = String(mockedQuery.mock.calls[0][0]);
    const subqueries = sql.split('(SELECT').filter(part => part.includes('experience_locations'));
    expect(subqueries.length).toBeGreaterThan(1);
    for (const part of subqueries) expect(part).toContain('missing_since IS NULL');
  });

  it('renumbers out of the way before renumbering into place', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [B, A]);

    // `ordinal` is unique per experience, so assigning final ordinals directly
    // collides with a row that has not been renumbered yet.
    const park = statements.findIndex(s => /SET ordinal = -ordinal/.test(s));
    const final = statements.findIndex(s => /SET ordinal = i\.ordinal/.test(s));
    expect(park).toBeGreaterThanOrEqual(0);
    expect(park).toBeLessThan(final);
  });

  it('rolls back and releases the client when a statement fails', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    client.query.mockImplementation(async (sql: string) => {
      if (MARK.test(sql)) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    mockedConnect.mockResolvedValue(client);

    await expect(writeExperienceLocations(1, [A])).rejects.toThrow('boom');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('binds the experience once and four parameters per location', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(42, [A, B]);

    // Parameter numbering is where this file's neighbours have been bitten
    // twice: an unreferenced placeholder has no inferable type and Postgres
    // refuses the whole statement.
    expect(mockedQuery.mock.calls[0][1]).toEqual([42, 'r1', 'A', 10, 20, 'r2', 'B', 11, 21]);
  });

  it('asks a well-typed question even with no locations at all', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });

    const result = await writeExperienceLocations(1, []);

    // An untyped NULL column would leave the join's types uninferable; the
    // empty relation still has to declare them.
    expect(String(mockedQuery.mock.calls[0][0])).toMatch(/NULL::int, NULL::text/);
    expect(result.unchanged).toEqual([]);
  });
});

describe('a new point arrives stamped', () => {
  // What a mocked client can see is the statement: that the insert decides the
  // state from the gate and names both outcomes, and that no statement about a
  // point which already existed touches the column. That the decision comes out
  // `pending` under a gated source and `auto` under a trusted one was proved by
  // executing this statement against a real database, both ways.
  it('decides a new point state from the gate, and leaves an existing point alone', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const insert = statements.find(s => /INSERT INTO experience_locations/.test(s));
    expect(insert).toBeDefined();
    expect(insert).toMatch(/curation_state/);
    // The gate is reached through the experience, because this writer has an
    // experienceId and no sourceId — one subselect rather than a parameter
    // threaded through every sync service.
    expect(insert).toMatch(/FROM experiences[\s\S]*JOIN experience_sources/);
    // Both branches named, so an edit that stamped every row 'auto' (or every
    // row 'pending') fails this test instead of passing on column presence alone.
    expect(insert).toMatch(/THEN 'pending' ELSE 'auto' END/);

    // A returning point, a point renumbered in place, a point just marked
    // missing and a point held for its replacement all already had rows before
    // this run started — a curator may already have passed one of them, so none
    // of these four may touch the column at all.
    const returned = statements.find(s => RESURRECT.test(s));
    const kept = statements.find(s => KEEP.test(s) && !RESURRECT.test(s));
    const marked = statements.find(s => MARK.test(s));
    const held = statements.find(s => HOLD.test(s));
    expect(returned).toBeDefined();
    expect(kept).toBeDefined();
    expect(marked).toBeDefined();
    expect(held).toBeDefined();
    // "Touch" means assign. The keeping arm *reads* the column since ADR-0037 —
    // a visible row is what its name guard is about — and reading it is not
    // deciding it.
    expect(returned).not.toMatch(/curation_state\s*=/);
    expect(kept).not.toMatch(/curation_state\s*=/);
    expect(marked).not.toMatch(/curation_state\s*=/);
    expect(held).not.toMatch(/curation_state\s*=/);
  });

  it('retires the venue pass when it actually gained a point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient([[INSERT, { rows: [{ id: 12 }] }]]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A curator's pass covered the venue with the points it had. In the same
    // transaction as the insert, because the two are one fact about the object.
    const decay = statements.find(s => DECAY.test(s));
    expect(decay).toBeDefined();
    expect(decay).toMatch(/m\.curation_state = 'verified'/);
    expect(statements.indexOf(decay!)).toBeLessThan(statements.indexOf('COMMIT'));
  });

  it('leaves the venue pass alone when no point was added', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A point that came back, or one renumbered in place, is not new: the
    // curator saw it, and the row, its id and its assignments are the same ones.
    expect(statements.find(s => DECAY.test(s))).toBeUndefined();
  });
});

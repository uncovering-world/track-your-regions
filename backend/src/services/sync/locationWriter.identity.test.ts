/**
 * Tests for when a stored point *is* the one the source is offering (ADR-0027):
 * the match predicate the writer asks the database, and every arm that reads it.
 *
 * Like the rest of the writer's tests, these hold the statement rather than a
 * result — `locationWriter.test.ts` says why a mocked client can do no more.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { LOCATION_UNCHANGED_METERS } from './changeSet.js';
import {
  mockedQuery, mockedConnect, writeExperienceLocations, A, B, fakeClient,
  RESURRECT, KEEP, MARK, INSERT, PAIR, HOLD, only,
} from './locationWriter.fixtures.js';

// Four cases below read `mockedQuery.mock.calls[0]`, the match query the writer
// sends first. Without a reset that is the first call of an earlier case, and an
// assertion on it passes whatever this case sent.
beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
});

describe('the match predicate', () => {
  it('matches on the reference as well as the point, everywhere it matches at all', () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    return writeExperienceLocations(1, [A, B]).then(() => {
      // Point alone would make the mark hide a component that shares a coordinate with a
      // survivor, and the update match two stored rows to one incoming entry. Every query
      // that decides identity *from* geometry has to carry the reference beside it.
      //
      // Keyed on the tolerance rather than on `ST_MakePoint`, which since ADR-0027 no
      // longer separates the two: the keeping and resurrection arms build a point in order
      // to *write* it, having already been told which row by the pairing, and a statement
      // that writes a coordinate is not a statement that matches on one.
      const spatial = statements.filter(s => /ST_DWithin/.test(s));
      expect(spatial.length).toBeGreaterThan(0);
      for (const sql of spatial) {
        expect(sql).toMatch(/external_ref IS NOT DISTINCT FROM i\.external_ref/);
      }
    });
  });
});

/**
 * The rule for when a stored row *is* the point the source is offering (ADR-0027).
 *
 * These assert the SQL rather than a result, because the decision lives in a predicate
 * the database evaluates and the unit here has no database. What they are guarding is
 * the shape that cost the catalogue its only withdrawal: a coordinate rewritten 1.2 cm
 * more precisely read as a departure, with 1642 of 6680 points sitting on a rounded
 * coordinate behind it.
 */
describe('writeExperienceLocations — when a stored point is the incoming one', () => {
  /** Each composing site, and the slice of its statement the fragment must be inside. */
  const ASKS_SAME_POINT = [
    // Sliced rather than searched over the whole statement. The reason it was needed is
    // gone — the pairing is a table now, so this CTE appears in exactly one statement
    // instead of being prefixed to every arm — and the slice stays because the statement
    // it lands in also declares `best_row`, which is free to grow a predicate of its own
    // and would then answer this assertion on `candidate`'s behalf.
    ['the candidate relation the pairing is built from', /candidate AS \(/,
      (s: string) => s.slice(s.indexOf('candidate AS ('), s.indexOf('best_row AS ('))],
    ['the fast path', /AS matched/, (s: string) => s],
  ] as const;

  it('asks the same question in every place that asks it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The two sites that genuinely compose the fragment (ADR-0027 decision 5): the
    // relation the pairing is built from, and the fast path. Shorter than every earlier
    // draft, and the shrinking is the design settling rather than coverage being dropped —
    // the arms were handed a decided pairing to read instead of a question to ask, and the
    // withdrawal-to-arrival lookup followed them, because the set it withdraws from has to
    // cover the *visible* rows the mark marks, or a visible pin goes with no arrival
    // holding it back.
    //
    // But `candidate` had to come back into the list, not be left to the arms' own test:
    // that one asserts structure, so reverting this join to an exact comparison turned
    // nothing red. What comes back with it is #543 on the slow path — a rewritten
    // coordinate stops pairing, the withdrawal arm marks the row, the insert writes
    // another beside it — and the fast path still matching is exactly what would hide it.
    // Reverting the lookup instead is #543 one level up, an arrival no longer recognising
    // the point it replaces.
    const all = [String(mockedQuery.mock.calls[0][0]), ...statements];
    for (const [what, pattern, slice] of ASKS_SAME_POINT) {
      const sql = all.find(s => pattern.test(s));
      expect(sql, `${what} runs`).toBeDefined();
      expect(slice(String(sql)), `${what} carries the tolerance`).toContain('ST_DWithin');
      expect(slice(String(sql)), `${what} keeps the reference`).toContain('external_ref IS NOT DISTINCT FROM i.external_ref');
    }

    // And every statement deciding a row is *not* the incoming one asks the pairing rather
    // than nearness. Two of them because a row that lost the pairing is near the incoming
    // point, so nearness would strand it; the third — the deferral's `withdrawn` — because
    // the set it withdraws from has to cover every row the mark will mark *that a reader can
    // see*, or a run applies one it should have held, and under a gate that takes a visible
    // pin off the map leaving an invisible `pending` arrival as the replacement (ADR-0027
    // decision 5). Cover the visible ones, not equal them: the two predicates differ by two
    // terms pulling opposite ways, which is what the assertions below pin.
    //
    // The `withdrawn` CTE is sliced out rather than matched over the whole statement,
    // because the statement pairs withdrawals to arrivals by reference and position and
    // asks about neither of these things elsewhere in itself.
    const withdrawnCte = (sql: string) => sql.slice(sql.indexOf('withdrawn AS ('), sql.indexOf('arrived AS ('));
    // `waits` — which rows this statement must pass over because an arrival is holding
    // them, and the three answers are three different sets rather than a flag:
    //
    // - the mark: any row an arrival waits on, unconditionally — that is what makes a
    //   deferral mean anything, or the row would be paired and withdrawn in one run;
    // - the hold: none, its whole subject being exactly those rows;
    // - the deferral's `withdrawn`: only rows held by an arrival **this run keeps**. The
    //   narrower set on purpose, and the difference is the defect it was added for: a
    //   point moved twice before anyone publishes has a first arrival that is itself
    //   unoffered, so excluding the row it holds leaves the second arrival with no
    //   pairing and two visible pins on a one-point site.
    const anyWaiting = /NOT EXISTS \(\s*SELECT 1 FROM experience_locations waiting[\s\S]*?waiting\.withdrawal_deferred_for_location_id = el\.id/;
    const survivingWaiting = /waiting\.withdrawal_deferred_for_location_id = el\.id\s*AND EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = waiting\.id\s*\)/;
    const asksThePairing = [
      ['the withdrawal arm', MARK, (s: string) => s, anyWaiting],
      ['the hold arm', HOLD, (s: string) => s, null],
      ['the deferral’s withdrawn set', PAIR, withdrawnCte, survivingWaiting],
    ] as const;
    for (const [what, pattern, slice, waits] of asksThePairing) {
      const sql = slice(String(all.find(s => pattern.test(s))));
      expect(sql, `${what} reads the pairing`).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
      expect(sql, `${what} does not ask about nearness`).not.toMatch(/SELECT 1 FROM incoming i/);
      if (waits) expect(sql, `${what} passes over the right held rows`).toMatch(waits);
    }
    // And the two sets are not each other: widening the deferral's to the mark's is the
    // revert that brings the two-pin residue back, so it is asserted as a difference
    // rather than left to the regexes above happening not to overlap.
    const deferral = withdrawnCte(String(all.find(s => PAIR.test(s))));
    expect(deferral, 'the deferral is the narrower set').toMatch(/p\.location_id = waiting\.id/);

    // A deferral slot is scarce — one per arrival — so the set it draws from has to be the
    // rows a reader can actually see, all three terms of that. `curation_state` alone is
    // not it: a point a curator answered "no longer exists" on, which the source then
    // offered again, comes back with `missing_since` cleared and `existence` deliberately
    // untouched. Invisible, unpaired, not pending — and it would take the slot from a point
    // somebody can see.
    for (const term of [/el\.missing_since IS NULL/, /el\.existence <> 'lost'/, /el\.curation_state <> 'pending'/]) {
      expect(deferral, `the deferral draws only on visible rows: ${String(term)}`).toMatch(term);
    }
  });

  it('holds the tolerance to a matching reference, and to ten metres', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // Ten metres, and read from `changeSet.ts` rather than spelled here: the same number
    // already answers this question about the experience's own coordinate, and two
    // numbers would be two answers.
    expect(sql).toContain(`::geography,\n                                  ${LOCATION_UNCHANGED_METERS})`);
    // Distance in metres on `geography`, never in degrees: a degree of longitude is
    // 111 km at the equator and 23 km at Svalbard, and this catalogue holds points from
    // 78°N to 54°S.
    expect(sql).toContain('::geography');
    expect(sql).not.toMatch(/abs\(.*lat/i);
  });

  it('compares a point with no reference exactly, because nothing makes it a candidate', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [{ name: null, externalRef: null, lon: 1, lat: 2 }]);

    // Without a reference the tolerance would be a nearest-point search over the
    // object's own points, and 4172 pairs of points of one experience lie within a
    // kilometre — many at 0.000 m, since what separates two rock-art shelters in one
    // cliff is the component number and not the metres. So the exact branch stays,
    // reachable through `i.external_ref IS NULL`.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('CASE WHEN i.external_ref IS NULL');
    expect(sql).toMatch(/THEN el\.location = ST_SetSRID/);
  });

  it('writes the source’s coordinate onto the row it keeps', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Without this the stored value never converges: the row matches every run against
    // the same stale number, and the rounding the tolerance exists to absorb stays in
    // the database for ever (ADR-0027 decision 4).
    // Sliced to the SET clause, not searched over the statement: the predicate below it
    // carries `el.location = ST_SetSRID(…)` in its exact branch, so a match anywhere in
    // the text passes whether or not anything is written — which is how this assertion
    // read before a mutation check caught it.
    const setOf = (sql: string) => sql.slice(sql.indexOf('SET'), sql.indexOf('FROM paired'));
    // The write is the ELSE of a claim guard since #488 reached the contents: a
    // curator's coordinate survives the run, and every other row still converges.
    const write = 'ELSE ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326) END';
    expect(setOf(String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s))))).toContain(write);
    expect(setOf(String(statements.find(s => RESURRECT.test(s))))).toContain(write);
  });

  it('keeps a name and a coordinate a curator claimed, on both arms', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A point is a thing a curator can be right about — a pin in the wrong place is
    // a traveller in the wrong place — and before this the next run took it back.
    // Both arms, because a point that goes away and returns is the same point.
    const setOf = (sql: string) => sql.slice(sql.indexOf('SET'), sql.indexOf('FROM paired'));
    for (const arm of [KEEP, RESURRECT]) {
      const sql = setOf(String(statements.find(s => (arm === KEEP
        ? KEEP.test(s) && !RESURRECT.test(s)
        : RESURRECT.test(s)))));
      // The claim opens the CASE on both arms; the keeping arm carries the gate's
      // term after it (ADR-0037), which the describe block at the foot pins.
      expect(sql).toMatch(/CASE WHEN el\.curated_fields \? 'name'[\s\S]*?THEN el\.name/);
      expect(sql).toContain("CASE WHEN el.curated_fields ? 'location' THEN el.location");
    }

    // And not on the source's handle: `external_ref` and `ordinal` are what the
    // pairing reads to tell a moved point from a replaced one, so a claim there
    // would not protect a judgement — it would blind the writer to its own row.
    const kept = setOf(String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s))));
    expect(kept).toContain('external_ref = i.external_ref');
    expect(kept).toContain('ordinal = i.ordinal');
  });

  it('sends a row it moved back for placement, however small the move', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    // Keyed on the distance the arm reports, which is what tells it from the
    // resurrection arm — both open `SET ordinal = i.ordinal`.
    const KEPT_ROWS = /RETURNING el\.id, p\.metres/;
    const { client, statements } = fakeClient([
      [KEPT_ROWS, { rows: [{ id: 7, metres: 0 }, { id: 8, metres: 0.0124 }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A, B]);

    // Adopting the coordinate cost `unchanged` the property that made it safe: the row
    // matched, but it is no longer where it was assigned from. Ten metres is nothing to
    // a traveller and everything to a polygon — a region's edge is a line, so 1.2 cm
    // across it is a different country — and nothing revisits the row afterwards,
    // because the fast path matches the new coordinate on every later run. So the arm
    // reports the distance and the two lists split on it.
    expect(only(statements, KEPT_ROWS)).toMatch(/SET ordinal = i\.ordinal/);
    expect(result.needsAssignment).toEqual([8]);
    expect(result.unchanged).toEqual([7]);
  });

  it('decides the pairing once, before anything reads it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Two defects in one assertion, and both were shipped on this branch.
    //
    // As a CTE the pairing was *decided per statement*, so the keeping arm's own write —
    // moving a row onto the source's coordinate, and thereby off every other incoming
    // point — could hand an ordinal to a second row after every arm that would have
    // written it had run. That row keeps its parked negative ordinal, and the next run's
    // parking collides with it on `(experience_id, ordinal)`, aborting that experience's
    // write from then on. Materialised once, every statement after it agrees about it —
    // stated as a class rather than counted, the count having been wrong twice here as
    // statements moved onto the pairing one at a time.
    //
    // And the mocked lane cannot see the other one at all: a statement reading the
    // relation without declaring it raises `relation … does not exist` on a real database
    // and rolls the transaction back, on every slow-path run. That reached review twice
    // here. Ordering is what covers both — the table has to be built before it is read
    // (#522 is the executable lane that would catch either as a failure instead).
    // Comments stripped first, or the guard reads prose: the statements here explain
    // themselves at length, and a `--` line saying the word "paired" is not a statement
    // naming the relation. Caught by this very case going red on a comment.
    const sqlOnly = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    const all = [String(mockedQuery.mock.calls[0][0]), ...statements].map(sqlOnly);
    const built = all.findIndex(s => /CREATE TEMP TABLE paired_rows/.test(s));
    expect(built, 'the pairing is materialised').toBeGreaterThanOrEqual(0);
    expect(all[built], 'built from the pairing CTE').toMatch(/paired AS \(/);
    all.forEach((sql, i) => {
      if (/paired_rows/.test(sql) && i !== built) {
        expect(i, `reads the pairing after it is built: ${sql.slice(0, 60)}`).toBeGreaterThan(built);
        expect(sql, 'reads the table rather than redeciding it').not.toMatch(/paired AS \(/);
      }
      // The original `42P01`, kept as its own check rather than folded into the ordering
      // one: bare `paired` is the CTE, and only the statement that builds the table may
      // name it. `\bpaired\b` cannot match inside `paired_rows`, the underscore being a
      // word character, so this is about the relation the arms no longer have.
      if (/\bpaired\b/.test(sql)) {
        expect(sql, `names the CTE it declares: ${sql.slice(0, 60)}`).toMatch(/paired AS \(/);
      }
    });
  });

  it('puts the rows it inserts into the pairing, so the mark cannot take them back', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rows: [], rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Deciding the pairing once cost the insert its protection: the table predates every
    // row the insert writes, and membership of it is the withdrawal arm's *only* test of
    // whether the source still offers a row. So a point the run had just added answered
    // every predicate of the mark — added and withdrawn by one run, hidden from every
    // reader, its regions never written because placement takes offered rows only. Under
    // a gate it is worse and does not heal: the row is `pending` *and* marked, and publish
    // carries `missing_since IS NULL`, so nobody can ever release it.
    //
    // The insert therefore extends the pairing in the same statement, which is also what
    // keeps it one decision rather than two.
    const insert = statements.findIndex(s => INSERT.test(s));
    const mark = statements.findIndex(s => MARK.test(s));
    expect(statements[insert]).toMatch(/INSERT INTO paired_rows/);
    expect(insert, 'the insert runs before the mark can read the pairing').toBeLessThan(mark);
  });

  it('withdraws the row that lost the pairing, rather than stranding it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Two visible rows within the tolerance of one incoming point: one wins the pairing,
    // and the other is a second row for a place the run has already kept. Asking "is
    // anything in the incoming list near it" excludes it from every arm — it is near —
    // so it keeps the negative ordinal the parking step gave it, and the next run's
    // parking collides on `(experience_id, ordinal)` and aborts that experience's write
    // for good. Membership of `paired` is the question that makes the loser withdrawable.
    const mark = only(statements, MARK);
    expect(mark).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
    expect(mark).not.toMatch(/SELECT 1 FROM incoming i/);
  });

  it('pairs each incoming point with one row, and each row with one point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The tolerance gave away what the exact match had for free: two rows within ten
    // metres under one reference both satisfy the predicate for one incoming point, and
    // the keeping and resurrection arms would then write the same ordinal onto two rows
    // — `UNIQUE(experience_id, ordinal)` aborting that experience's write on every run
    // after. So the arms read a decided pairing, made one-to-one from both directions,
    // preferring the row that is not marked (ADR-0027 decision 5a — not the row a reader
    // can see, which under a gate is a different row).
    //
    // Both orderings are pinned, because they are the product decision and because they
    // are all this lane can reach: the passes are greedy, so a complete pairing inside the
    // tolerance can go unfound (decision 5a-i, #549), and observing that needs SQL run
    // against Postgres rather than a mock that never parses it (#522).
    //
    // Asserted on the statement that *builds* the table, since that is now the only place
    // the decision is made — the arms read its result and can no longer restate it.
    const build = String(statements.find(s => /CREATE TEMP TABLE paired_rows/.test(s)));
    expect(build).toContain('DISTINCT ON (ordinal)');
    expect(build).toContain('DISTINCT ON (location_id)');
    expect(build).toContain('ORDER BY ordinal, (missing_since IS NULL) DESC, metres');
    expect(build).toContain('ORDER BY location_id, ordinal');
    const kept = String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s)));
    expect(kept).toContain('FROM paired_rows p JOIN incoming i ON i.ordinal = p.ordinal');
    // And the insert reads the same relation rather than asking the predicate again,
    // or a point the pairing kept is inserted a second time beside the row it updated.
    expect(String(statements.find(s => INSERT.test(s))))
      .toContain('NOT EXISTS (SELECT 1 FROM paired_rows p WHERE p.ordinal = i.ordinal)');
  });
});

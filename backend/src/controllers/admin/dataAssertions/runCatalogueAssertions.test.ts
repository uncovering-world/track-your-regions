/**
 * What the panel is told, and what it is told to worry about.
 *
 * The assertions are tested against their own predicates next door; this is
 * about the layer that decides whether anybody needs to be interrupted. Its
 * rules are the ones an admin will lean on without re-reading them — debt that
 * stands still is quiet, a number that grew is loud, a query that did not run is
 * never silence — so each is pinned rather than left to the shape of the data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../../db/index.js';
import { AssertionUnavailable, type ComputedAssertion } from './assertion.js';
import type { CatalogueAssertion } from './catalogueAssertions.js';
import {
  SAMPLE_ROWS,
  assess,
  needsAttention,
  readAcceptedNumbers,
  runCatalogueAssertions,
  toReport,
  type AcceptedNumbers,
} from './runCatalogueAssertions.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function assertion(id: string, over: Partial<CatalogueAssertion> = {}): CatalogueAssertion {
  return {
    id,
    area: 'places',
    title: `the ${id} rule`,
    kind: 'invariant',
    meaning: `what ${id} means`,
    sql: `SELECT 1 -- ${id}`,
    describe: row => `${id} row ${String(row.id)}`,
    ...over,
  };
}

function computed(id: string, collect: ComputedAssertion['collect']): ComputedAssertion {
  const { area, title, kind, meaning, describe: say } = assertion(id);
  return { id, area, title, kind, meaning, describe: say, collect };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

const acceptedAs = (counts: Record<string, number>): AcceptedNumbers =>
  Object.fromEntries(Object.entries(counts).map(([id, count]) => [
    id, { count, acceptedAt: new Date('2026-08-24T10:00:00Z'), acceptedBy: 'Nikolay' },
  ]));

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('running the assertions', () => {
  it('asks each one its own query and keeps what came back', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: rows(2) }).mockResolvedValueOnce({ rows: [] });
    const outcomes = await runCatalogueAssertions([assertion('first'), assertion('second')]);

    expect(mockedQuery.mock.calls.map(call => call[0])).toEqual([
      'SELECT 1 -- first', 'SELECT 1 -- second',
    ]);
    expect(outcomes.map(o => o.rows.length)).toEqual([2, 0]);
  });

  it('carries a broken query instead of taking the other assertions off the report', async () => {
    mockedQuery
      .mockRejectedValueOnce(new Error('relation "experience_locations" does not exist'))
      .mockResolvedValueOnce({ rows: rows(1) });
    const outcomes = await runCatalogueAssertions([assertion('broken'), assertion('fine')]);

    expect(outcomes[0].error?.message).toMatch(/does not exist/);
    expect(outcomes[1].rows).toHaveLength(1);
  });

  it('asks a computed assertion its own owner, not the pool, and keeps what it says beside the rows', async () => {
    const outcomes = await runCatalogueAssertions([
      computed('coverage', async () => ({ rows: rows(3), context: ['Archaeology offers 81 of the 213 expected of it.'] })),
    ]);

    expect(mockedQuery).not.toHaveBeenCalled();
    const [entry] = toReport(assess(outcomes, {}));
    expect(entry.found).toBe(3);
    expect(entry.context).toEqual(['Archaeology offers 81 of the 213 expected of it.']);
    expect(entry.status).toBe('unanswered');
  });

  it('reports a computed assertion with nothing to read as unavailable, in its own words, asking nobody', async () => {
    const outcomes = await runCatalogueAssertions([
      computed('coverage', async () => { throw new AssertionUnavailable('The lists have not been loaded.'); }),
    ]);
    const [entry] = toReport(assess(outcomes, {}));

    // Not clear: tables nobody loaded are not a clean catalogue. Not an error
    // either: nothing is broken, and a red badge on every fresh database would
    // teach an admin to ignore the badge.
    expect(entry.status).toBe('unavailable');
    expect(entry.needsAttention).toBe(false);
    expect(entry.error).toBe('The lists have not been loaded.');
    expect(entry.found).toBe(0);
  });

  it('says a computed assertion that failed did not run, never with the failure\'s own text', async () => {
    const outcomes = await runCatalogueAssertions([
      computed('coverage', async () => { throw new Error('relation "coverage_kinds" does not exist'); }),
    ]);
    const [entry] = toReport(assess(outcomes, {}));

    expect(entry.status).toBe('error');
    expect(entry.error).toBe('The check could not run: its query failed, and the server log has the cause.');
  });
});

describe('the accepted numbers', () => {
  it('reads the newest acceptance per assertion, with who made it', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        assertion_id: 'held-by-no-region', accepted_count: 28,
        accepted_at: new Date('2026-08-24T10:00:00Z'), display_name: 'Nikolay',
      }],
    });
    const { numbers } = await readAcceptedNumbers();

    // A ledger, so the current number is the latest row per id: the ordering is
    // what makes DISTINCT ON answer that, and it is worth pinning.
    expect(mockedQuery.mock.calls[0][0]).toMatch(/DISTINCT ON \(a\.assertion_id\)/);
    expect(mockedQuery.mock.calls[0][0]).toMatch(/ORDER BY a\.assertion_id, a\.accepted_at DESC/);
    expect(numbers['held-by-no-region'].count).toBe(28);
    expect(numbers['held-by-no-region'].acceptedBy).toBe('Nikolay');
  });

  it('keeps a number whose account is gone, rather than dropping the line', async () => {
    // A LEFT JOIN, because the number stands whether or not the person who
    // accepted it still has an account — dropping it would re-report accepted
    // debt as new.
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        assertion_id: 'rule', accepted_count: 4,
        accepted_at: new Date('2026-08-24T10:00:00Z'), display_name: null,
      }],
    });
    const { numbers } = await readAcceptedNumbers();
    expect(numbers.rule.count).toBe(4);
    expect(numbers.rule.acceptedBy).toBeNull();
  });

  it('carries an unreadable ledger rather than throwing, since it arrives by migration', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation "data_assertion_acceptances" does not exist'));
    const { numbers, error } = await readAcceptedNumbers();

    // Every existing database passes through this state exactly once, at the
    // moment somebody opens the screen for the first time. Throwing would make
    // that a stack trace instead of a sentence naming the migration.
    expect(numbers).toEqual({});
    expect(error?.message).toMatch(/does not exist/);
  });
});

describe('reading today against what was accepted', () => {
  const outcomesOf = (found: number, over: Partial<CatalogueAssertion> = {}) =>
    [{ assertion: assertion('rule', over), rows: rows(found) }];

  it('calls nothing found with nothing accepted clear', () => {
    expect(assess(outcomesOf(0), {})[0].status).toBe('clear');
  });

  it('calls rows nobody has answered for unanswered, and asks for a person', () => {
    const [result] = assess(outcomesOf(4), {});
    expect(result.status).toBe('unanswered');
    expect(needsAttention(result.status)).toBe(true);
  });

  it('calls debt that stands still holding, and lets it stand', () => {
    const [result] = assess(outcomesOf(28), acceptedAs({ rule: 28 }));
    expect(result.status).toBe('holding');
    expect(needsAttention(result.status)).toBe(false);
  });

  it('calls a number that grew regressed, which is the case the lane exists for', () => {
    const [result] = assess(outcomesOf(31), acceptedAs({ rule: 28 }));
    expect(result.status).toBe('regressed');
    expect(needsAttention(result.status)).toBe(true);
  });

  it('calls a number that fell improved, so work that fixed something is visible', () => {
    const [result] = assess(outcomesOf(20), acceptedAs({ rule: 28 }));
    expect(result.status).toBe('improved');
    expect(needsAttention(result.status)).toBe(false);
  });

  it('never asks for a person over a watch, however far its count has moved', () => {
    const [result] = assess(outcomesOf(500, { kind: 'watch' }), acceptedAs({ rule: 5 }));
    expect(result.status).toBe('watch');
    expect(needsAttention(result.status)).toBe(false);
  });

  it('asks for a person when a query did not run, since silence is not a pass', () => {
    const [result] = assess([{ assertion: assertion('rule'), rows: [], error: new Error('boom') }], {});
    expect(result.status).toBe('error');
    expect(needsAttention(result.status)).toBe(true);
  });
});

describe('the report the panel receives', () => {
  it('sends ten rows and the whole count, however many matched', () => {
    const [entry] = toReport(assess([{ assertion: assertion('rule'), rows: rows(2000) }], {}));
    expect(entry.sample).toHaveLength(SAMPLE_ROWS);
    // The count is the whole truth even when the sample is not: a source
    // re-published at full precision puts a quarter of the catalogue in here.
    expect(entry.found).toBe(2000);
  });

  it('says each row the way the assertion says it, rather than leaving that to a screen', () => {
    const [entry] = toReport(assess([{ assertion: assertion('rule'), rows: rows(1) }], {}));
    expect(entry.sample[0]).toBe('rule row 1');
    expect(entry.meaning).toBe('what rule means');
    expect(entry.context).toEqual([]);
  });

  it('carries who accepted the number and when', () => {
    const [entry] = toReport(assess([{ assertion: assertion('rule'), rows: rows(28) }],
      acceptedAs({ rule: 28 })));
    expect(entry.accepted).toBe(28);
    expect(entry.acceptedBy).toBe('Nikolay');
    expect(entry.acceptedAt).toBe('2026-08-24T10:00:00.000Z');
  });

  it('says nothing was accepted rather than pretending a zero was', () => {
    const [entry] = toReport(assess([{ assertion: assertion('rule'), rows: rows(4) }], {}));
    expect(entry.accepted).toBeNull();
    expect(entry.acceptedAt).toBeNull();
  });

  it('says a query did not run, never with the driver\'s own text (#1021)', () => {
    const [entry] = toReport(assess(
      [{ assertion: assertion('rule'), rows: [], error: new Error('relation "regions_old" does not exist') }], {}));
    expect(entry.error).toBe('The check could not run: its query failed, and the server log has the cause.');
    expect(entry.needsAttention).toBe(true);
  });

  it('says so when the query ran out of time', () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const [entry] = toReport(assess([{ assertion: assertion('rule'), rows: [], error: timeout }], {}));
    expect(entry.error).toBe('The check could not run: its query timed out.');
  });
});

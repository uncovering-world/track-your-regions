/**
 * The statements the merge-proposal answers rest on (#1249), pinned against
 * the fragments they compose: the pool is a mock, so these read the SQL and
 * not its answer, which `mergeProposalAnswers.db.test.ts` reads on a real
 * database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, rollbackQuietly: vi.fn() }));
vi.mock('./placeMerge.js', () => ({ mergePlaces: vi.fn() }));
vi.mock('./experienceScope.js', () => ({ resolveExperienceScope: vi.fn() }));

import { pool } from '../../db/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { mergeProposalSourceIds, mergeProposalsScope, openPairs } from './mergeProposalController.js';
import { mergeProposalOpenSql, pairMembershipSql } from './reviewQueuePredicates.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the open pairs of a place', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ id: 41 }, { id: 42 }] });
  });

  it('asks the one open predicate the queue asks, anchored on the lower id', async () => {
    await openPairs(1225, 'all');
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(collapse(sql)).toContain(collapse(mergeProposalOpenSql('p', 'a', 'b')));
    expect(sql).toContain('p.place_a = $1');
    expect(params).toEqual([1225, true]);
  });

  it('narrows a batch accept to the exact pairs, which the parameter decides', async () => {
    await openPairs(1225, 'exact');
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('($2::boolean OR p.exact)');
    expect(params).toEqual([1225, false]);
  });
});

describe("the scope of a place's pairs", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedScope.mockReset();
  });

  it('is the sources of every membership of either place of an open pair', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ source_ids: [1, 4] }] });
    expect(await mergeProposalSourceIds(1225)).toEqual([1, 4]);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    // Either place's sources, a part's through its site (#1250).
    expect(sql).toContain(pairMembershipSql('p', 'm'));
    expect(collapse(sql)).toContain(collapse(mergeProposalOpenSql('p', 'a', 'b')));
  });

  it('falls back to the place as a whole once no pair is open, and to nothing for no such place', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ source_ids: null }] });
    expect(await mergeProposalSourceIds(13341)).toEqual(['place']);
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    expect(await mergeProposalSourceIds(1)).toBeNull();
  });

  it('admits a curator in scope for any of those sources, names the region of the first that admits, and says which sources admit', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ source_ids: [1, 3, 4], source_id: 1 }] });
    mockedScope
      .mockResolvedValueOnce({ permitted: false, logRegionId: null })
      .mockResolvedValueOnce({ permitted: true, logRegionId: 6737 })
      .mockResolvedValueOnce({ permitted: true, logRegionId: 7100 });
    // Every source is asked, since each pair is then held to the ones that admit.
    expect(await mergeProposalsScope(7, 'curator', 1225)).toEqual({ permitted: true, logRegionId: 6737, found: true, sourceIds: [3, 4] });
    expect(mockedScope).toHaveBeenNthCalledWith(1, 7, 'curator', 1225, 1);
    expect(mockedScope).toHaveBeenNthCalledWith(2, 7, 'curator', 1225, 3);
    expect(mockedScope).toHaveBeenNthCalledWith(3, 7, 'curator', 1225, 4);
  });

  it('says a place that is gone is not found, with no source admitting', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    expect(await mergeProposalsScope(7, 'curator', 1)).toEqual({ permitted: false, logRegionId: null, found: false, sourceIds: [] });
    expect(mockedScope).not.toHaveBeenCalled();
  });
});

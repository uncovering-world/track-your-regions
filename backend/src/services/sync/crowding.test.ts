/**
 * The run's measure of a crowded city (ADR-0172): every membership the rule
 * reads measured from the workbench's signals, a signal whose source is not in
 * place kept as last measured, then the schema's refresh.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn(async () => client) } }));
vi.mock('../dumps/readership/workReadership.js', () => ({
  readershipYear: vi.fn(),
  readWorks: vi.fn(async () => ({ views: new Map([['Q180274', 2_000_000]]), counted: new Map() })),
}));
vi.mock('../dumps/wikidata/subsetTables.js', () => ({
  latestSubset: vi.fn(async () => ({ dumpDate: '2026-10-05' })),
  entitiesAreHeld: vi.fn(async () => true),
}));
vi.mock('../dumps/wikivoyage/usageTables.js', () => ({
  latestUsage: vi.fn(async () => ({ dumpDate: '2026-10-01' })),
  guideEditions: vi.fn(async () => new Map([['Q180274', 30]])),
}));
vi.mock('./subset/kit.js', () => ({
  subsetWikipediaEditions: vi.fn(async () => new Map([['Q180274', 95], ['Q1067581', 12]])),
}));

import { pool } from '../../db/index.js';
import { readershipYear } from '../dumps/readership/workReadership.js';
import { crowdingSentence, refreshCrowding } from './crowding.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('refreshCrowding', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) =>
      (sql.includes('refresh_crowding') ? { rows: [{ crowded: 124 }] } : { rows: [] }));
    // Santa Maria Maggiore and Santa Prassede, two places of worship.
    mockedQuery.mockResolvedValue({ rows: [{ id: 11, qid: 'Q180274' }, { id: 12, qid: 'Q1067581' }] });
  });

  it('writes every signal, a place no source names at zero, and refreshes in the same transaction', async () => {
    vi.mocked(readershipYear).mockResolvedValueOnce({ months: ['2025-10-01'], editions: ['enwiki'] });
    expect(await refreshCrowding()).toEqual({ measured: 2, stale: [], crowded: 124 });
    const calls = client.query.mock.calls.map(c => c as [string, unknown[]?]);
    expect(calls.map(([sql]) => sql.trim().split(/\s/)[0])).toEqual(['BEGIN', 'INSERT', 'DELETE', 'SELECT', 'COMMIT']);
    expect(calls[1][1]).toEqual([[11, 12], [2_000_000, 0], [30, 0], [95, 12]]);
  });

  it('keeps the readers as last measured when no readership year is folded', async () => {
    vi.mocked(readershipYear).mockResolvedValueOnce(null);
    const refresh = await refreshCrowding();
    expect(refresh.stale).toEqual(['readers']);
    expect(client.query.mock.calls[1][1]).toEqual([[11, 12], [null, null], [30, 0], [95, 12]]);
    expect(crowdingSentence(refresh)).toBe(
      '124 places crowded out of crowded cities, with readers as last measured, since that source is not in place');
  });

  it('rolls back and throws when the refresh fails', async () => {
    vi.mocked(readershipYear).mockResolvedValueOnce(null);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('refresh_crowding')) throw new Error('deadlock detected');
      return { rows: [] };
    });
    await expect(refreshCrowding()).rejects.toThrow('deadlock detected');
    expect(client.query.mock.calls.at(-1)![0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

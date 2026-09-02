/**
 * What the museum run reads as "where the last run left each work".
 *
 * The one query behind both the placement diff and the coverage floor
 * (ADR-0044), so which rows it reads decides what a run is allowed to withdraw
 * and what it is measured against. Its promise lives in a predicate no caller
 * can observe from the map it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  db: {},
}));

import { pool } from '../../db/index.js';
import { readPreviousPlacements } from './museumSyncService.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('readPreviousPlacements', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('reads only the links the source still places, and only this category', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await readPreviousPlacements();

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // A link an earlier run marked is not a placement the catalogue shows:
    // counted, it could never be withdrawn again and would drag the coverage
    // ratio down on every later run for works nobody sees.
    expect(sql).toContain('et.missing_since IS NULL');
    expect(sql).toContain('e.category_id = $1');
    expect(params).toEqual([2]);
  });

  it('groups every venue a work hangs in under the work', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [
      { work: 'Q12418', venue: 'Q19675' },
      { work: 'Q12418', venue: 'Q1233' },
      { work: 'Q151047', venue: 'Q19675' },
    ] });

    const placements = await readPreviousPlacements();

    expect(placements).toEqual({
      Q12418: ['Q19675', 'Q1233'],
      Q151047: ['Q19675'],
    });
  });
});

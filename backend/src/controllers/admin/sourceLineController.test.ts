/**
 * Tests for the admin write of a source's fame line.
 *
 * `parseSourceLine` (`services/sync/sourceLine.ts`) is the run's reader of the
 * same pair; this is the writer, so the two are validators of one shape and the
 * bound worth pinning here is that the merge keeps every other key `api_config`
 * already holds — a source's other `api_config` keys must survive setting its line.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { setSourceLine } from './sourceLineController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(categoryId: string, body: { enterSitelinks: number; staySitelinks: number }) {
  return {
    params: { categoryId },
    body,
    user: { id: 1, role: 'admin' as const },
  } as never;
}

describe('setSourceLine', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('writes the pair into api_config and answers with it', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 4, has_line: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: 'Places of worship', api_config: { enterSitelinks: 30, staySitelinks: 25, pageSize: 100 } }],
      });

    await setSourceLine(makeReq('4', { enterSitelinks: 30, staySitelinks: 25 }), makeRes() as never);

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/SET api_config = COALESCE\(api_config, '\{\}'::jsonb\) \|\| \$1::jsonb/);
    expect(params).toEqual([JSON.stringify({ enterSitelinks: 30, staySitelinks: 25 }), 4]);
    const [existsSql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(existsSql).toMatch(/api_config \? 'enterSitelinks'/);
  });

  it('answers with the pair the caller sent, on a source that already has a line', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 4, has_line: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: 'Places of worship', api_config: { enterSitelinks: 30, staySitelinks: 25, pageSize: 100 } }],
      });
    const res = makeRes();

    await setSourceLine(makeReq('4', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    expect(res.json).toHaveBeenCalledWith({
      categoryId: 4, name: 'Places of worship', enterSitelinks: 30, staySitelinks: 25,
    });
  });

  it('answers 404 for an unknown or inactive source', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setSourceLine(makeReq('999', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_active = true');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Category not found' });
  });

  it('answers 409 for a source with no line of its own', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, has_line: false }] });
    const res = makeRes();

    await setSourceLine(makeReq('1', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'This source keeps its line in code' });
  });
});

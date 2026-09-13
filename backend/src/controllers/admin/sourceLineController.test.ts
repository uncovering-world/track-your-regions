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

interface LineBody {
  enterSitelinks: number;
  staySitelinks: number;
  findEnterSitelinks?: number;
  findStaySitelinks?: number;
}

function makeReq(sourceId: string, body: LineBody) {
  return {
    params: { sourceId },
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
    expect(existsSql).toMatch(/api_config \?\| array\['enterSitelinks', 'staySitelinks', 'findEnterSitelinks', 'findStaySitelinks'\]/);
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
      sourceId: 4, name: 'Places of worship', enterSitelinks: 30, staySitelinks: 25,
    });
  });

  it('writes the finds pair beside the places pair, and echoes both', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, has_line: true }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          name: 'Archaeology',
          api_config: {
            enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
          },
        }],
      });
    const res = makeRes();

    await setSourceLine(
      makeReq('5', {
        enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
      }),
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([
      JSON.stringify({
        enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
      }),
      5,
    ]);
    expect(res.json).toHaveBeenCalledWith({
      sourceId: 5,
      name: 'Archaeology',
      enterSitelinks: 22,
      staySitelinks: 18,
      findEnterSitelinks: 18,
      findStaySitelinks: 15,
    });
  });

  it('leaves a one-line source one-line: no find keys in the write or the answer', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 4, has_line: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: 'Places of worship', api_config: { enterSitelinks: 30, staySitelinks: 25 } }],
      });
    const res = makeRes();

    await setSourceLine(makeReq('4', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(JSON.parse(String((params as unknown[])[0]))).toEqual({ enterSitelinks: 30, staySitelinks: 25 });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('findEnterSitelinks');
  });

  it('answers 404 for an unknown or inactive source', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setSourceLine(makeReq('999', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_active = true');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Source not found' });
  });

  it('answers 409 for a source with no line of its own', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, has_line: false }] });
    const res = makeRes();

    await setSourceLine(makeReq('1', { enterSitelinks: 30, staySitelinks: 25 }), res as never);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'This source keeps its line in code' });
  });

  it('lets a row holding any one of the four line keys be repaired, not only one with the enter line', async () => {
    // The panel draws the card for a row left with a stay number alone (a hand
    // edit of api_config) so that the save can repair it; a guard on the enter
    // key alone would answer that save 409 and leave the row unrepairable.
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 4, has_line: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: 'Places of worship', api_config: { enterSitelinks: 22, staySitelinks: 18 } }],
      });
    const res = makeRes();

    await setSourceLine(makeReq('4', { enterSitelinks: 22, staySitelinks: 18 }), res as never);

    const [guardSql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(guardSql).toContain("api_config ?| array['enterSitelinks', 'staySitelinks', 'findEnterSitelinks', 'findStaySitelinks']");
    expect(guardSql).not.toContain("api_config ? 'enterSitelinks'");
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});

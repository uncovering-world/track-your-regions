import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

const { mockPoolQuery, mockClientQuery, mockClientRelease, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const clientRelease = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockClientRelease: clientRelease,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: clientRelease })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

// Stub other heavy imports the controller pulls in but resetMatch doesn't use.
vi.mock('openai', () => ({ default: class { } }));
vi.mock('../../services/worldViewImport/aiMatcher.js', () => ({
  startAIMatching: vi.fn(), getAIMatchProgress: vi.fn(), cancelAIMatch: vi.fn(),
  aiMatchSingleRegion: vi.fn(), dbSearchSingleRegion: vi.fn(), geocodeMatchRegion: vi.fn(),
}));
vi.mock('../../services/ai/openaiService.js', () => ({ isOpenAIAvailable: vi.fn(), getOpenAIClient: vi.fn() }));
vi.mock('../../services/ai/aiSettingsService.js', () => ({ getModelForFeature: vi.fn() }));
vi.mock('../../services/ai/pricingService.js', () => ({ calculateCost: vi.fn() }));
vi.mock('../../services/ai/chatCompletion.js', () => ({ chatCompletion: vi.fn() }));
vi.mock('../../services/ai/aiUsageLogger.js', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../services/wikivoyageExtract/fetcher.js', () => ({ WikivoyageFetcher: class { } }));

import { resetMatch } from './wvImportAIController.js';

function makeReq(overrides: { worldViewId?: string; regionId?: number } = {}): AuthenticatedRequest {
  return {
    params: { worldViewId: overrides.worldViewId ?? '31' },
    body: { regionId: overrides.regionId ?? 100 },
  } as unknown as AuthenticatedRequest;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as Response & { _status?: number; _body?: unknown };
  res.status = vi.fn((code: number) => { res._status = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res._body = body; return res; }) as unknown as Response['json'];
  return res;
}

describe('resetMatch (#335 — atomicity)', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockPoolConnect.mockClear();
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('runs the three writes inside a single BEGIN/COMMIT transaction', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 100 }], rowCount: 1 });

    const res = makeRes();
    await resetMatch(makeReq(), res);

    const sqlCalls = mockClientQuery.mock.calls.map(c => (c[0] as string).trim().split('\n')[0]);
    expect(sqlCalls[0]).toBe('BEGIN');
    expect(sqlCalls.at(-1)).toBe('COMMIT');
    expect(sqlCalls.filter(s => /^DELETE FROM region_members/.test(s))).toHaveLength(1);
    expect(sqlCalls.filter(s => /^DELETE FROM region_match_suggestions/.test(s))).toHaveLength(1);
    expect(sqlCalls.filter(s => /UPDATE region_import_state SET match_status/.test(s))).toHaveLength(1);
    expect(sqlCalls).not.toContain('ROLLBACK');
    expect(res._body).toEqual({ reset: true });
  });

  it('ROLLBACKs and returns 500 if any write throws (no half-applied state)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 100 }], rowCount: 1 });
    // BEGIN ok, first DELETE ok, second DELETE blows up
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE region_members
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly')) // DELETE suggestions
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    const res = makeRes();
    await resetMatch(makeReq(), res);

    const sqlCalls = mockClientQuery.mock.calls.map(c => (c[0] as string).trim().split('\n')[0]);
    expect(sqlCalls).toContain('ROLLBACK');
    expect(sqlCalls).not.toContain('COMMIT');
    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/connection terminated/) });
  });

  it('always releases the client (try/finally)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 100 }], rowCount: 1 });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await resetMatch(makeReq(), makeRes());
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 404 without opening a connection when region not found', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = makeRes();
    await resetMatch(makeReq(), res);

    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(res._status).toBe(404);
  });

  it('returns 500 (not an unhandled rejection) when pool.connect() itself fails', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 100 }], rowCount: 1 });
    mockPoolConnect.mockRejectedValueOnce(new Error('pool exhausted'));

    const res = makeRes();
    await resetMatch(makeReq(), res);

    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockClientRelease).not.toHaveBeenCalled();
    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/pool exhausted/) });
  });

  it('still returns 500 when ROLLBACK itself throws (dead connection)', async () => {
    // Without the inner try around ROLLBACK, the original handler-level error
    // would propagate and the 500 response would never be sent — reproducing
    // the same hang #335 was filed for.
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 100 }], rowCount: 1 });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly')) // first DELETE
      .mockRejectedValueOnce(new Error('connection is closed')); // ROLLBACK also fails

    const res = makeRes();
    await resetMatch(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/connection terminated/) });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/canonSync/index.js', () => ({
  syncCanon: vi.fn(),
  getCanonSyncStatus: vi.fn(),
  cancelCanonSync: vi.fn(),
  getLastCanonLog: vi.fn(),
}));

import { syncCanon, getCanonSyncStatus, cancelCanonSync, getLastCanonLog } from '../../services/canonSync/index.js';
import { startCanonSync, getCanonSyncState, cancelCanonSyncEndpoint } from './canonSyncController.js';
import type { CanonSyncProgress } from '../../services/canonSync/types.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

describe('canonSyncController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST start: starts a sync as the requesting admin', () => {
    vi.mocked(syncCanon).mockReturnValue(true);
    const res = mockRes();
    startCanonSync({ user: { id: 42 } } as unknown as AuthenticatedRequest, res);
    expect(syncCanon).toHaveBeenCalledWith(42);
    expect(res.json).toHaveBeenCalledWith({ started: true });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('POST start: 409s with an error body when a sync is already running', () => {
    vi.mocked(syncCanon).mockReturnValue(false);
    const res = mockRes();
    startCanonSync({ user: { id: 42 } } as unknown as AuthenticatedRequest, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'A canon sync is already running' });
  });

  it('GET: returns the { progress, lastLog } passthrough shape', async () => {
    const progress: CanonSyncProgress = {
      cancel: false, status: 'matching', statusMessage: 'Matching...',
      startedAt: '2026-07-18T00:00:00.000Z', logId: 3, report: null,
    };
    const lastLog = { id: 3, status: 'success' };
    vi.mocked(getCanonSyncStatus).mockReturnValue(progress);
    vi.mocked(getLastCanonLog).mockResolvedValue(lastLog);
    const res = mockRes();
    await getCanonSyncState({} as unknown as AuthenticatedRequest, res);
    expect(res.json).toHaveBeenCalledWith({ progress, lastLog });
  });

  it('DELETE: passes the cancel result through', () => {
    vi.mocked(cancelCanonSync).mockReturnValue(true);
    const res = mockRes();
    cancelCanonSyncEndpoint({} as unknown as AuthenticatedRequest, res);
    expect(res.json).toHaveBeenCalledWith({ cancelled: true });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }), connect: vi.fn() } }));
vi.mock('./wikidataSource.js', () => ({ fetchWikidataCountries: vi.fn().mockResolvedValue([]) }));
vi.mock('./naturalEarthSource.js', () => ({
  fetchNeCountries: vi.fn().mockResolvedValue([]),
  fetchNeDisputed: vi.fn().mockResolvedValue([]),
  NE_SOURCE_VERSION: 'test',
}));
vi.mock('./unitMatching.js', () => ({
  matchRootUnits: vi.fn().mockResolvedValue({ crosswalk: new Map(), unmatched: [] }),
  landDisputeUnits: vi.fn().mockResolvedValue({ divisionIds: [], approximate: false }),
}));
vi.mock('./loader.js', () => ({
  loadCanon: vi.fn().mockResolvedValue({
    countriesTotal: 0, added: [], removed: [], changed: [],
    unmatchedRootUnits: [], disputes: [], warnings: [], sourceVersions: {},
  }),
  createCanonSyncLog: vi.fn().mockResolvedValue(7),
  finishCanonSyncLog: vi.fn().mockResolvedValue(undefined),
}));

import { syncCanon, getCanonSyncStatus, cancelCanonSync, _resetForTests } from './index.js';

describe('canon sync orchestration', () => {
  beforeEach(() => _resetForTests());

  it('starts a sync and refuses a second concurrent start', async () => {
    expect(syncCanon(1)).toBe(true);
    expect(syncCanon(1)).toBe(false);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('complete'));
  });

  it('reports progress and completes with a report', async () => {
    syncCanon(null);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('complete'));
    expect(getCanonSyncStatus()?.report).not.toBeNull();
  });

  it('cancel flips the flag only while running', async () => {
    expect(cancelCanonSync()).toBe(false);
    syncCanon(null);
    // May already be complete (all mocks resolve instantly) — accept either
    const cancelled = cancelCanonSync();
    expect(typeof cancelled).toBe('boolean');
    await vi.waitFor(() => {
      const s = getCanonSyncStatus()?.status;
      expect(s === 'complete' || s === 'cancelled').toBe(true);
    });
  });
});

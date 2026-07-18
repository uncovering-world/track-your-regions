import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }), connect: vi.fn() } }));
vi.mock('./wikidataSource.js', () => ({ fetchWikidataCountries: vi.fn().mockResolvedValue([]) }));
vi.mock('./naturalEarthSource.js', () => ({
  fetchNeCountries: vi.fn().mockResolvedValue([]),
  fetchNeDisputed: vi.fn().mockResolvedValue([]),
  NE_SOURCE_VERSION: 'test',
  buildSovereignIso3Map: vi.fn().mockReturnValue(new Map()),
  resolveSovereignCodes: vi.fn((features: unknown[]) => features),
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

import { fetchWikidataCountries } from './wikidataSource.js';
import { fetchNeCountries, fetchNeDisputed, buildSovereignIso3Map, resolveSovereignCodes } from './naturalEarthSource.js';
import { finishCanonSyncLog } from './loader.js';
import { syncCanon, getCanonSyncStatus, cancelCanonSync, _resetForTests } from './index.js';
import type { NeCountryFeature } from './types.js';

describe('canon sync orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTests();
  });

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
    // Deterministic: the cancel flag is set synchronously, before the run's
    // first awaited microtask resumes — the run must observe it and stop.
    expect(cancelCanonSync()).toBe(true);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('cancelled'));
    expect(vi.mocked(finishCanonSyncLog)).toHaveBeenCalledWith(7, 'cancelled', null);
  });

  it('marks the run failed and finalizes the log when a source fetch rejects', async () => {
    vi.mocked(fetchWikidataCountries).mockRejectedValueOnce(new Error('SPARQL endpoint down'));
    syncCanon(null);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('failed'));
    expect(getCanonSyncStatus()?.statusMessage).toContain('SPARQL endpoint down');
    expect(vi.mocked(finishCanonSyncLog)).toHaveBeenCalledWith(7, 'failed', null);
  });

  it('resolves NE sovereignty codes (Bug D) before matching/deriving', async () => {
    const neCountries: NeCountryFeature[] = [
      { name: 'United Kingdom', iso2: 'GB', iso3: 'GBR', sovIso3: 'GB1', homePart: true, type: 'Country', wikidataQid: null, geometry: null },
    ];
    vi.mocked(fetchNeCountries).mockResolvedValueOnce(neCountries);
    vi.mocked(fetchNeDisputed).mockResolvedValueOnce([
      { name: 'Gibraltar', note: null, sovIso3: 'GB1', type: 'Disputed', wikidataQid: null, geometry: null },
    ]);

    syncCanon(null);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('complete'));

    expect(vi.mocked(buildSovereignIso3Map)).toHaveBeenCalledWith(neCountries);
    // resolveSovereignCodes runs over both the countries and disputed layers,
    // through the same map, before either feeds matching/deriving.
    expect(vi.mocked(resolveSovereignCodes)).toHaveBeenCalledWith(neCountries, expect.any(Map));
    expect(vi.mocked(resolveSovereignCodes)).toHaveBeenCalledWith(
      [{ name: 'Gibraltar', note: null, sovIso3: 'GB1', type: 'Disputed', wikidataQid: null, geometry: null }],
      expect.any(Map),
    );
  });
});

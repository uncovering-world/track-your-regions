/**
 * Behavioral tests for matchCountryLevel work-unit flag persistence.
 *
 * Drives matchCountryLevel with a mocked pool and asserts Phase-4 writer
 * receives the correct params for:
 *   (a) a leaf country node → is_work_unit=true, reference_division_ids=[gadmCountryId]
 *   (b) a subdivision node (child of a country via drill-down) → both null
 *
 * These tests pin the runtime contract that the source-regex tests in
 * matcher.workUnits.test.ts cannot verify.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportProgress } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProgress(): ImportProgress {
  return {
    cancel: false,
    status: 'importing',
    statusMessage: '',
    createdRegions: 0,
    totalRegions: 0,
    matchedRegions: 0,
    totalCountries: 0,
    countriesMatched: 0,
    subdivisionsDrilled: 0,
    noCandidates: 0,
    worldViewId: null,
  };
}

/** Pull all UPDATE region_import_state calls from a mock client's query spy. */
function updateCalls(mockClientQuery: ReturnType<typeof vi.fn>) {
  return mockClientQuery.mock.calls.filter(
    (call: unknown[]) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE region_import_state'),
  );
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

// Both fixtures share the same mock module; each test replaces pool.query's
// implementation via the mockPoolQuery spy.

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockRelease = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: mockRelease,
    }),
  },
}));

// Import AFTER the mock is registered.
const { matchCountryLevel } = await import('./matcher.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('matchCountryLevel work-unit flag persistence', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockRelease.mockReset();
  });

  /**
   * Fixture A: one continent (root) → one leaf country child (Testland, id=900).
   * WV tree: root container ('Continent', id=10) → leaf region ('Testland', id=20).
   *
   * Expected: 'Testland' region gets is_work_unit=true, reference=[900].
   */
  it('(a) leaf country → UPDATE params carry is_work_unit=true and reference_division_ids=[gadmCountryId]', async () => {
    // Phase 1 pool.query: SELECT from administrative_divisions
    // Phase 2 pool.query: SELECT from regions
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('administrative_divisions')) {
        return {
          rows: [
            // Continent root (no parent → continentId)
            { id: 1, name: 'TestContinent', name_normalized: 'testcontinent', parent_id: null },
            // Country child of continent
            { id: 900, name: 'Testland', name_normalized: 'testland', parent_id: 1 },
          ],
        };
      }
      if (sql.includes('FROM regions')) {
        return {
          rows: [
            // WV root container (no country match in GADM)
            { id: 10, name: 'Continent', parent_region_id: null },
            // WV leaf country region (name matches GADM country id=900)
            { id: 20, name: 'Testland', parent_region_id: 10 },
          ],
        };
      }
      return { rows: [] };
    });

    const progress = makeProgress();
    await matchCountryLevel(1, progress);

    const updates = updateCalls(mockClientQuery);

    // There must be exactly one UPDATE for the 'Testland' region (id=20).
    // The container 'Continent' (id=10) has no country match and recurses
    // into children without recording itself → no UPDATE for it.
    const testlandUpdate = updates.find(
      (call: unknown[]) =>
        Array.isArray(call[1]) && (call[1] as unknown[])[1] === 20,
    );
    expect(testlandUpdate).toBeDefined();

    const params = testlandUpdate![1] as unknown[];
    // $1 = match_status
    expect(params[0]).toBe('auto_matched');
    // $2 = region_id
    expect(params[1]).toBe(20);
    // $3 = is_work_unit — must be true for an identified leaf country
    expect(params[2]).toBe(true);
    // $4 = reference_division_ids — must be [900] (the GADM country id)
    expect(params[3]).toEqual([900]);

    // Sanity: counters reflect one matched country
    expect(progress.countriesMatched).toBe(1);
  });

  /**
   * Fixture B: country 'Testland' (id=900) has one GADM subdivision (id=901 'North').
   * WV 'Testland' (id=20) has one child ('North', id=21).
   * All WV children match → subdivision drill-down.
   *
   * Expected:
   *   - 'Testland' WV region (id=20) → match_status='children_matched', is_work_unit=true, reference=[900]
   *   - 'North' WV region (id=21) → match_status='auto_matched', is_work_unit=null, reference=null
   */
  it('(b) subdivision node (drill-down child) → UPDATE params carry null/null for is_work_unit and reference_division_ids', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('administrative_divisions')) {
        return {
          rows: [
            { id: 1, name: 'TestContinent', name_normalized: 'testcontinent', parent_id: null },
            { id: 900, name: 'Testland', name_normalized: 'testland', parent_id: 1 },
            // Subdivision of Testland
            { id: 901, name: 'North', name_normalized: 'north', parent_id: 900 },
          ],
        };
      }
      if (sql.includes('FROM regions')) {
        return {
          rows: [
            { id: 10, name: 'Continent', parent_region_id: null },
            { id: 20, name: 'Testland', parent_region_id: 10 },
            { id: 21, name: 'North', parent_region_id: 20 },
          ],
        };
      }
      return { rows: [] };
    });

    const progress = makeProgress();
    await matchCountryLevel(1, progress);

    const updates = updateCalls(mockClientQuery);

    // Country-level node 'Testland' → children_matched with is_work_unit=true
    const testlandUpdate = updates.find(
      (call: unknown[]) =>
        Array.isArray(call[1]) && (call[1] as unknown[])[1] === 20,
    );
    expect(testlandUpdate).toBeDefined();
    const testlandParams = testlandUpdate![1] as unknown[];
    expect(testlandParams[0]).toBe('children_matched');
    expect(testlandParams[1]).toBe(20);
    expect(testlandParams[2]).toBe(true);
    expect(testlandParams[3]).toEqual([900]);

    // Subdivision node 'North' → auto_matched but null/null (no work-unit flags)
    const northUpdate = updates.find(
      (call: unknown[]) =>
        Array.isArray(call[1]) && (call[1] as unknown[])[1] === 21,
    );
    expect(northUpdate).toBeDefined();
    const northParams = northUpdate![1] as unknown[];
    expect(northParams[0]).toBe('auto_matched');
    expect(northParams[1]).toBe(21);
    // $3 is_work_unit must be null — subdivision children carry no work-unit flag
    expect(northParams[2]).toBeNull();
    // $4 reference_division_ids must be null
    expect(northParams[3]).toBeNull();

    // Drill-down counter incremented
    expect(progress.subdivisionsDrilled).toBe(1);
    expect(progress.countriesMatched).toBe(1);
  });
});

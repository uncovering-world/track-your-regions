import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPoolQuery, mockClientQuery, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

import { matchHierarchical } from './matcherHierarchicalPolicy.js';
import { createInitialProgress } from './types.js';

/**
 * The division fixture. Two things in it are the point:
 *
 * - **Two divisions named "France"** (2 under Europe, 11 under Oceania) — the
 *   real base layer shards countries with overseas territories this way, and a
 *   global name index cannot choose between them.
 * - **"Osh" and "Osh (city)" as siblings** — Kyrgyzstan really holds both, and
 *   they are each other's prefix match, so the pair only resolves correctly if
 *   exact matches are bound before fuzzy ones.
 */
const DIVISIONS = [
  { id: 1, name: 'Europe', name_normalized: 'europe', parent_id: null },
  { id: 2, name: 'France', name_normalized: 'france', parent_id: 1 },
  { id: 3, name: 'Belgium', name_normalized: 'belgium', parent_id: 1 },
  { id: 4, name: 'Wallonia', name_normalized: 'wallonia', parent_id: 3 },
  // Two divisions named "Flanders" at different depths under Europe, reachable
  // through different branches. This is what makes the widened pool's traversal
  // order observable at all: a breadth-first pool reaches the depth-2 one (21)
  // first, a depth-first pool reaches the depth-3 one (34) first, because it
  // expands Europe's last child before its first.
  { id: 21, name: 'Flanders', name_normalized: 'flanders', parent_id: 2 },
  { id: 33, name: 'Talas', name_normalized: 'talas', parent_id: 30 },
  { id: 34, name: 'Flanders', name_normalized: 'flanders', parent_id: 33 },
  { id: 10, name: 'Oceania', name_normalized: 'oceania', parent_id: null },
  { id: 11, name: 'France', name_normalized: 'france', parent_id: 10 },
  { id: 30, name: 'Kyrgyzstan', name_normalized: 'kyrgyzstan', parent_id: 1 },
  { id: 31, name: 'Osh', name_normalized: 'osh', parent_id: 30 },
  { id: 32, name: 'Osh (city)', name_normalized: 'osh (city)', parent_id: 30 },
];

interface RegionRow { id: number; name: string; parent_region_id: number | null }

/** Run the policy over an import tree and return regionId → divisionId. */
async function run(regions: RegionRow[]): Promise<Map<number, number>> {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes('administrative_divisions')) return Promise.resolve({ rows: DIVISIONS });
    if (sql.includes('FROM regions')) return Promise.resolve({ rows: regions });
    return Promise.resolve({ rows: [] });
  });

  await matchHierarchical(1, createInitialProgress());

  const bindings = new Map<number, number>();
  for (const call of mockClientQuery.mock.calls) {
    const [sql, params] = call as [string, unknown[]];
    if (typeof sql === 'string' && sql.includes('INSERT INTO region_members')) {
      bindings.set(params[0] as number, params[1] as number);
    }
  }
  return bindings;
}

/** regionId → match_status, as written to region_import_state. */
async function runStatuses(regions: RegionRow[]): Promise<Map<number, string>> {
  await run(regions);
  const statuses = new Map<number, string>();
  for (const call of mockClientQuery.mock.calls) {
    const [sql, params] = call as [string, unknown[]];
    if (typeof sql === 'string' && sql.includes('region_import_state')) {
      statuses.set(params[1] as number, params[0] as string);
    }
  }
  return statuses;
}

describe('matchHierarchical', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockPoolConnect.mockClear();
  });

  it('resolves root nodes against root divisions', () => {
    // The country-anchored policy never matches this level at all — its index
    // holds countries only — which is why the mirror's continents came back as
    // no_candidates rather than as the divisions they were generated from.
    return run([{ id: 100, name: 'Europe', parent_region_id: null }]).then(bindings => {
      expect(bindings.get(100)).toBe(1);
    });
  });

  it('disambiguates a duplicated country name by its resolved ancestor', async () => {
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'France', parent_region_id: 100 },
    ]);
    // Exactly one France sits under a resolved Europe. Division 11 is the
    // Oceania shard and must not be chosen.
    expect(bindings.get(101)).toBe(2);
  });

  it('treats an unresolvable grouping node as transparent, not fatal', async () => {
    // "Benelux" corresponds to no single division. Its children must still
    // resolve — against Europe, the nearest *resolved* ancestor. Anchoring on a
    // resolved parent's direct children instead would strand this whole subtree.
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Benelux', parent_region_id: 100 },
      { id: 102, name: 'Belgium', parent_region_id: 101 },
    ]);
    expect(bindings.has(101)).toBe(false);
    expect(bindings.get(102)).toBe(3);
  });

  it('keeps descending past a transparent node to grandchildren', async () => {
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Benelux', parent_region_id: 100 },
      { id: 102, name: 'Belgium', parent_region_id: 101 },
      { id: 103, name: 'Wallonia', parent_region_id: 102 },
    ]);
    // Belgium resolved, so it — not Europe — anchors Wallonia.
    expect(bindings.get(103)).toBe(4);
  });

  it('binds exact matches before fuzzy ones, so sibling near-names do not collide', async () => {
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Kyrgyzstan', parent_region_id: 100 },
      { id: 102, name: 'Osh', parent_region_id: 101 },
      { id: 103, name: 'Osh (city)', parent_region_id: 101 },
    ]);
    expect(bindings.get(102)).toBe(31);
    // Not 31: the parenthetical is part of the division's name here, not a
    // Wikivoyage disambiguator to strip. Under the country-based policy this is
    // the one region in the whole base-layer import that matched wrongly.
    expect(bindings.get(103)).toBe(32);
  });

  it('never binds one division to two regions', async () => {
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Kyrgyzstan', parent_region_id: 100 },
      { id: 102, name: 'Osh', parent_region_id: 101 },
      { id: 103, name: 'Osh (city)', parent_region_id: 101 },
    ]);
    const bound = [...bindings.values()];
    expect(new Set(bound).size).toBe(bound.length);
  });

  it('marks a node it could not resolve for review rather than binding it', async () => {
    const statuses = await runStatuses([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Benelux', parent_region_id: 100 },
    ]);
    expect(statuses.get(100)).toBe('auto_matched');
    expect(statuses.get(101)).toBe('needs_review');
  });

  it('commits nothing when the import was cancelled mid-descent', async () => {
    // The country policy checks progress.cancel per node; this one did not, so a
    // cancelled base-layer import ran the whole descent, committed 3831 rows, and
    // left import_runs stuck in 'matching' while the admin had been told
    // "cancelled".
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes('administrative_divisions')) return Promise.resolve({ rows: DIVISIONS });
      if (sql.includes('FROM regions')) return Promise.resolve({ rows: [
        { id: 100, name: 'Europe', parent_region_id: null },
        { id: 101, name: 'France', parent_region_id: 100 },
      ] });
      return Promise.resolve({ rows: [] });
    });

    const progress = createInitialProgress();
    progress.cancel = true;
    await matchHierarchical(1, progress);

    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(progress.status).toBe('cancelled');
  });

  it('prefers the shallower of two identically-named divisions in the widened pool', async () => {
    // "Flanders" is not among Europe's direct children, so this widens to the
    // subtree — and two divisions there carry the name, at depth 2 (21, under
    // France) and depth 3 (34, under Talas). Both match at 700, so the traversal
    // order alone decides, and `findBestAmongChildren` keeps the first of a tier.
    //
    // This is the case that discriminates: under `queue.pop()` the pool reaches
    // 34 before 21, because the stack expands Europe's last child before its
    // first. Reverting the traversal turns this assertion red — which the more
    // obvious fixture (a namesake nested under a *direct child*) does not, since
    // a node's children are recorded when it is expanded and both orders
    // therefore place every direct child ahead of anything deeper.
    const bindings = await run([
      { id: 100, name: 'Europe', parent_region_id: null },
      { id: 101, name: 'Benelux', parent_region_id: 100 },
      { id: 102, name: 'Flanders', parent_region_id: 101 },
    ]);
    expect(bindings.get(102)).toBe(21);
  });

  it('writes nothing outside a transaction', async () => {
    await run([{ id: 100, name: 'Europe', parent_region_id: null }]);
    const first = mockClientQuery.mock.calls[0]?.[0];
    const last = mockClientQuery.mock.calls.at(-1)?.[0];
    expect(first).toBe('BEGIN');
    expect(last).toBe('COMMIT');
  });
});

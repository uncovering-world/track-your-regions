/**
 * What a world-view geometry run picks up, and in what order.
 *
 * A parent's geometry is the union of its children, so the run has to be a
 * closure rather than a filter: taking `geom IS NULL` alone never revisits a
 * parent that already has one, and a child computed after its parent stays
 * outside the parent's outline for good. Four of the eight top-level regions of
 * the Administrative world view were in that state — North America drew Mexico
 * and the Caribbean, 18.3 % of what it holds (#667).
 *
 * The order is the other half: deepest first, so a parent is unioned after the
 * children it is the union of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { loadGroupsToCompute } from './computationScope.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** The SQL of the group selection, for one run. */
async function selectionSqlFor(force: boolean): Promise<string> {
  mockedQuery.mockClear();
  await loadGroupsToCompute(901, force);
  const call = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('group_depth'));
  if (!call) throw new Error('the run issued no group selection');
  return String(call[0]).replace(/\s+/g, ' ');
}

describe('the regions a world-view run computes', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('takes a region with no geometry and every ancestor of one', async () => {
    const sql = await selectionSqlFor(false);
    expect(sql).toContain('needs_geometry AS');
    expect(sql).toContain('r.geom IS NULL');
    // The upward walk: a region joins because a descendant needs geometry.
    expect(sql).toContain('JOIN needs_geometry n ON n.parent_region_id = p.id');
    expect(sql).toContain('gd.id IN (SELECT id FROM needs_geometry)');
  });

  it('takes every region when forced, and only then', async () => {
    const forced = await selectionSqlFor(true);
    expect(forced).not.toContain('needs_geometry');
    expect(forced).not.toContain('geom IS NULL');
  });

  it('computes deepest first on both arms, since a parent is a union of its children', async () => {
    for (const force of [false, true]) {
      expect(await selectionSqlFor(force)).toContain('ORDER BY gd.depth DESC, gd.id');
    }
  });

  it('never recomputes a user-drawn boundary, on either arm (#283)', async () => {
    for (const force of [false, true]) {
      expect(await selectionSqlFor(force)).toContain('cg.is_custom_boundary IS NOT TRUE');
    }
  });

  /**
   * The closure walks a tree that may hold user-drawn boundaries, and they stop
   * it in both directions. A custom boundary with no geometry is not a region
   * awaiting computation -- it is a shape nobody has drawn yet, and computing
   * its parent would not change what the parent contains. A custom boundary
   * partway up is not made stale by a descendant either: its outline is drawn,
   * not unioned, so it does not move, and neither does anything above it.
   * Without the guard, an empty hand-drawn region would put a continent through
   * a hundred seconds of union for nothing.
   */
  it('lets a user-drawn boundary neither seed the closure nor pass it on', async () => {
    const sql = await selectionSqlFor(false);
    // The seed: only a derived region with nothing to draw.
    expect(sql).toContain('WHERE r.geom IS NULL AND r.is_custom_boundary IS NOT TRUE');
    // The upward walk: the region being climbed to is checked as well.
    expect(sql).toContain('JOIN regions pr ON pr.id = p.id');
    expect(sql).toContain('JOIN needs_geometry n ON n.parent_region_id = p.id WHERE pr.is_custom_boundary IS NOT TRUE');
  });
});

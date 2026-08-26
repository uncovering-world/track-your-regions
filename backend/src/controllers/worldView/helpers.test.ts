import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import {
  invalidateAncestorGeometry,
  invalidateRegionGeometry,
  ensureRegionMember,
  recomputeRegionGeometry,
  AncestorInvalidationFailed,
} from './helpers.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('invalidateAncestorGeometry', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
  });

  it('leaves the region itself alone and nulls only what is above it', async () => {
    // The region has just been computed and is correct; its ancestors are the
    // ones now describing a smaller world than they contain (#667). Nulling the
    // region too would undo the compute that called this.
    await invalidateAncestorGeometry(42);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/SELECT id FROM ancestors WHERE id <> \$1/);
    expect(sql).toMatch(/geom\s*=\s*NULL/);
    // The same guard the sibling function carries: a user-drawn shape is not
    // derived from its members (#283).
    expect(sql).toMatch(/is_custom_boundary IS NOT TRUE/);
  });

  it('walks the whole chain, not just the parent', async () => {
    // A country gaining geometry leaves its continent short as well as its
    // parent, so the recursion has to reach the root.
    await invalidateAncestorGeometry(9);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/WITH RECURSIVE ancestors/);
    expect(sql).toMatch(/JOIN ancestors a ON cg\.id = a\.parent_region_id/);
  });

  it('raises a lock error instead of swallowing it, unlike the edit arm', async () => {
    // The swallow's justification is "the other operation is handling it", which
    // holds for two edits nulling the same rows and not here: nothing else
    // revisits a parent that still has geometry, so a swallowed deadlock would
    // leave the ancestors stale, outside every later run's closure, with the run
    // reporting Complete and a console.log for a trace (#667).
    // Wrapped, so a caller's own catch can tell a failed invalidation from a
    // failed pipeline: the first happens after the write committed and must
    // never be downgraded to "skipped", the second wrote nothing at all.
    for (const message of ['deadlock detected', 'could not obtain lock on row in relation "regions"']) {
      mockedQuery.mockRejectedValueOnce(new Error(message));
      const failure = await invalidateAncestorGeometry(42).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(AncestorInvalidationFailed);
      expect((failure as Error).message).toContain('could not be marked stale');
      expect(((failure as AncestorInvalidationFailed).cause as Error).message).toBe(message);
    }
  });

  it('ends the walk at a hand-drawn boundary, as the run\'s own closure does', async () => {
    // The two halves of the mechanism have to agree about a custom boundary, or
    // they undo each other. loadGroupsToCompute stops its upward walk at one, so
    // on G (derived root) -> P (hand-drawn) -> C (derived, no geometry) the run
    // selects C alone. If this walk climbed through P it would null G anyway:
    // the root would leave the map -- tile_world_view_root_regions gates on
    // geom_3857 IS NOT NULL -- until a later run rebuilt the identical shape,
    // because P is drawn rather than unioned and C cannot have moved it.
    await invalidateAncestorGeometry(42);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    // Comments stripped first: the two terms are told apart by SQL keywords, and
    // prose about hand-drawn boundaries sits in both of them.
    const bare = sql.replace(/--[^\n]*/g, '');
    const recursiveTerm = bare.slice(bare.indexOf('UNION ALL'), bare.indexOf('UPDATE regions'));
    expect(recursiveTerm).toMatch(/is_custom_boundary IS NOT TRUE/);
    // The seed term stays unfiltered: it is the outer UPDATE guard that keeps a
    // hand-drawn starting region from being nulled (#283), and the walk must
    // still continue above one, since redrawing a shape by hand does leave
    // everything over it stale.
    const seedTerm = bare.slice(0, bare.indexOf('UNION ALL'));
    expect(seedTerm).toMatch(/WHERE id = \$1/);
    expect(seedTerm).not.toMatch(/is_custom_boundary/);
  });
});

describe('invalidateRegionGeometry', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
  });

  it('skips rows with is_custom_boundary IS TRUE — regression for #283', async () => {
    // The bug: invalidateRegionGeometry's recursive CTE includes the starting
    // region itself. Without the IS NOT TRUE guard, calling addMembers right
    // after createRegion(customGeometry) would null the just-created custom
    // shape and reset is_custom_boundary, then a subsequent recompute would
    // produce the merged-from-members geometry — losing the user's drawing.
    await invalidateRegionGeometry(42);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/is_custom_boundary IS NOT TRUE/);
    expect(sql).not.toMatch(/is_custom_boundary\s*=\s*false/);
  });

  it('still nulls geom + simplified columns', async () => {
    await invalidateRegionGeometry(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/geom\s*=\s*NULL/);
    expect(sql).toMatch(/geom_3857\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_low\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_medium\s*=\s*NULL/);
  });

  it('walks ancestors via the recursive CTE', async () => {
    await invalidateRegionGeometry(1);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/WITH RECURSIVE ancestors/);
    expect(sql).toMatch(/cg\.id\s*=\s*a\.parent_region_id/);
  });

  it('swallows lock/deadlock errors (concurrent invalidation safe)', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('could not obtain lock on row in relation "regions"'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();

    mockedQuery.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();
  });

  it('rethrows non-lock errors', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation "regions" does not exist'));
    await expect(invalidateRegionGeometry(99)).rejects.toThrow('does not exist');
  });
});

describe('ensureRegionMember — explicit ON CONFLICT arbiter (#378)', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('pins the conflict arbiter to the partial unique index (custom_geom IS NULL)', async () => {
    // A bare `ON CONFLICT DO NOTHING` works today (only one unique constraint on
    // region_members), but pinning the arbiter to the partial index prevents a
    // future unique constraint from silently changing the dedupe semantics.
    await ensureRegionMember(10, 20);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([10, 20]);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*region_id\s*,\s*division_id\s*\)\s*WHERE\s+custom_geom\s+IS\s+NULL\s+DO\s+NOTHING/i);
    // Regression: must not regress to the bare form.
    expect(sql).not.toMatch(/ON CONFLICT\s+DO\s+NOTHING\b/i);
  });

  it('inserts only the (region_id, division_id) columns, not custom_geom', async () => {
    await ensureRegionMember(1, 2);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/INSERT INTO region_members\s*\(\s*region_id\s*,\s*division_id\s*\)/i);
    expect(sql).not.toMatch(/custom_geom\s*[,)]/i); // not in column list or values
  });
});

/**
 * Regression test: recomputeRegionGeometry is a writer, and the SSE stream calls
 * it for every child without geometry before computing the region the curator
 * asked for. That parent's union is the one that times out, so if only the
 * parent invalidated, the child writes would have consumed the NULLs the run's
 * closure seeds on and left the parent unreachable (#667).
 */
describe('recomputeRegionGeometry marks the ancestors stale', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('does so after a write, from the writer itself', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ points: 4200 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: true, points: 4200 });
    const invalidation = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('RECURSIVE ancestors'));
    expect(invalidation).toBeDefined();
    expect(invalidation?.[1]).toEqual([7]);
    // The ancestors, not the region: it has just been written and is right.
    expect(String(invalidation?.[0])).toMatch(/SELECT id FROM ancestors WHERE id <> \$1/);
  });

  it('does not, when the merge wrote nothing', async () => {
    // No members and no computed children, or a hand-drawn boundary the UPDATE's
    // own guard excluded: nothing moved, so nothing above it is stale.
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: false });
    expect(mockedQuery.mock.calls.filter(([sql]) => String(sql).includes('RECURSIVE ancestors'))).toHaveLength(0);
  });
});

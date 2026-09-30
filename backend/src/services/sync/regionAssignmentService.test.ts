/**
 * Which points region assignment is allowed to place, and how it asks where they are.
 *
 * A point the source withdrew keeps its row now, and the row still carries a
 * coordinate that falls inside a region. Placed anyway, it would hold its
 * experience in a list the reader can no longer see it in — the withdrawn
 * point voting on where the object is.
 *
 * The manual assignments already on such a row are a different matter and are
 * left alone: this function only ever clears and rebuilds `auto` rows, so a
 * curator's claim outlives everything here.
 *
 * Where a point is placed is asked of the leaves first, through their geometry
 * cut into pieces, and of the other regions only for a point no leaf holds
 * (#851, ADR-0054). There is no database here, so the statement's shape is what
 * is pinned; that it places what the whole-geometry test placed was measured on
 * the development catalogue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (client: { query: (sql: string) => Promise<unknown> }) => {
    try {
      await client.query('ROLLBACK');
      return undefined;
    } catch (error) {
      return error as Error;
    }
  },
}));

import { pool } from '../../db/index.js';
import {
  assignExperiencesToRegions, assignRegionsForExperiences, cancelAssignment, getAssignmentStatus,
} from './regionAssignmentService.js';

const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

/**
 * A client that records what it is sent. `answer` may throw for a statement,
 * or run something between two steps, the way a cancel press lands.
 */
function fakeClient(answer: (sql: string) => void = () => {}) {
  const statements: string[] = [];
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push(sql);
      calls.push({ sql, params });
      answer(sql);
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements, calls };
}

const ONE_SOURCE = 'AND e.source_id = $2';
const THESE_EXPERIENCES = 'AND el.experience_id = ANY($2::int[])';

/** The direct step is the insert that reads the leaves' pieces; the ancestor walk inserts too. */
const isDirect = (sql: string) =>
  /INSERT INTO experience_location_regions/.test(sql) && /region_geom_pieces/.test(sql);

/** The direct statement a run's placement of the objects it moved sends. */
async function movedPathDirect(): Promise<string> {
  const { client, statements } = fakeClient();
  mockedConnect.mockResolvedValue(client);
  await assignRegionsForExperiences([42], 1);
  const direct = statements.find(isDirect);
  expect(direct, 'no direct placement statement was sent').toBeDefined();
  return direct as string;
}

/** The direct statement and its parameters a world view's rebuild sends, narrowed to one source or not. */
async function rebuildDirect(worldViewId: number, sourceId?: number): Promise<{ sql: string; params: unknown[] }> {
  const { client, calls } = fakeClient();
  mockedConnect.mockResolvedValue(client);
  await assignExperiencesToRegions(worldViewId, sourceId);
  const call = calls.find(c => isDirect(c.sql));
  expect(call, 'no direct placement statement was sent').toBeDefined();
  return { sql: String(call?.sql), params: call?.params as unknown[] };
}

/** The statement's first words, enough to tell the rebuild's steps apart. */
const head = (sql: string) => sql.trim().split(/\s+/).slice(0, 3).join(' ');

describe('assignRegionsForExperiences', () => {
  beforeEach(() => {
    mockedConnect.mockReset();
  });

  it('places the points still on offer, and not the ones a run withdrew', async () => {
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await assignRegionsForExperiences([42], 1);

    const containment = statements.find(s => /ST_Contains/.test(s));
    expect(containment).toBeDefined();
    // Both terms of the controllers' `offeredLocationSql`, repeated here as a literal
    // (the service cannot import a controller). Pinning the flag alone leaves a revert
    // of the existence term green, and that term is load-bearing in two directions
    // now: a point a curator declared gone must stop voting, and the verdict endpoint
    // calls placement *because* of it.
    expect(containment).toMatch(/el\.missing_since IS NULL AND el\.existence <> 'lost'/);
    // And the third term (ADR-0053): a point a curator turned down is still
    // pending and never to be published, so no region may count it.
    expect(containment).toMatch(/el\.refused_at IS NULL/);
  });

  it('still clears the auto rows of a withdrawn point, so it stops voting', async () => {
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await assignRegionsForExperiences([42], 1);

    // The clear is deliberately unfiltered: a point withdrawn *since* the last
    // placement has auto rows from when it was offered, and leaving them would
    // keep the experience in that region for ever.
    const clear = statements.find(s => /DELETE FROM experience_location_regions/.test(s));
    expect(clear).toBeDefined();
    expect(clear).not.toMatch(/missing_since/);
  });
});

describe('assignExperiencesToRegions', () => {
  beforeEach(() => {
    mockedConnect.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('places the points still on offer on the full-rebuild path too', async () => {
    // The other entry point places what one run moved; this one rebuilds a
    // whole world view, and an admin reaches for it exactly when the
    // assignments are already wrong. A withdrawn point voting there would put
    // its experience back into a region no reader can see it in.
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await assignExperiencesToRegions(4242);

    const containment = statements.find(s => /ST_Contains/.test(s));
    expect(containment).toBeDefined();
    // Both terms on the full-rebuild path too, for the reason above: the two paths
    // were separate statements once, and a revert on either stayed green.
    expect(containment).toMatch(/el\.missing_since IS NULL AND el\.existence <> 'lost'/);
    // And the third term (ADR-0053): a point a curator turned down is still
    // pending and never to be published, so no region may count it.
    expect(containment).toMatch(/el\.refused_at IS NULL/);
  });

  it('clears and rebuilds in one transaction on one client, and stamps the world view inside it', async () => {
    // Autocommit statements on the pool left a window between the clear and
    // the inserts: a restart in it left the world view without its automatic
    // assignments, and nothing said so (#1152).
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);
    const poolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
    poolQuery.mockClear();

    const progress = await assignExperiencesToRegions(4250);

    expect(statements.map(head)).toEqual([
      'BEGIN',
      'DELETE FROM experience_location_regions',
      'DELETE FROM experience_regions',
      'WITH offered AS',
      'WITH RECURSIVE ancestors',
      'INSERT INTO experience_regions',
      'UPDATE world_views SET',
      'COMMIT',
    ]);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeUndefined();
    expect(progress.status).toBe('complete');
  });

  it('rolls back when a step throws, and says the assignments from before stand', async () => {
    const boom = new Error('canceling statement due to statement timeout');
    const { client, statements } = fakeClient((sql) => {
      if (/WITH RECURSIVE ancestors/.test(sql)) throw boom;
    });
    mockedConnect.mockResolvedValue(client);

    await expect(assignExperiencesToRegions(4251)).rejects.toBe(boom);

    expect(statements.map(head)).toContain('ROLLBACK');
    expect(statements.map(head)).not.toContain('COMMIT');
    expect(statements.some(s => /UPDATE world_views/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(getAssignmentStatus(4251)).toMatchObject({
      status: 'failed',
      statusMessage: expect.stringContaining('the assignments from before stand'),
    });
  });

  it('destroys a client whose ROLLBACK failed too, rather than pooling it mid-transaction', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { client } = fakeClient((sql) => {
      if (/^DELETE FROM experience_regions/.test(sql.trim()) || sql === 'ROLLBACK') throw lost;
    });
    mockedConnect.mockResolvedValue(client);

    await expect(assignExperiencesToRegions(4252)).rejects.toBe(lost);

    expect(client.release).toHaveBeenCalledWith(lost);
  });

  it('rolls back a cancel that lands after the clear, and commits nothing', async () => {
    const { client, statements } = fakeClient((sql) => {
      if (/^DELETE FROM experience_regions/.test(sql.trim())) cancelAssignment(4253);
    });
    mockedConnect.mockResolvedValue(client);

    const progress = await assignExperiencesToRegions(4253);

    expect(progress).toMatchObject({
      status: 'cancelled', statusMessage: 'Cancelled; the assignments from before stand.',
    });
    expect(statements.map(head)).toEqual([
      'BEGIN',
      'DELETE FROM experience_location_regions',
      'DELETE FROM experience_regions',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('the direct step both ways in share', () => {
  beforeEach(() => {
    mockedConnect.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('is one statement, whatever narrows the points', async () => {
    // It was two, a run's and the rebuild's, each carrying the whole test; a
    // change to one of them was a change to where half the catalogue's points go.
    const moved = await movedPathDirect();
    const whole = await rebuildDirect(4243);
    const oneSource = await rebuildDirect(4244, 7);

    expect(moved).toContain(THESE_EXPERIENCES);
    expect(oneSource.sql).toContain(ONE_SOURCE);
    expect(oneSource.params).toEqual([4244, 7]);
    expect(whole.sql).not.toContain('$2');
    expect(whole.params).toEqual([4243]);
    expect(moved.replace(THESE_EXPERIENCES, '')).toBe(whole.sql);
    expect(oneSource.sql.replace(ONE_SOURCE, '')).toBe(whole.sql);
  });

  it('tests a point against the leaves through their pieces, and a point on a cut against the whole leaf', async () => {
    const { sql } = await rebuildDirect(4245);
    expect(sql).toMatch(/JOIN region_geom_pieces p\s+ON p\.geom && o\.location AND ST_Intersects\(p\.geom, o\.location\)/);
    // The leaf is looked up by key for each piece that holds a point. Joined
    // plainly, a large placement hash-joined every leaf of the world view first.
    // And a former leaf keeps its pieces until its next geometry write: the
    // is_leaf term is what keeps them from answering.
    expect(sql).toMatch(/CROSS JOIN LATERAL \(\s+SELECT r\.geom\s+FROM regions r\s+WHERE r\.id = p\.region_id AND r\.world_view_id = \$1 AND r\.is_leaf\s+OFFSET 0\s+\) leaf/);
    // Inside the leaf but on the boundary of two pieces, ST_Contains on either
    // piece says no; only that case pays for the whole leaf.
    expect(sql).toMatch(/CASE WHEN ST_Contains\(p\.geom, o\.location\) THEN true\s+ELSE ST_Contains\(leaf\.geom, o\.location\) END/);
  });

  it('asks the other regions only about the points no leaf holds, one region at a time', async () => {
    const { sql } = await rebuildDirect(4246);
    // Materialized on its own, or the planner tests every point against the
    // continents first and drops the held ones afterwards.
    expect(sql).toMatch(/unheld AS MATERIALIZED \(\s+SELECT o\.id, o\.location\s+FROM offered o\s+WHERE NOT EXISTS \(SELECT 1 FROM leaf_hits h WHERE h\.location_id = o\.id\)/);
    // The regions an unheld point's box touches, through their GiST index, with
    // the points grouped per region: a region nothing comes near is never read.
    expect(sql).toMatch(/candidates AS MATERIALIZED \(\s+SELECT r\.id AS region_id, array_agg\(u\.id\) AS location_ids, array_agg\(u\.location\) AS locations\s+FROM unheld u\s+JOIN regions r ON r\.geom && u\.location/);
    expect(sql).toMatch(/GROUP BY r\.id\s+\),\s+whole_hits AS/);
    // Then region by region, so consecutive tests share its prepared geometry.
    expect(sql).toMatch(/FROM candidates c\s+JOIN regions r ON r\.id = c\.region_id\s+CROSS JOIN LATERAL \(\s+SELECT c\.location_ids\[i\] AS location_id\s+FROM generate_subscripts\(c\.location_ids, 1\) AS i\s+WHERE ST_Contains\(r\.geom, c\.locations\[i\]\)\s+OFFSET 0\s+\) x/);
    // The two passes never share a point; ON CONFLICT stays for the manual rows
    // the clear leaves in place.
    expect(sql).toMatch(/FROM leaf_hits\s+UNION ALL\s+SELECT location_id, region_id, 'auto' FROM rest_hits\s+ON CONFLICT \(location_id, region_id\) DO NOTHING/);
  });

  it('asks a leaf without pieces whole, and still puts it before the non-leaves', async () => {
    // A database that re-applied the schema but has not run migration 054 has
    // the table and no pieces, and a leaf whose cut failed has none either:
    // placement there must be slow, not wrong. A gate of "not a leaf" would drop
    // every point from every such leaf.
    const { sql } = await rebuildDirect(4247);
    expect(sql).toContain('AND NOT (r.is_leaf AND EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id))');
    expect(sql).not.toContain('AND NOT r.is_leaf');
    // And a point such a leaf holds gets no row in a non-leaf whose outline also
    // covers it: with Vatican City uncut, St Peter's must not be listed under
    // Italy again. Missing pieces cost time and never change a row.
    expect(sql).toMatch(/whole_hits AS MATERIALIZED \(\s+SELECT x\.location_id, r\.id AS region_id, r\.is_leaf/);
    expect(sql).toMatch(/FROM whole_hits w\s+WHERE w\.is_leaf\s+OR NOT EXISTS \(SELECT 1 FROM whole_hits l WHERE l\.location_id = w\.location_id AND l\.is_leaf\)/);
  });
});

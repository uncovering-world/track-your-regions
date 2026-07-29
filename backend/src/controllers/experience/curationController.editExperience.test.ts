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

import { editExperience } from './curationController.js';

const EXPERIENCE_ID = 281;
const CATEGORY_ID = 1;
// The experience of #450 sits in two regions. IN_SCOPE is the one the curator
// covers; the bug was that an unordered `LIMIT 1` could hand back the other.
const IN_SCOPE_REGION = 20;
const REGION_CURATOR = { id: 7, role: 'curator' };
const ADMIN = { id: 1, role: 'admin' };

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * Queues what `pool.query` answers, in the order `editExperience` asks: the
 * experience row, then the scope resolution (skipped for admins). `scope`
 * stands in for what Postgres would answer for the scope predicate; the
 * assertions below separately check that the SQL sent actually encodes it.
 */
function queueQueries(opts: {
  experienceRows?: unknown[];
  scope?: { unrestricted: boolean; scoped_region_id: number | null };
}) {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockPoolConnect.mockClear();
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockPoolQuery.mockResolvedValueOnce({
    rows: opts.experienceRows ?? [{ id: EXPERIENCE_ID, category_id: CATEGORY_ID, name: 'Old name', curated_fields: [] }],
  });
  if (opts.scope) mockPoolQuery.mockResolvedValueOnce({ rows: [opts.scope] });
}

function callEditExperience(user: { id: number; role: string }) {
  const res = makeRes();
  return {
    res,
    done: editExperience(
      { params: { id: String(EXPERIENCE_ID) }, body: { name: 'New name' }, user } as never,
      res as never,
    ),
  };
}

/** The `region_id` parameter of the `edited` row written inside the transaction. */
function loggedRegionId(): unknown {
  const insert = mockClientQuery.mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('experience_curation_log'),
  ) as [string, unknown[]] | undefined;
  expect(insert, 'expected an experience_curation_log insert').toBeDefined();
  return insert![1][2];
}

describe('editExperience scope', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockPoolConnect.mockClear();
  });

  it('resolves scope against every region of the experience, not one of them', async () => {
    queueQueries({ scope: { unrestricted: false, scoped_region_id: IN_SCOPE_REGION } });
    const { res, done } = callEditExperience(REGION_CURATOR);
    await done;

    const [sql, params] = mockPoolQuery.mock.calls[1] as [string, unknown[]];
    // The intersection is the grant: the experience's assignments against the
    // curator's closure. Nothing picks a representative region.
    expect(sql).toMatch(/curator_scoped_regions/);
    expect(sql).toMatch(/experience_regions er[\s\S]*JOIN curator_scoped_regions s ON s\.id = er\.region_id/);
    expect(sql).not.toMatch(/LIMIT 1/);
    expect(params).toEqual([REGION_CURATOR.id, EXPERIENCE_ID, CATEGORY_ID]);

    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('never asks about one arbitrary region on the way to the scope check', async () => {
    // The bug: `SELECT region_id FROM experience_regions ... LIMIT 1`, whose
    // answer both decided the 403 and landed on the audit row.
    queueQueries({ scope: { unrestricted: false, scoped_region_id: IN_SCOPE_REGION } });
    const { done } = callEditExperience(REGION_CURATOR);
    await done;

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    const [firstSql] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(firstSql).toMatch(/FROM experiences/);
    expect(firstSql).not.toMatch(/experience_regions/);
  });

  it('logs the edit under a region the curator covers', async () => {
    queueQueries({ scope: { unrestricted: false, scoped_region_id: IN_SCOPE_REGION } });
    const { res, done } = callEditExperience(REGION_CURATOR);
    await done;

    // Since #442 the log is filtered per row, so a region outside the caller's
    // scope here would hide the edit from the curator who made it.
    expect(loggedRegionId()).toBe(IN_SCOPE_REGION);
    // And the pick among the covered regions is fixed rather than left to plan
    // order — replacing one arbitrary region with another would not be a fix.
    const [scopeSql] = mockPoolQuery.mock.calls[1] as [string, unknown[]];
    expect(scopeSql).toMatch(/MIN\(er\.region_id\)/);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, experienceId: EXPERIENCE_ID }),
    );
  });

  it('refuses a curator whose scope covers none of the experience regions', async () => {
    queueQueries({ scope: { unrestricted: false, scoped_region_id: null } });
    const { res, done } = callEditExperience(REGION_CURATOR);
    await done;

    expect(res.status).toHaveBeenCalledWith(403);
    // Nothing may be written — not the update, not an audit row.
    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('names no region on the audit row for a global or category curator', async () => {
    // Their authority came from no region in particular, and a row naming none
    // stays visible to every curator who can reach the log.
    queueQueries({ scope: { unrestricted: true, scoped_region_id: null } });
    const { res, done } = callEditExperience(REGION_CURATOR);
    await done;

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(loggedRegionId()).toBeNull();
  });

  it('names no region even when an unrestricted curator also covers one', async () => {
    queueQueries({ scope: { unrestricted: true, scoped_region_id: IN_SCOPE_REGION } });
    const { done } = callEditExperience(REGION_CURATOR);
    await done;

    expect(loggedRegionId()).toBeNull();
  });

  it('lets an admin edit without asking the database about scope', async () => {
    queueQueries({});
    const { res, done } = callEditExperience(ADMIN);
    await done;

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(loggedRegionId()).toBeNull();
  });

  it('answers 404 for an experience that does not exist', async () => {
    queueQueries({ experienceRows: [] });
    const { res, done } = callEditExperience(REGION_CURATOR);
    await done;

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

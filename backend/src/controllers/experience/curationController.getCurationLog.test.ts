import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getCurationLog } from './curationController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const EXPERIENCE_ID = 281;
const REGION_CURATOR = { id: 7, role: 'curator' };
const ADMIN = { id: 1, role: 'admin' };

// The leak from #442: experience 281 sits in a region the curator is scoped to
// and in one they are not, and the log holds a row for each.
const IN_SCOPE_ROW = {
  id: 1, action: 'edited', region_id: 20, region_name: 'Gyeongju', curator_name: 'Curator',
};

/**
 * Queues the `pool.query` resolutions `getCurationLog` consumes in order: the
 * experience row, the scope resolution (skipped for admins), then the log
 * rows. `scope` stands in for what Postgres would answer for the scope
 * predicate; the assertions below separately check that the SQL and params
 * sent actually encode that predicate.
 */
function queueQueries(opts: {
  experienceRows?: unknown[];
  scope?: { unrestricted: boolean; has_scoped_region: boolean };
  logRows?: unknown[];
}) {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValueOnce({ rows: opts.experienceRows ?? [{ category_id: 1 }] });
  if (opts.scope) mockedQuery.mockResolvedValueOnce({ rows: [opts.scope] });
  mockedQuery.mockResolvedValueOnce({ rows: opts.logRows ?? [IN_SCOPE_ROW] });
}

function callGetCurationLog(user: { id: number; role: string }) {
  const res = makeRes();
  return {
    res,
    done: getCurationLog({ params: { id: String(EXPERIENCE_ID) }, user } as never, res as never),
  };
}

describe('getCurationLog scope', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('restricts the returned rows to the regions a region-scoped curator covers', async () => {
    queueQueries({ scope: { unrestricted: false, has_scoped_region: true } });
    const { res, done } = callGetCurationLog(REGION_CURATOR);
    await done;

    const [sql, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    // The rows themselves carry the predicate: a log row survives only if the
    // curator is unrestricted, the row names no region, or the row's region
    // falls under one of their assignments.
    expect(sql).toMatch(/curator_scoped_regions/);
    expect(sql).toMatch(/\$3::boolean\s+OR\s+cl\.region_id IS NULL\s+OR\s+cl\.region_id IN \(SELECT id FROM curator_scoped_regions\)/);
    expect(params).toEqual([REGION_CURATOR.id, EXPERIENCE_ID, false]);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith([IN_SCOPE_ROW]);
  });

  it('resolves scope against every region the experience is assigned to, not one of them', async () => {
    queueQueries({ scope: { unrestricted: false, has_scoped_region: true } });
    const { done } = callGetCurationLog(REGION_CURATOR);
    await done;

    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/EXISTS[\s\S]*experience_regions er[\s\S]*curator_scoped_regions/);
    expect(sql).not.toMatch(/LIMIT 1/);
    expect(params).toEqual([REGION_CURATOR.id, EXPERIENCE_ID, 1]);
  });

  it('admits a curator whose scope shows only in the log, not in the assignments', async () => {
    // Removing an experience from a region deletes the assignment and logs
    // that removal, so assignments alone would refuse the curator the record
    // of their own last act in that region.
    queueQueries({ scope: { unrestricted: false, has_scoped_region: true } });
    const { done } = callGetCurationLog(REGION_CURATOR);
    await done;

    const [sql] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(
      /EXISTS[\s\S]*experience_regions er[\s\S]*OR EXISTS[\s\S]*experience_curation_log cl[\s\S]*curator_scoped_regions/,
    );
  });

  it('never skips the scope check on the way to the log', async () => {
    // The hole this closes: the old code looked up one region of the
    // experience first and checked scope only `if (regionId)`, so an
    // experience assigned to no region was readable by any curator. Nothing
    // may stand between the experience lookup and the scope resolution.
    queueQueries({ scope: { unrestricted: false, has_scoped_region: false } });
    const { res, done } = callGetCurationLog(REGION_CURATOR);
    await done;

    const [firstSql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(firstSql).not.toMatch(/experience_regions/);
    expect(firstSql).not.toMatch(/LIMIT 1/);
    expect(mockedQuery.mock.calls[1]?.[0]).toMatch(/has_scoped_region/);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses a curator whose scope covers none of the experience regions', async () => {
    queueQueries({ scope: { unrestricted: false, has_scoped_region: false } });
    const { res, done } = callGetCurationLog(REGION_CURATOR);
    await done;

    expect(res.status).toHaveBeenCalledWith(403);
    // The log query must not run at all — no rows leave the database.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('leaves the rows unfiltered for a global or category curator', async () => {
    queueQueries({ scope: { unrestricted: true, has_scoped_region: false } });
    const { res, done } = callGetCurationLog(REGION_CURATOR);
    await done;

    const [, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(params).toEqual([REGION_CURATOR.id, EXPERIENCE_ID, true]);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('leaves the rows unfiltered for an admin without asking the database about scope', async () => {
    queueQueries({});
    const { res, done } = callGetCurationLog(ADMIN);
    await done;

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([ADMIN.id, EXPERIENCE_ID, true]);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('answers 404 for an experience that does not exist', async () => {
    queueQueries({ experienceRows: [] });
    const { res, done } = callGetCurationLog(REGION_CURATOR);
    await done;

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});

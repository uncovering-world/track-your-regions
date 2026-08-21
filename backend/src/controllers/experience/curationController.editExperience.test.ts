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
  // Mirrors the real one, returning the rollback's own failure — which is
  // what `client.release()` needs to destroy a client carrying an open
  // transaction. A stub that swallowed it would make that untestable.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { editExperience } from './curationController.js';
import { OBJECT_LOCK } from '../../db/locks.js';

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
  lockedCurated?: string[];
  lockedName?: string;
}) {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockPoolConnect.mockClear();
  // The claim the transaction re-reads under its lock, which is what the
  // union is built from — not the unlocked read that answers 404 and scope.
  mockClientQuery.mockImplementation(async (sql: string) =>
    (typeof sql === 'string' && sql.includes(OBJECT_LOCK))
      ? { rows: [{ curated_fields: opts.lockedCurated ?? [], name: opts.lockedName ?? 'Old name' }] }
      : { rows: [] });
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

describe('editExperience claim locking', () => {
  it('builds the claim union from the locked row, not the earlier read', async () => {
    // accept-source released 'name' between the two reads. Unioning the stale
    // value would put the claim back over a value the curator just accepted,
    // and the conflict would return at the next run.
    queueQueries({
      experienceRows: [{ id: EXPERIENCE_ID, category_id: CATEGORY_ID, name: 'Old name', curated_fields: ['name', 'description'] }],
      lockedCurated: [],
    });

    const { res, done } = callEditExperience(ADMIN);
    await done;

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ curatedFields: ['name'] }));
  });

  it('audits the values the lock guarantees, not the ones read before it', async () => {
    queueQueries({
      experienceRows: [{ id: EXPERIENCE_ID, category_id: CATEGORY_ID, name: 'Stale name', curated_fields: [] }],
      lockedName: 'Name at lock time',
    });

    const { done } = callEditExperience(ADMIN);
    await done;

    const insert = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('experience_curation_log'),
    ) as [string, unknown[]] | undefined;
    // An `old` value read before the lock names a version that was already
    // gone by the time the edit was written. `details` is the last parameter:
    // (experience_id, curator_id, 'edited', region_id, details)
    const details = String(insert![1].at(-1));
    expect(details).toContain('Name at lock time');
    expect(details).not.toContain('Stale name');
  });

  it('takes the lock before writing anything', async () => {
    queueQueries({ lockedCurated: [] });

    const { done } = callEditExperience(ADMIN);
    await done;

    const order = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    const lock = order.findIndex(sql => sql.includes(OBJECT_LOCK));
    const update = order.findIndex(sql => sql.includes('UPDATE experiences'));
    expect(lock).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(lock);
  });
});

describe('editExperience and the picture credit', () => {
  /** The metadata patch of the UPDATE, parsed back out of its parameters. */
  function metadataPatch(): Record<string, unknown> | undefined {
    const update = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE experiences'),
    ) as [string, unknown[]] | undefined;
    expect(update, 'expected an UPDATE').toBeDefined();
    const patch = (update![1] as unknown[]).find(
      (v) => typeof v === 'string' && v.startsWith('{') && v.includes('imageCredit'),
    );
    return patch ? JSON.parse(String(patch)) : undefined;
  }

  function editWith(body: Record<string, unknown>) {
    const res = makeRes();
    return editExperience(
      { params: { id: String(EXPERIENCE_ID) }, body, user: ADMIN } as never,
      res as never,
    );
  }

  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockPoolConnect.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });

  it('drops the old credit when the curator replaces the picture', async () => {
    queueQueries({ lockedCurated: [] });

    // Commons is unreachable in this test, so nothing can be resolved — which
    // is exactly the case that must not leave the previous photographer's name
    // under a photograph they did not take.
    await editWith({ imageUrl: 'https://example.org/a-photo-the-curator-found.jpg' });

    expect(metadataPatch()).toEqual({ imageCredit: null });
  });

  /** The `curated_fields` array of the UPDATE. */
  function claims(): string {
    const update = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE experiences'),
    ) as [string, unknown[]];
    // The `curated_fields` parameter is the JSON array among them.
    return String((update[1] as unknown[]).find(
      (v) => typeof v === 'string' && v.startsWith('['),
    ));
  }

  it('does not claim a credit it could not resolve', async () => {
    queueQueries({ lockedCurated: [] });

    // Commons is unreachable here, so the credit is null. Claiming that would be
    // permanent — no later run could fill it — and one slow response would leave
    // a real photograph uncredited for good. The picture itself is still
    // claimed, and the sync writes no credit for a picture it does not own.
    await editWith({ imageUrl: 'https://example.org/a-photo-the-curator-found.jpg' });

    expect(claims()).toContain('image_url');
    expect(claims()).not.toContain('metadata.imageCredit');
  });

  it('still claims a website the curator cleared', async () => {
    queueQueries({ lockedCurated: [] });

    // The null filter is about the credit alone. Clearing a website is a
    // decision, and an unclaimed one would be written straight back by the
    // next run.
    await editWith({ websiteUrl: '' });

    expect(claims()).toContain('metadata.website');
  });

  it('claims the credit when it resolved one', async () => {
    queueQueries({ lockedCurated: [] });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({ query: { pages: [{
        title: 'File:Bruges.jpg',
        imageinfo: [{ extmetadata: { Artist: { value: 'Jane Doe' } } }],
      }] } }),
    })));

    await editWith({
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Bruges.jpg',
    });

    expect(claims()).toContain('metadata.imageCredit');
    expect(metadataPatch()?.imageCredit).toMatchObject({ author: 'Jane Doe' });
  });

  it('leaves the credit alone when the edit is not about the picture', async () => {
    queueQueries({ lockedCurated: [] });

    await editWith({ name: 'New name' });

    expect(metadataPatch()).toBeUndefined();
  });
});

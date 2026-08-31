/**
 * Tests for a curator's correction to one work.
 *
 * Four rules here cannot be read off the column names:
 *
 * The work is reached through the museum the curator names. A work hangs in more
 * than one venue and carries no scope of its own, so "does this caller cover it"
 * is a question about the museum in the path and about nothing else — and a work
 * that does not hang in that museum is not a work this caller may correct.
 *
 * The claim is a *union*, re-read under the write lock: a curator fixing an
 * attribution must not hand back a name they claimed last month, and an
 * `accept-source` releasing a claim in between must not be undone.
 *
 * An empty list of makers is a value, not an absence. "Nobody knows who made
 * this" is an answer a curator can give, and COALESCE cannot tell it from "leave
 * this alone".
 *
 * The audit row names only the keys the edit touched. The queue's attribution
 * asks `details ? '<column>'` to find who claimed a field, so a key present and
 * null would make a rename answer for the attribution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { editWork } from './workEditController.js';
import { OBJECT_LOCK } from '../../db/locks.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
/** The Louvre and the Borghese Gladiator: the correction this endpoint exists for. */
const EXPERIENCE_ID = 6212;
const TREASURE_ID = 2443;
const MUSEUM_CATEGORY_ID = 2;

function makeClient(stored: Record<string, unknown> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('FOR UPDATE')) {
          return {
            rows: stored.missing === true ? [] : [{
              name: 'Borghese Gladiator',
              artists: ['Agasias of Ephesus', 'Nicolas Cordier'],
              year: -100,
              curated_fields: [],
              ...stored,
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

/** The link exists and the caller's scope covers the museum. */
function foundAndPermitted() {
  mockedQuery.mockResolvedValueOnce({ rows: [{ category_id: MUSEUM_CATEGORY_ID }] });
  mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] });
}

function request(body: Record<string, unknown>) {
  return {
    params: { id: String(EXPERIENCE_ID), treasureId: String(TREASURE_ID) },
    body,
    user: CURATOR,
  };
}

const only = (queries: Array<{ sql: string; params: unknown[] }>, fragment: string) => {
  const found = queries.filter(q => q.sql.includes(fragment));
  if (found.length !== 1) throw new Error(`${found.length} statements contain ${fragment}`);
  return found[0];
};

describe('editWork', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('answers 404 for a work that does not hang in this museum', async () => {
    // The link is the proof, and its absence is not "no permission": the caller
    // may well curate this museum. It simply holds no such work.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('refuses a curator whose scope does not reach the museum', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ category_id: MUSEUM_CATEGORY_ID }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(403);
    // Nothing was opened, so nothing has to be rolled back.
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('writes the makers a curator gave, and claims them against the next run', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);
    const res = makeRes();

    // Agasias of Ephesus carved it; Nicolas Cordier restored an arm in the 17th
    // century, which is not the same claim on a work.
    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, res as never);

    const write = only(queries, 'UPDATE treasures');
    expect(write.params[3]).toEqual(['Agasias of Ephesus']);
    expect(JSON.parse(String(write.params[6]))).toEqual(['artists']);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, claimed: ['artists'] }),
    );
  });

  it('locks the museum before the work, in that order', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ name: 'Borghese Gladiator' }) as never, makeRes() as never);

    // OBJECT_LOCK's rule: the audit row reaches `experiences` whatever this
    // handler names, so taking the work first would hold one row and wait for
    // the other — and two writers in two orders close a cycle.
    const order = queries.map(q => q.sql);
    const museum = order.findIndex(sql => sql.includes(OBJECT_LOCK));
    const work = order.findIndex(sql => sql.includes('FOR UPDATE') && sql.includes('treasures'));
    expect(museum).toBeGreaterThanOrEqual(0);
    expect(work).toBeGreaterThan(museum);
  });

  it('adds to the claims a work already carries rather than replacing them', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ curated_fields: ['name'] });
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, makeRes() as never);

    // A curator who corrected the title last month must not hand it back by
    // correcting the attribution today.
    expect(JSON.parse(String(only(queries, 'UPDATE treasures').params[6])))
      .toEqual(['name', 'artists']);
  });

  it('reads the claim set under the write lock, not from an earlier query', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ curated_fields: ['name'] });
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ year: -100 }) as never, makeRes() as never);

    // `accept-source` takes keys back off a claim set, and one landing between an
    // unlocked read and this write would be undone by the rewrite.
    const read = only(queries, 'FOR UPDATE');
    expect(read.sql).toContain('curated_fields');
    expect(queries.indexOf(read)).toBeLessThan(queries.indexOf(only(queries, 'UPDATE treasures')));
  });

  it('lets a curator say that nobody knows who made a work', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ artists: [] }) as never, makeRes() as never);

    // An empty list is a value: *Salvator Mundi* reading "Leonardeschi" is worse
    // than reading nothing, and COALESCE cannot tell the two requests apart.
    const write = only(queries, 'UPDATE treasures');
    expect(write.params[2]).toBe(true);
    expect(write.params[3]).toEqual([]);
  });

  it('leaves alone what the request did not name', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ name: 'Borghese Gladiator' }) as never, makeRes() as never);

    const write = only(queries, 'UPDATE treasures');
    // The two booleans that say "this request was about that column".
    expect(write.params[2]).toBe(false);
    expect(write.params[4]).toBe(false);
    expect(JSON.parse(String(write.params[6]))).toEqual(['name']);
  });

  it('records only the fields the edit touched, with what they were', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, makeRes() as never);

    const log = only(queries, 'experience_curation_log');
    // The action is a literal in the statement, not a parameter, and it has to
    // be one the table's CHECK admits — migration 040 widens it.
    expect(log.sql).toContain("'work_edited'");
    const details = JSON.parse(String(log.params[3]));
    expect(details).toEqual({
      treasureId: TREASURE_ID,
      artists: { old: ['Agasias of Ephesus', 'Nicolas Cordier'], new: ['Agasias of Ephesus'] },
    });
    // A key present and null would make this edit answer for the title too.
    expect(Object.keys(details)).not.toContain('name');
    expect(Object.keys(details)).not.toContain('year');
  });

  it('rolls back and answers 404 when the work vanished under the lock', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ missing: true });
    mockedConnect.mockResolvedValueOnce(client);
    const res = makeRes();

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(queries.map(q => q.sql)).toContain('ROLLBACK');
    expect(queries.filter(q => q.sql.includes('UPDATE treasures'))).toHaveLength(0);
  });
});

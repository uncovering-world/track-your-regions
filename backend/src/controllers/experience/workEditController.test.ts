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

// Commons is somebody else's server. Mocked so the tests can say *when* it is
// asked as well as what is done with the answer — the timing is the rule here,
// not an implementation detail.
vi.mock('../../services/sync/imageCredit.js', () => ({
  creditForOneImage: vi.fn(async () => null),
}));

import { pool } from '../../db/index.js';
import { creditForOneImage } from '../../services/sync/imageCredit.js';
import { editWork } from './workEditController.js';
import { OBJECT_LOCK } from '../../db/locks.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedCredit = creditForOneImage as unknown as ReturnType<typeof vi.fn>;

/** A Commons file, in the one spelling every writer of this column stores. */
const COMMONS_FILE =
  'http://commons.wikimedia.org/wiki/Special:FilePath/Borghese%20Gladiator.jpg';
const CREDIT = {
  author: 'Agasias of Ephesus',
  license: 'CC BY 2.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Borghese_Gladiator.jpg',
};

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
/** The Louvre and the Borghese Gladiator: the correction this endpoint exists for. */
const EXPERIENCE_ID = 6212;
const TREASURE_ID = 2443;
const MUSEUM_SOURCE_ID = 2;

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
  mockedQuery.mockResolvedValueOnce({ rows: [{ source_id: MUSEUM_SOURCE_ID }] });
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
    mockedCredit.mockReset();
    mockedCredit.mockResolvedValue(null);
  });

  it('answers 404 for a work that does not hang in this museum', async () => {
    // The link is the proof, and its absence is not "no permission": the caller
    // may well curate this museum. It simply holds no such work.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await editWork(request({ artists: ['Agasias of Ephesus'] }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedConnect).not.toHaveBeenCalled();
    // A link the source has stopped placing here proves nothing: the museum's
    // list no longer shows the work, so the museum's scope no longer reaches
    // it (ADR-0044). Whoever still holds the work is where the edit belongs.
    expect(String(mockedQuery.mock.calls[0][0])).toContain('et.missing_since IS NULL');
  });

  it('refuses a curator whose scope does not reach the museum', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ source_id: MUSEUM_SOURCE_ID }] });
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

  it('writes a new picture and the credit for it in the one statement', async () => {
    foundAndPermitted();
    mockedCredit.mockResolvedValue(CREDIT);
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);
    const res = makeRes();

    await editWork(request({ imageUrl: COMMONS_FILE }) as never, res as never);

    const write = only(queries, 'UPDATE treasures');
    expect(write.params[7]).toBe(true);
    expect(write.params[8]).toBe(COMMONS_FILE);
    // Both in the same UPDATE, so no moment exists in which the row holds one
    // photograph and another photographer's name.
    expect(write.sql).toContain('image_url =');
    expect(write.sql).toContain('metadata =');
    expect(JSON.parse(String(write.params[9]))).toEqual({ imageCredit: CREDIT });
    // One claim, not two: `treasureWriter` keeps the row's own metadata whenever
    // the picture is claimed, so a credit key would be one nothing reads.
    expect(JSON.parse(String(write.params[6]))).toEqual(['image_url']);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ claimed: ['image_url'], imageCredit: CREDIT }),
    );
  });

  it('asks Commons before it opens the transaction', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ imageUrl: COMMONS_FILE }) as never, makeRes() as never);

    // A lock held across a request to somebody else's server is a lock held for
    // as long as they feel like taking. `connect` is what opens the transaction,
    // and the credit has to be in hand before it.
    expect(mockedCredit).toHaveBeenCalledWith(COMMONS_FILE, expect.any(String));
    expect(mockedCredit.mock.invocationCallOrder[0])
      .toBeLessThan(mockedConnect.mock.invocationCallOrder[0]);
  });

  it('drops the credit with the picture a curator removed', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ image_url: COMMONS_FILE });
    mockedConnect.mockResolvedValueOnce(client);

    // '' is how a form says "no picture" — and a stored credit under no
    // photograph names somebody for something nobody can see.
    await editWork(request({ imageUrl: '' }) as never, makeRes() as never);

    const write = only(queries, 'UPDATE treasures');
    expect(write.params[7]).toBe(true);
    expect(write.params[8]).toBeNull();
    expect(JSON.parse(String(write.params[9]))).toEqual({ imageCredit: null });
    expect(mockedCredit).toHaveBeenCalledWith(null, expect.any(String));
  });

  it('leaves the picture and its credit alone when the request does not name one', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ image_url: COMMONS_FILE });
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ year: -100 }) as never, makeRes() as never);

    const write = only(queries, 'UPDATE treasures');
    expect(write.params[7]).toBe(false);
    // Not asked at all: an edit that does not touch the picture must not spend a
    // curator's Save on a request to Commons.
    expect(mockedCredit).not.toHaveBeenCalled();
    expect(JSON.parse(String(write.params[6]))).toEqual(['year']);
  });

  it('records the picture under its column name, and the credit not at all', async () => {
    foundAndPermitted();
    mockedCredit.mockResolvedValue(CREDIT);
    const { client, queries } = makeClient({ image_url: null });
    mockedConnect.mockResolvedValueOnce(client);

    await editWork(request({ imageUrl: COMMONS_FILE }) as never, makeRes() as never);

    const details = JSON.parse(String(only(queries, 'experience_curation_log').params[3]));
    expect(details).toEqual({
      treasureId: TREASURE_ID,
      image_url: { old: null, new: COMMONS_FILE },
    });
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

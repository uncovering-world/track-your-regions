/**
 * Tests for a curator's correction to one point.
 *
 * Three rules here cannot be read off the column names, and each was a decision:
 *
 * The claim is a *union*, not a replacement. A curator who fixes a coordinate on
 * a point whose name they corrected last month must not thereby hand the name
 * back to the source — and the set is re-read under the write lock, so an
 * `accept-source` releasing a claim in between is not undone by putting the key
 * back.
 *
 * The object's anchor follows the point, but only where the object is one point.
 * ADR-0028 positions a reader at the place nearest the object's own coordinate,
 * so with one place the reader already follows the edit and what stays behind is
 * the object's published coordinate — the disagreement #550 is about. With
 * several places the anchor is a fact about the object, and nothing here knows
 * which point the curator meant.
 *
 * A rename places nothing. Region assignment is computed from coordinates, so a
 * point that only changed its label belongs exactly where it did.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

vi.mock('./publishContents.js', () => ({ placeAfterRelease: vi.fn(async () => []) }));

import { pool } from '../../db/index.js';
import { placeAfterRelease } from './publishContents.js';
import { editLocation } from './locationEditController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedPlace = placeAfterRelease as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
/** A real museum and its only point: the shape the anchor rule is about. */
const POINT = { experience_id: 6212, category_id: 2 };

function makeClient(stored: Record<string, unknown> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              name: 'Wing B', curated_fields: [], lat: 53.34, lon: -6.25, ...stored,
            }],
          };
        }
        // The anchor UPDATE answers with the row it moved, or with none when the
        // object holds more than one point — its own WHERE decides which.
        if (sql.includes('UPDATE experiences e')) {
          return { rows: stored.anchorMoves === false ? [] : [{ id: POINT.experience_id }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

function foundAndPermitted() {
  mockedQuery.mockResolvedValueOnce({ rows: [POINT] });
  mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] });
}

const only = (queries: Array<{ sql: string; params: unknown[] }>, fragment: string) => {
  const found = queries.filter(q => q.sql.includes(fragment));
  if (found.length !== 1) throw new Error(`${found.length} statements contain ${fragment}`);
  return found[0];
};

describe('editLocation', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedPlace.mockClear();
    mockedPlace.mockResolvedValue([]);
  });

  it('answers 404 for a point that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await editLocation(
      { params: { locationId: '999' }, body: { name: 'Anywhere' }, user: CURATOR } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('refuses a curator whose scope does not reach the object holding the point', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [POINT] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await editLocation(
      { params: { locationId: '31' }, body: { name: 'Anywhere' }, user: CURATOR } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('locks the object before the point, the order accept-source takes them in', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      makeRes() as never,
    );

    // `accept-source` locks `experiences` and then releases `location` on this
    // object's points; this handler writes the point and then the anchor. Taken
    // in opposite orders, two curators answering one object deadlock and
    // Postgres fails one of them with a 500.
    // Both modes: the object is locked `FOR NO KEY UPDATE` so the sync writer's
    // own FK key-share cannot deadlock against it, the point plainly.
    const locks = queries.filter(q => /FOR (NO KEY )?UPDATE/.test(q.sql)).map(q => q.sql);
    expect(locks).toHaveLength(2);
    expect(locks[0]).toContain('FROM experiences');
    expect(locks[1]).toContain('FROM experience_locations');
  });

  it('adds to the claims a point already carries instead of replacing them', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ curated_fields: ['name'] });
    mockedConnect.mockResolvedValue(client);

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      makeRes() as never,
    );

    const write = only(queries, 'UPDATE experience_locations');
    expect(JSON.parse(String(write.params[5]))).toEqual(['name', 'location']);
  });

  it('moves the anchor with the point, and claims it there too', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      res as never,
    );

    const anchor = only(queries, 'UPDATE experiences e');
    // Guarded by the count in its own WHERE rather than by a read beforehand:
    // between a read and the write another run could add the object's second
    // point, and the anchor would move for a reason that had stopped being true.
    expect(anchor.sql).toContain('COUNT(*) FROM experience_locations el');
    // Composed from the fragments rather than half spelled out: `missing_since
    // IS NULL` alone counts a point a curator declared `lost` and an unread
    // arrival, and on either shape the anchor would silently stay behind — #550
    // again, on the narrower case this rule exists to close.
    expect(anchor.sql).toContain("el.existence <> 'lost'");
    expect(anchor.sql).toContain("el.curation_state <> 'pending'");
    expect(anchor.sql).toContain("'[\"location\"]'::jsonb");
    // By hand, because this table has no trigger and every other writer of it
    // stamps the column — including `accept-source`, which stamps for a change to
    // `curated_fields` alone.
    expect(anchor.sql).toContain('updated_at = NOW()');
    // And that the edited row is the visible one, not merely that the object has
    // one: editing a withdrawn or unread sibling beside a single visible point
    // satisfies the count and would move the object onto a coordinate no reader is
    // ever sent to.
    expect(anchor.sql).toContain('WHERE el.id = $4 AND el.experience_id = e.id');
    expect(anchor.params[3]).toBe(31);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ anchorMoved: true }));
  });

  it('reports the anchor unmoved when the object holds more than one point', async () => {
    foundAndPermitted();
    const { client } = makeClient({ anchorMoves: false });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      res as never,
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ anchorMoved: false }));
  });

  it('places the experience again after a move, and not after a rename', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      makeRes() as never,
    );
    expect(mockedPlace).toHaveBeenCalledWith(POINT.experience_id, expect.stringContaining('moved a point'));

    mockedPlace.mockClear();
    mockedQuery.mockReset();
    foundAndPermitted();
    const renaming = makeClient();
    mockedConnect.mockResolvedValue(renaming.client);

    await editLocation(
      { params: { locationId: '31' }, body: { name: 'The east wing' }, user: CURATOR } as never,
      makeRes() as never,
    );

    // A label is not a place: the region rows are computed from coordinates, and
    // recomputing them here would spend a transaction to write what is there.
    expect(mockedPlace).not.toHaveBeenCalled();
    expect(renaming.queries.some(q => q.sql.includes('UPDATE experiences e'))).toBe(false);
  });

  it('tells the curator when the regions did not follow the point', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);
    mockedPlace.mockResolvedValue([{ worldViewId: 5, worldViewName: 'Administrative' }]);
    const res = makeRes();

    await editLocation(
      { params: { locationId: '31' }, body: { latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      res as never,
    );

    // A corrected pin whose region rows did not follow is on the map and absent
    // from the country's list — and the curator cannot re-assign anything, so
    // what they need is enough to tell an admin which object and which world
    // views. Every sibling endpoint says it; an unqualified success here would
    // be the one place the failure is only in a server log.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: 5, name: 'Administrative' }],
    }));
  });

  it('names both sides of what it changed in the trail', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ name: 'Wing B', lat: 53.34, lon: -6.25 });
    mockedConnect.mockResolvedValue(client);

    await editLocation(
      { params: { locationId: '31' }, body: { name: 'East wing', latitude: 45.25, longitude: 10.5 }, user: CURATOR } as never,
      makeRes() as never,
    );

    const log = only(queries, 'experience_curation_log');
    // The action is written into the statement rather than bound, the way the
    // publication and admission trails write theirs — so it is asserted there.
    expect(log.sql).toContain("'location_edited'");
    const details = JSON.parse(String(log.params[3]));
    expect(details).toMatchObject({
      locationId: 31,
      name: { old: 'Wing B', new: 'East wing' },
      location: { old: { lon: -6.25, lat: 53.34 }, new: { lon: 10.5, lat: 45.25 } },
      anchorMoved: true,
    });
  });
});

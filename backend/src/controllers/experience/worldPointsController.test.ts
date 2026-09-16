/**
 * `GET /points` (#910): the catalogue's places across the whole world.
 *
 * What these pin is the part of the endpoint a reader cannot see and a bug
 * would not announce.
 *
 * **The four reader guards, composed and whole.** Six predicates in this
 * family were each written as a subset of themselves during ADR-0025's review,
 * which is why the fragments exist and why this test asks for each of them by
 * the text the fragment produces rather than by a regex of its own: a test that
 * spells the SQL is a second copy of the rule, and it would keep passing on the
 * day the fragment changes. This endpoint is the one that most needs it — it
 * answers every reader-visible place of the catalogue at once, to anyone.
 *
 * **The two tiers' shapes**, because the overview's whole reason to exist is
 * that it does not carry names: a marker column leaking into it is 267 kB on
 * the map's first screen instead of 37 kB, and nothing on screen would look
 * wrong.
 *
 * **The fold's ordering**, in metres on geography. Degree ordering picks a
 * different place for six objects in this catalogue and sends the reader
 * further in every one of them, and the failure is invisible: a pin appears,
 * just in the wrong place.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getWorldPoints } from './worldPointsController.js';
import { hideLostSql, offeredLocationSql, publishedContentSql } from './experienceLifecycle.js';
import { placeOfferedSql } from '../../db/membership.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function ask(query: Record<string, unknown> = {}): Promise<{ sql: string; params: unknown[] }> {
  await getWorldPoints({ query } as never, makeRes() as never);
  // The last call, not the first: two asks in one test would otherwise both
  // read the first one's SQL and the second assertion would pass on the
  // wrong query.
  const call = mockedQuery.mock.calls.at(-1) as unknown[];
  return { sql: String(call[0]), params: (call[1] ?? []) as unknown[] };
}

async function answer(rows: Record<string, unknown>[], query: Record<string, unknown> = {}) {
  mockedQuery.mockResolvedValue({ rows });
  const res = makeRes();
  await getWorldPoints({ query } as never, res as never);
  return res.json.mock.calls.at(-1)![0] as Record<string, unknown>;
}

describe('getWorldPoints', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  describe('what a stranger may read', () => {
    it.each([
      ['the source still offers the point, and it stands', () => offeredLocationSql('el')],
      ['a curator has looked at the point', () => publishedContentSql('el')],
      ['the object still stands', () => hideLostSql('e')],
      ['some membership of it is admitted and passed', () => placeOfferedSql('e')],
    ])('asks whether %s', async (_question, fragment) => {
      const { sql } = await ask();
      expect(sql).toContain(fragment());
    });

    it('asks all four in the folded shape too, where the fold is a second pass', async () => {
      const { sql } = await ask({ folded: 'true' });
      for (const fragment of [offeredLocationSql('el'), publishedContentSql('el'),
        hideLostSql('e'), placeOfferedSql('e')]) {
        expect(sql).toContain(fragment);
      }
    });

    it('reads every offered place of a matched object, not only those inside the box', async () => {
      // The nearest place is what decides where a folded pin is drawn, and it
      // may lie outside the box the reader asked about. The second pass is
      // therefore joined on the matched objects rather than filtered by the
      // box again — a box term inside the fold would move the pin.
      const { sql } = await ask({ folded: 'true', bbox: '-10,35,30,60' });
      const fold = sql.slice(sql.indexOf('folded AS ('));
      expect(fold).not.toContain('ST_MakeEnvelope');
    });
  });

  describe('the kind', () => {
    it('is every kind at once when none is named — no scope goes missing', async () => {
      const { sql, params } = await ask();
      expect(sql).not.toContain('m.kind_id =');
      expect(params).toEqual([]);
    });

    it('is a parameter, never interpolated', async () => {
      const { sql, params } = await ask({ kindId: 5 });
      expect(sql).toContain('m.kind_id = $1');
      expect(params).toEqual([5]);
    });

    it('is a column the point is drawn with, not a predicate — so the join is LEFT', async () => {
      const { sql } = await ask();
      expect(sql).toMatch(/LEFT JOIN experience_kind_memberships m/);
    });
  });

  describe('the box', () => {
    it('is absent for the whole world', async () => {
      const { sql, params } = await ask();
      expect(sql).not.toContain('ST_MakeEnvelope');
      expect(params).toEqual([]);
    });

    it('is one envelope for an ordinary box', async () => {
      const { sql, params } = await ask({ bbox: '-10,35,30,60' });
      expect(sql.match(/ST_MakeEnvelope/g)).toHaveLength(1);
      expect(params).toEqual([-10, 35, 30, 60]);
    });

    it('is two envelopes across the antimeridian', async () => {
      // One envelope does not fail on `west > east`, it silently normalises
      // into the whole planet except the strip asked for.
      const { sql } = await ask({ bbox: '170,-10,-170,10' });
      expect(sql.match(/ST_MakeEnvelope/g)).toHaveLength(2);
      expect(sql).toContain('180,');
      expect(sql).toContain('-180,');
    });
  });

  describe('the two tiers', () => {
    it('sends the overview coordinates and nothing else', async () => {
      const { sql } = await ask();
      expect(sql).not.toContain('e.name');
      expect(sql).not.toContain('m.kind_id,');
      expect(sql).not.toContain('e.type');
    });

    it('rounds an overview coordinate to two decimals and a marker to five', async () => {
      // Two decimals is a sixth of a screen pixel at zoom 4.5, where this tier
      // hands over to the pins — the zoom that decides it, not the zoom the map
      // opens on, where it is a seventieth. Worth 10.4 kB: the overview of every
      // kind measured 47.6 kB at three decimals and 37.2 at two, which is what
      // kept the map root inside its total-size budget.
      expect((await ask()).sql).toContain('::numeric, 2)');
      expect((await ask({ detail: 'markers' })).sql).toContain('::numeric, 5)');
    });

    it('sends a marker what a pin needs: its identity, its name, its colour', async () => {
      const { sql } = await ask({ detail: 'markers' });
      for (const column of ['id AS location_id', 'experience_id', 'name AS location_name',
        'e.name AS experience_name', 'm.kind_id', 'e.type']) {
        expect(sql).toContain(column);
      }
    });
  });

  describe('the fold', () => {
    it('measures nearest in metres on geography, never in degrees', async () => {
      const { sql } = await ask({ folded: 'true' });
      expect(sql).toContain('el.location::geography <-> e.location::geography');
    });

    it('breaks a tie on the id, so the answer is total', async () => {
      const { sql } = await ask({ folded: 'true' });
      expect(sql).toMatch(/<-> e\.location::geography,\s*el\.id/);
    });

    it('counts the places over the un-joined set, so a second membership cannot inflate it', async () => {
      // #755 gives a place two memberships. A count read through the kind's
      // LEFT JOIN would then count memberships and label the badge with them.
      const { sql } = await ask({ folded: 'true' });
      const fold = sql.slice(sql.indexOf('folded AS ('), sql.indexOf('SELECT\n', sql.indexOf('folded AS (')));
      expect(fold).toContain('count(*) OVER (PARTITION BY el.experience_id)');
      expect(fold).not.toContain('LEFT JOIN experience_kind_memberships');
    });
  });

  describe('nothing a caller typed reaches the SQL as text', () => {
    // This endpoint is the widest anonymous read the product has, and its SQL is
    // built by concatenating fragments — so the guard worth pinning is that the
    // concatenation never carries a value. Every interpolation in the module is
    // an alias this file passes, a module constant, or a shared fragment; the
    // two things a caller controls go through `params`.
    it('keeps a hostile kind out of the statement and in the parameters', async () => {
      const hostile = "1); DROP TABLE experiences; --";
      const { sql, params } = await ask({ kindId: hostile });
      expect(sql).not.toContain('DROP');
      expect(sql).not.toContain(hostile);
      expect(sql).toContain('m.kind_id = $1');
      // `Number` is what the handler reads it through, so what reaches the
      // driver is a number the database refuses, never text it might run. Over
      // HTTP it never gets this far: the schema refuses it with a 400.
      expect(params).toHaveLength(1);
      expect(typeof params[0]).toBe('number');
    });

    it('drops a hostile box entirely rather than parameterising it', async () => {
      // Stronger than parameterisation, and worth pinning as what it is: a
      // segment that is not a number makes `parseBbox` name no box at all, so
      // there is no envelope and no parameter. Over HTTP the schema refuses it
      // with a 400 before the handler runs, for the reason the schema carries —
      // a box nobody can parse must not widen the answer to the whole
      // catalogue. Here the handler is called directly, and the filter is
      // simply absent.
      const { sql, params } = await ask({ bbox: '0,0,0,0) OR true --' });
      expect(sql).not.toContain('OR true');
      expect(sql).not.toContain('ST_MakeEnvelope');
      expect(params).toEqual([]);
    });

    it('parameterises a box it can read, all four numbers', async () => {
      const { sql, params } = await ask({ bbox: '-10,35,30,60' });
      expect(sql).toMatch(/ST_MakeEnvelope\(\$1, \$2, \$3, \$4, 4326\)/);
      expect(params).toEqual([-10, 35, 30, 60]);
      expect(params.every(value => typeof value === 'number')).toBe(true);
    });

    it('rounds to a constant, never to anything a caller named', async () => {
      // `detail` picks a column list and a precision from module constants, and
      // the handler forces it to one of two literals before either is read.
      for (const detail of ['markers', 'overview', 'bogus', '2); DROP TABLE x; --']) {
        const { sql } = await ask({ detail });
        expect(sql).toMatch(/::numeric, [25]\)/);
        expect(sql).not.toContain('DROP');
      }
    });
  });

  describe('the row bound', () => {
    it('caps both shapes, so no parameter makes the work unbounded', async () => {
      // `bbox` is optional on both tiers, so without this the cost of one
      // anonymous request grows with the catalogue. The rate limiter bounds how
      // often a stranger may ask, not how much each ask costs.
      expect((await ask()).sql).toMatch(/LIMIT 20001$/);
      expect((await ask({ folded: 'true' })).sql).toMatch(/LIMIT 20001$/);
      expect((await ask({ detail: 'markers' })).sql).toMatch(/LIMIT 20001$/);
    });

    it('asks for one more than the cap, so hitting it is not mistaken for filling it', async () => {
      const { sql } = await ask();
      const cap = Number(/LIMIT (\d+)/.exec(sql)![1]);
      expect(cap).toBe(20001);
    });

    it('says so when it truncates, rather than drawing part of the world in silence', async () => {
      // A density picture built from a subset is wrong rather than incomplete,
      // so this can never be a silent LIMIT.
      const rows = Array.from({ length: 20001 }, (_unused, index) => ({ lng: index / 1000, lat: 1 }));
      const body = await answer(rows);
      expect(body.truncated).toBe(true);
      expect(body.count).toBe(20000);
      expect((body.lng as number[])).toHaveLength(20000);
    });

    it('carries no truncated flag on an answer that is whole', async () => {
      const body = await answer([{ lng: 1, lat: 2 }]);
      expect(body).not.toHaveProperty('truncated');
    });
  });

  describe('the answer', () => {
    it('is columnar — one array per field, not an object per point', async () => {
      const body = await answer([{ lng: 1.5, lat: 2.5 }, { lng: 3.5, lat: 4.5 }]);
      expect(body).toEqual({
        detail: 'overview', folded: false, count: 2, lng: [1.5, 3.5], lat: [2.5, 4.5],
      });
    });

    it('echoes the fold it was asked for, so a layer cannot draw one with the other data', async () => {
      const body = await answer([{ lng: 1, lat: 2, location_count: 7 }], { folded: 'true' });
      expect(body.folded).toBe(true);
      expect(body.locationCount).toEqual([7]);
    });

    it('carries no places column when nothing is folded — every point is its own place', async () => {
      const body = await answer([{ lng: 1, lat: 2 }]);
      expect(body).not.toHaveProperty('locationCount');
    });

    it('keeps a missing point name as null rather than dropping the column out of step', async () => {
      // The arrays are read by index, so a hole is a null, never a short array.
      const body = await answer(
        [{ lng: 1, lat: 2, location_id: 9, experience_id: 4, location_name: null, experience_name: 'Victory Arch', kind_id: 1, type: 'cultural' }],
        { detail: 'markers' },
      );
      expect(body.name).toEqual([null]);
      expect(body.locationId).toEqual([9]);
      expect(body.experienceName).toEqual(['Victory Arch']);
    });
  });
});

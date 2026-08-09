import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  getExperience,
  getExperiencesByRegion,
  listExperiences,
  searchExperiences,
  getExperienceRegionCounts,
  listCategories,
} from './experienceQueryController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const EXPERIENCE_ROW = {
  id: 281,
  category_id: 1,
  external_id: 'ext-281',
  name: 'Seowon, Korean Neo-Confucian Academies',
  category: 'cultural',
  category_name: 'UNESCO',
};

// Mirrors the confirmed leak: experience 281 assigned to a region in hidden
// world view 5 ("Administrative") and a region in a visible world view.
const HIDDEN_WV_REGION = { id: 10, name: 'Daegu', world_view_id: 5, world_view_name: 'Administrative' };
const PUBLIC_WV_REGION = { id: 20, name: 'Gyeongju', world_view_id: 1, world_view_name: 'GADM' };

/**
 * Queues the two `pool.query` resolutions `getExperience` consumes in order:
 * the experience row, then the region rows a correctly-filtered query would
 * return. `regionRows` stands in for what Postgres would hand back for the
 * visibility predicate under test; the assertions below separately check
 * that the SQL/params sent actually encode that predicate.
 */
function queueQueries(regionRows: unknown[]) {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValueOnce({ rows: [EXPERIENCE_ROW] });
  mockedQuery.mockResolvedValueOnce({ rows: regionRows });
}

describe('getExperience visibility', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('filters the regions query by visibility, hiding a hidden world view from an anonymous caller but not blanking a public one', async () => {
    queueQueries([PUBLIC_WV_REGION]);
    const res = makeRes();

    await getExperience({ params: { id: '281' } } as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    // Same predicate shape as getWorldViews (worldViewCrud.ts): is_active is
    // unconditional, is_public is bypassed only for admins.
    expect(sql).toMatch(/AND wv\.is_active = true/);
    expect(sql).toMatch(/AND\s*\(\$2::boolean OR wv\.is_public = true\)/);
    expect(params).toEqual([281, false]);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      regions: [PUBLIC_WV_REGION],
    }));
  });

  it('shows every assignment, including a hidden world view, to an admin', async () => {
    queueQueries([HIDDEN_WV_REGION, PUBLIC_WV_REGION]);
    const res = makeRes();

    await getExperience(
      { params: { id: '281' }, user: { role: 'admin' } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([281, true]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      regions: [HIDDEN_WV_REGION, PUBLIC_WV_REGION],
    }));
  });

  it('never 404s the experience itself, even when it has no visible region assignments', async () => {
    // A curator-authenticated non-admin whose only assignment sits in a
    // hidden world view: the association is filtered away entirely, but the
    // experience — public data — must still resolve.
    queueQueries([]);
    const res = makeRes();

    await getExperience(
      { params: { id: '281' }, user: { role: 'curator' } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([281, false]);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 281,
      regions: [],
    }));
  });
});

/**
 * The lifecycle rule is asymmetric, and the asymmetry is the whole design: a
 * delisted place is still somewhere you can go, a demolished one is not. Every
 * read that offers somewhere to go has to hide the second and keep the first,
 * and the one query that forgets is the one that offers a demolished building.
 */
describe('lifecycle visibility across the read paths', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    // Every path here runs a list and a count; the count reader dereferences
    // its row, so an empty result would fail for a reason unrelated to what
    // these tests are about.
    mockedQuery.mockResolvedValue({ rows: [{ count: '0', total: 0 }] });
  });

  const paths: Array<{ name: string; run: () => Promise<unknown>; filtersLost: boolean }> = [
    {
      name: 'a region list',
      filtersLost: true,
      run: () => getExperiencesByRegion(
        { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never),
    },
    {
      name: 'the flat list',
      filtersLost: true,
      run: () => listExperiences({ query: {} } as never, makeRes() as never),
    },
    {
      name: 'search',
      filtersLost: true,
      run: () => searchExperiences({ query: { q: 'abbey' } } as never, makeRes() as never),
    },
    {
      name: 'the region counts',
      filtersLost: true,
      run: () => getExperienceRegionCounts({ query: { worldViewId: '1' } } as never, makeRes() as never),
    },
    {
      // The count that reported 128 art museums where the catalogue offers 101 —
      // the 27 rows the category's own rule turned down (#503). It reads nothing
      // off the request, because the number labels a category rather than a
      // page: there is no `includeLost` here to widen it.
      name: 'the category counts',
      filtersLost: true,
      run: () => listCategories({} as never, makeRes() as never),
    },
    {
      // The by-id read the other five are siblings of (ADR-0024) — the one this
      // whole rule started from, and the one this array had left unpinned.
      // `filtersLost: false` matches the handler's own comment: `lost` predates
      // the admission axis, and closing it here is a separate decision about a
      // different question.
      name: 'a single experience by id',
      filtersLost: false,
      run: () => getExperience({ params: { id: '281' } } as never, makeRes() as never),
    },
  ];

  for (const { name, run, filtersLost } of paths) {
    // A skip would prove nothing for the one path that doesn't filter `lost`:
    // it would pass with no assertion behind it. Assert the negative instead,
    // under a name that says which case this is.
    const label = filtersLost
      ? `hides what no longer exists from ${name}`
      : `leaves what no longer exists reachable from ${name}, which is today's choice and not a permanent rule`;

    it(label, async () => {
      await run();

      const all = mockedQuery.mock.calls.map(c => String(c[0])).join('\n');
      // Alias-anchored: every path above reads `experiences` as `e`, and an
      // unanchored match would pass for a predicate on the wrong table. What it
      // still cannot see is *where* the predicate landed — that a `listCategories`
      // filter sits inside the `experience_count` subquery and not in the outer
      // WHERE is Postgres's answer, not a mock's.
      if (filtersLost) {
        expect(all).toMatch(/e\.existence <> 'lost'/);
      } else {
        // Pinned so this path stays in step with the sibling by-id reads in
        // experienceLocationController.test.ts, not because leaving `lost`
        // reachable here is settled — the handler's own comment flags closing
        // it as a separate decision about a different question.
        expect(all).not.toMatch(/e\.existence <> 'lost'/);
      }
      // `former` is a claim about the source's catalogue, not about the world.
      // Left unanchored on purpose: a negative is strongest when it names no
      // alias, so this fails whichever table grew the predicate.
      expect(all).not.toContain("source_membership <> 'former'");
    });
  }

  for (const { name, run } of paths) {
    it(`hides what this category refused from ${name}`, async () => {
      await run();

      const all = mockedQuery.mock.calls.map(c => String(c[0])).join('\n');
      expect(all).toMatch(/e\.admission <> 'refused'/);
    });
  }

  it('keeps a refused row hidden from a caller who asked to see what is gone', async () => {
    // The discriminating case for two predicates rather than one: `includeLost`
    // drops the existence filter and must leave admission alone (ADR-0024).
    await listExperiences({ query: { includeLost: 'true' } } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).not.toContain("existence <> 'lost'");
    expect(sql).toContain("admission <> 'refused'");
  });

  it('counts the same rows it lists, or the tree would disagree with itself', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    const [list, count] = mockedQuery.mock.calls.map(c => String(c[0]));
    expect(list).toContain("existence <> 'lost'");
    expect(count).toContain("existence <> 'lost'");
  });

  it('keeps search brackets round the name alternatives', async () => {
    await searchExperiences({ query: { q: 'abbey' } } as never, makeRes() as never);

    // Unbracketed, `OR` binds looser than the lifecycle AND and every lost
    // object matching by trigram comes straight back
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/WHERE \(e\.name ILIKE \$2 OR e\.name % \$1\)/);
  });

  it('shows them when the caller asks for them', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: { includeLost: 'true' }, user: undefined } as never,
      makeRes() as never);

    const all = mockedQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(all).not.toContain("existence <> 'lost'");
  });

  it('says how many it is holding back, so the page can offer to show them', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    // Answered by the count that was already running: a permanent "show lost"
    // control for a state almost no region has is worse than none
    const count = String(mockedQuery.mock.calls[1][0]);
    expect(count).toContain("FILTER (WHERE e.existence = 'lost' AND e.admission <> 'refused')");
    expect(count).toContain('lost_hidden');
    // A refused row is not something the reader is being offered a look at:
    // revealing the lost would not bring it back (ADR-0024).
    expect(count).toContain("FILTER (WHERE e.admission <> 'refused' AND e.existence <> 'lost')");
  });

  it('counts everything as shown once the caller asked for them', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: { includeLost: 'true' }, user: undefined } as never,
      makeRes() as never);

    // The total has to follow the list, or the page would say 40 and show 41.
    // `includeLost` drops the lost predicate and only that one: admission has no
    // toggle, so it survives into a count the caller asked to widen.
    expect(String(mockedQuery.mock.calls[1][0])).toContain(
      "FILTER (WHERE e.admission <> 'refused')");
  });

  it('reports nothing hidden once it is showing them', async () => {
    const res = makeRes();
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: { includeLost: 'true' }, user: undefined } as never,
      res as never);

    // A count of "hidden" that still counted what is on screen would have the
    // page offering to reveal rows the reader is already looking at
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ lostHidden: 0 }));
  });

  it('binds the reader on $4, which is where both branches leave room', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: { id: 9, role: 'user' } } as never,
      makeRes() as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('v.user_id = $4');
    expect(params[3]).toBe(9);
  });

  it('binds the reader on $4 in the other branch too', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: { includeChildren: 'false' }, user: { id: 9, role: 'user' } } as never,
      makeRes() as never);

    // Two branches build the statements; one being right proves nothing about
    // the other, and they bind independently
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('v.user_id = $4');
    expect(params[3]).toBe(9);
  });

  it('keeps the reader out of the count, which is executed with the region alone', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: { id: 9, role: 'user' } } as never,
      makeRes() as never);

    // The count runs with `[regionId]`, so a `$4` leaking into it would fail
    // the whole read with "bind message supplies 1 parameters"
    const count = String(mockedQuery.mock.calls[1][0]);
    expect(count).not.toContain('$4');
  });

  it('leaves an anonymous reader the category window alone', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    // `v.user_id = NULL` is never true, so the personal clause drops out
    // rather than needing its own query for logged-out readers
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('v.user_id = NULL');
    expect(params).toHaveLength(3);
  });

  it('labels every row with both axes, so a card can say which it is', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('e.source_membership');
  });
});

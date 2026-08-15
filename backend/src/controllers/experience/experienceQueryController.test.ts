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
 * `getExperience` is one of the three by-id reads ADR-0025 relaxes the
 * pending gate for. `maySeeUnreadExperience` (`experienceScope.ts`) is what
 * resolves the boolean; these tests pin how `getExperience` wires it in, not
 * `maySeeUnreadExperience`'s own scope logic.
 */
describe('getExperience curation relaxation', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('binds the gate closed for an anonymous caller, without asking the database about scope', async () => {
    queueQueries([PUBLIC_WV_REGION]);

    await getExperience({ params: { id: '281' } } as never, makeRes() as never);

    // Exactly the two queries `getExperience` itself makes — no third call for
    // a scope check nobody needs.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/\$2::boolean OR e\.curation_state <> 'pending'/);
    expect(params).toEqual([281, false]);
  });

  it('opens the gate for an admin, without asking the database about scope', async () => {
    queueQueries([PUBLIC_WV_REGION]);

    await getExperience(
      { params: { id: '281' }, user: { id: 1, role: 'admin' } } as never,
      makeRes() as never,
    );

    // Admin short-circuits inside `maySeeUnreadExperience` (and inside
    // `resolveExperienceScope`, which it never reaches): no scope query.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([281, true]);
  });

  /**
   * Queues what a curator call to `getExperience` needs, in the order
   * `maySeeUnreadExperience` asks for them: the category lookup, then
   * `resolveExperienceScope`'s own scope query — both ahead of the two
   * `getExperience` makes itself.
   */
  function queueCuratorPath(scopeRow: { unrestricted: boolean; scoped_region_id: number | null }, regionRows: unknown[]) {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [{ category_id: 1 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [scopeRow] });
    mockedQuery.mockResolvedValueOnce({ rows: [EXPERIENCE_ROW] });
    mockedQuery.mockResolvedValueOnce({ rows: regionRows });
  }

  it('opens the gate for a curator whose scope reaches the experience', async () => {
    queueCuratorPath({ unrestricted: true, scoped_region_id: null }, [PUBLIC_WV_REGION]);

    await getExperience(
      { params: { id: '281' }, user: { id: 9, role: 'curator' } } as never,
      makeRes() as never,
    );

    const [, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(params).toEqual([281, true]);
  });

  it('keeps the gate closed for a curator whose scope does not reach the experience', async () => {
    queueCuratorPath({ unrestricted: false, scoped_region_id: null }, []);

    await getExperience(
      { params: { id: '281' }, user: { id: 9, role: 'curator' } } as never,
      makeRes() as never,
    );

    const [, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(params).toEqual([281, false]);
  });
});

/**
 * The lifecycle rule is asymmetric, and the asymmetry is the whole design: a
 * delisted place is still somewhere you can go, a demolished one is not. Every
 * read that offers a *set* to go through — a list, the map, a search, a count —
 * hides the second and keeps the first, and the one query that forgets is the
 * one that offers a demolished building.
 *
 * A by-id read is a different question and is answered differently: it hides a
 * row the category refused, and today leaves a `lost` one reachable, because
 * that gap predates the admission axis and closing it is a separate decision
 * (`getExperience`'s own comment says so). Which case a path is belongs in the
 * array rather than in this paragraph, so `filtersLost` states it per path and
 * both loops below assert what that path actually promises.
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

  for (const { name, run } of paths) {
    it(`hides an unread row from ${name}`, async () => {
      await run();

      // Anchored on `calls[0]` rather than every call joined together: a
      // path like `getExperiencesByRegion` sends a separate list and count,
      // built from two independently-constructed strings, and joining them
      // would let a predicate missing from the list hide behind one the
      // count still carries — the exact half-right case the by-region count
      // test right below this loop pins on its own.
      //
      // The fragment is present even on `getExperience`'s path, where nobody
      // in this loop is authenticated: the predicate is what a curator's
      // scope widens (Step 5), not something absent until then.
      const list = String(mockedQuery.mock.calls[0][0]);
      expect(list).toMatch(/e\.curation_state <> 'pending'/);
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

  it('gates the same rows it lists, or the tree would disagree with itself', async () => {
    // `lifecycleFilter` (the list) and `lifecyclePredicate` (the count) are
    // built as two separate strings in `buildRegionQueries` — removing the
    // pending gate from one and not the other leaves this exact test the
    // only thing standing between that and a green suite, since a check
    // that joined every call together could not tell the two apart.
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    const [list, count] = mockedQuery.mock.calls.map(c => String(c[0]));
    // Anchored on the `e.` alias, not a bare substring match: the list's
    // `location_count` subquery carries its own `el.curation_state`
    // predicate (`publishedContentSql('el')`), and an unanchored check would
    // pass on that alone even with the container-level gate missing — which
    // is exactly what happened here until this was anchored.
    expect(list).toMatch(/e\.curation_state <> 'pending'/);
    expect(count).toMatch(/e\.curation_state <> 'pending'/);
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
    // Anchored on the experience alias, because a *point's* own `existence` is
    // filtered here whatever the reader asked: "show what is gone" is an affordance
    // about objects, and a component a curator declared gone is never put back on the
    // map — `offeredLocationSql` carries `el.existence <> 'lost'` beside the
    // withdrawal flag (ADR-0026). Unanchored, this would read that as the reader's
    // request being ignored.
    expect(all).not.toContain("e.existence <> 'lost'");
  });

  it('says how many it is holding back, so the page can offer to show them', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: {}, user: undefined } as never, makeRes() as never);

    // Answered by the count that was already running: a permanent "show lost"
    // control for a state almost no region has is worse than none
    const count = String(mockedQuery.mock.calls[1][0]);
    expect(count).toContain(
      "FILTER (WHERE e.existence = 'lost' AND e.admission <> 'refused' AND e.curation_state <> 'pending')");
    expect(count).toContain('lost_hidden');
    // A refused row is not something the reader is being offered a look at:
    // revealing the lost would not bring it back (ADR-0024). Same for a
    // pending one: `curation_state` has no toggle here, unlike `existence`
    // (ADR-0025), so it rides along in both FILTER expressions unconditionally.
    expect(count).toContain(
      "FILTER (WHERE e.admission <> 'refused' AND e.existence <> 'lost' AND e.curation_state <> 'pending')");
  });

  it('counts everything as shown once the caller asked for them', async () => {
    await getExperiencesByRegion(
      { params: { regionId: '1' }, query: { includeLost: 'true' }, user: undefined } as never,
      makeRes() as never);

    // The total has to follow the list, or the page would say 40 and show 41.
    // `includeLost` drops the lost predicate and only that one: admission and
    // curation_state have no toggle, so both survive into a count the caller
    // asked to widen.
    expect(String(mockedQuery.mock.calls[1][0])).toContain(
      "FILTER (WHERE e.admission <> 'refused' AND e.curation_state <> 'pending')");
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

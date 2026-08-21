/**
 * Tests for a curator's verdict on one point of an object.
 *
 * The rule that cannot be inferred from the column names is what happens to
 * `missing_since`. The experience-level verdict clears it on every answer, because
 * nothing a reader sees is keyed on it. Here it is one of the two terms a reader's
 * read carries, so clearing it on `former` would put the pin back on the map — a
 * place the source no longer lists. On `lost` it would put back nothing: the
 * `existence` axis holds that point hidden whatever the flag says, which is ADR-0026
 * decision 7 and the reason a verdict outlives the run that prompted it. Only "the
 * source blinked" clears the flag — though it is not the only answer that can reveal a
 * point, since taking a `lost` verdict back on a row whose flag is already clear does
 * that too. The asymmetry between the two axes is the whole reason this endpoint is
 * not a copy of the object-level one.
 *
 * The other rule worth pinning is that nothing here deletes. A visit record points
 * at the row, and `user_visited_locations.location_id` cascades (ADR-0022).
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
import { setLocationState } from './locationStateController.js';

const mockedPlace = placeAfterRelease as unknown as ReturnType<typeof vi.fn>;

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

/** Enough of a response to read a status and a body off. */
function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };

/** The live row this whole slice was built against. */
const BILBAO = { id: 13211, experience_id: 502, category_id: 2 };

/** What a card showing an unanswered withdrawal sends back. */
const WAITING = { membership: 'present' as const, existence: 'extant' as const, flagged: true };

/** Captures the transaction's statements; `stored` answers the locked re-read. */
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
              source_membership: 'present', existence: 'extant',
              missing_since: new Date('2026-08-10'), ...stored,
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

/** Answer the two reads that happen before the transaction: the row, then the scope. */
function foundAndPermitted() {
  mockedQuery.mockResolvedValueOnce({ rows: [BILBAO] });
  mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] });
}

/** The one statement containing `fragment`, or a failure naming what went wrong. */
const only = (queries: Array<{ sql: string; params: unknown[] }>, fragment: string) => {
  const found = queries.filter(q => q.sql.includes(fragment));
  if (found.length !== 1) throw new Error(`${found.length} statements contain ${fragment}`);
  return found[0];
};

describe('setLocationState', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedPlace.mockClear();
    mockedPlace.mockResolvedValue([]);
  });

  it('answers 404 for a point that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '999' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('refuses a curator whose scope does not reach the object holding the point', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [BILBAO] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    // The point carries no scope of its own: it is judged through the object that
    // holds it, which is where regions and category live.
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('locks the object before the point, as every writer of an object’s contents does', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    // This handler reaches the parent row whether or not it says so — its audit
    // INSERT references `experiences` — so leaving that to the foreign key would
    // make the order an accident of the last statement rather than a rule. The
    // rule is what `db/locks.ts` argues from, and the mode only holds because the
    // order does.
    //
    // Both modes matched: the object is locked `FOR NO KEY UPDATE`, the point
    // plainly, and the assertion is about which comes first.
    const locks = queries.filter(q => /FOR (NO KEY )?UPDATE/.test(q.sql)).map(q => q.sql);
    expect(locks).toHaveLength(2);
    expect(locks[0]).toContain('FROM experiences');
    expect(locks[1]).toContain('FROM experience_locations');
  });

  it('leaves the flag standing on a verdict of former, so the point stays off the map', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    const update = only(queries, 'UPDATE experience_locations');
    // The predicate every reader-facing read carries is `offeredLocationSql` —
    // `missing_since IS NULL AND existence <> 'lost'` — and on a `former` verdict the
    // flag is the term doing the work, since `existence` stays `extant`. Clearing it
    // here would therefore show a point the source stopped offering, with no read
    // having changed and nothing to warn anyone.
    expect(update.params).toContain(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sourceMembership: 'former' }));
  });

  it('clears the flag on the false alarm, the only answer that does', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'present', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    const update = only(queries, 'UPDATE experience_locations');
    expect(update.params).toContain(true);
    // No transition to name, so the verdict is the assertion itself.
    const log = only(queries, 'experience_curation_log');
    expect(log.params).toContain('location_missing_dismissed');
  });

  it('logs against the object, naming the point inside it', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    const log = only(queries, 'experience_curation_log');
    // The trail a curator reads is the object's, so the row hangs off the
    // experience — and then has to say which point it was about, or a serial site
    // with seven components records seven indistinguishable verdicts.
    expect(log.params).toContain(BILBAO.experience_id);
    expect(log.params).toContain('location_marked_former');
    const details = JSON.parse(String(log.params.find(p => typeof p === 'string' && p.startsWith('{'))));
    expect(details.locationId).toBe(BILBAO.id);
  });

  it('records a lost component as lost, and still keeps it hidden', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { existence: 'lost', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    expect(only(queries, 'experience_curation_log').params).toContain('location_marked_lost');
    // A demolished building is not somewhere to send anyone, whatever the source
    // still lists.
    expect(only(queries, 'UPDATE experience_locations').params).toContain(false);
  });

  it('takes a verdict back, and shows the point again when both axes are clear', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ source_membership: 'former' });
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { membership: 'present', expected: { membership: 'former', existence: 'extant', flagged: true } },
        user: CURATOR,
      } as never,
      makeRes() as never,
    );

    // Correctable for the same reason the experience-level verdict is: refusing a
    // decided row made `former` terminal, so one mis-click removed a point from the
    // product with no remedy short of SQL.
    expect(only(queries, 'experience_curation_log').params).toContain('location_state_restored');
    expect(only(queries, 'UPDATE experience_locations').params).toContain(true);
  });

  it('refuses a stale card rather than answering a question that has moved', async () => {
    foundAndPermitted();
    const { client } = makeClient({ source_membership: 'former' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    // Two curators on one object is the normal case, not a corner: every
    // region-scoped curator covering any of its regions sees the same card.
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refuses a verdict sent twice rather than logging it as a false alarm', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient({ source_membership: 'former' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { membership: 'former', expected: { membership: 'former', existence: 'extant', flagged: true } },
        user: CURATOR,
      } as never,
      res as never,
    );

    // Nothing moved and the answer keeps the point hidden, so this is the same
    // verdict re-sent — not the false alarm. Logging `location_missing_dismissed`
    // here would write a dismissal into the trail beside a `missing_since` nothing
    // dismissed, and move `state_decided_by` for a decision nobody changed.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.filter(q => q.sql.includes('experience_curation_log'))).toEqual([]);
  });

  it('refuses an answer to a point nothing is asking about', async () => {
    foundAndPermitted();
    const { client } = makeClient({ missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { membership: 'present', expected: { membership: 'present', existence: 'extant', flagged: false } },
        user: CURATOR,
      } as never,
      res as never,
    );

    // Nothing moved and no flag stands, so there is no verdict to record — taking
    // it would move `state_decided_by` to whoever clicked last over a question
    // nobody had.
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('places the point again when the false alarm puts it back on the map', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'present', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    // A withdrawn point holds no `auto` region rows: the run that marked it
    // re-placed the experience, and placement takes offered points only (ADR-0022).
    // Measured on the live row — 0 region rows against the offered point's 3 — so
    // clearing the flag without this puts a pin on the map that counts in no region
    // until some later run happens to touch the object.
    expect(mockedPlace).toHaveBeenCalledWith(BILBAO.experience_id, expect.stringContaining('verdict'));
  });

  it('places nothing on a verdict that leaves the point hidden', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    // Nothing became visible, so there is nothing to place — and placement is the
    // expensive half of this endpoint.
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('places the point when taking back a lost verdict on a row the source offers again', async () => {
    foundAndPermitted();
    // The state the flapping case leaves behind: a curator answered `lost`, the source
    // then offered the point again and the run cleared the flag — so the point is
    // hidden by the existence term alone.
    const { client } = makeClient({ existence: 'lost', missing_since: null });
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { existence: 'extant', expected: { membership: 'present', existence: 'lost', flagged: false } },
        user: CURATOR,
      } as never,
      makeRes() as never,
    );

    // Visibility is two columns since the read predicate became two, so a gate that
    // asks only about the flag skips exactly this reveal — and the next run's fast
    // path finds stored == matched, so nothing would ever place it: a pin on the map,
    // in no region, for good.
    expect(mockedPlace).toHaveBeenCalledWith(BILBAO.experience_id, expect.stringContaining('verdict'));
  });

  it('places the point when a verdict takes a visible one off the map', async () => {
    foundAndPermitted();
    // An offered point — no flag, nothing answered — declared gone from the world.
    const { client } = makeClient({ missing_since: null });
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { existence: 'lost', expected: { membership: 'present', existence: 'extant', flagged: false } },
        user: CURATOR,
      } as never,
      makeRes() as never,
    );

    // Placement carries the same pair the reads do, so a point that stops being
    // visible must stop counting toward a region — otherwise the region counts a
    // place nobody is shown, which is what widening the placement predicate was for.
    expect(mockedPlace).toHaveBeenCalledWith(BILBAO.experience_id, expect.stringContaining('verdict'));
  });

  it('places a point revealed by dropping a lost verdict while it is still delisted', async () => {
    foundAndPermitted();
    // `{former, lost, flag NULL}`: delisted and demolished, and the source has since
    // offered the point again, so the flag is clear and the existence term is the only
    // thing hiding it.
    const { client } = makeClient({ source_membership: 'former', existence: 'lost', missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { existence: 'extant', expected: { membership: 'former', existence: 'lost', flagged: false } },
        user: CURATOR,
      } as never,
      res as never,
    );

    // The answer leaves `former` standing, so "both axes came out clean" is false —
    // and the point is visible all the same, because the flag was already NULL and
    // membership is in no reader-facing read. A gate keyed on the stricter condition
    // places nothing here, and the next run's fast path never revisits the row.
    expect(mockedPlace).toHaveBeenCalledWith(BILBAO.experience_id, expect.stringContaining('verdict'));
    // The reply has to agree with what was computed, or it promises a visibility the
    // region rows were not built for.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ offeredToReaders: true }));
  });

  it('places nothing when correcting a row whose flag was already clear', async () => {
    foundAndPermitted();
    const { client } = makeClient({ source_membership: 'former', missing_since: null });
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      {
        params: { locationId: '13211' },
        body: { membership: 'present', expected: { membership: 'former', existence: 'extant', flagged: false } },
        user: CURATOR,
      } as never,
      makeRes() as never,
    );

    // Reachable: a later run that offers the point again clears the flag and leaves
    // both axes alone, so a row can be visible and still say `former`. Correcting
    // the axis reveals nothing, and placing would be work for nothing.
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('names the world views a placement failed for, rather than answering success', async () => {
    foundAndPermitted();
    mockedPlace.mockResolvedValue([{ worldViewId: 4, worldViewName: 'Base layer' }]);
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'present', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    // The verdict committed and the placement did not: a point back on the map and
    // missing from a region's list is a state a curator can report and nobody can
    // guess from a plain success.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Base layer' }],
    }));
  });

  it('says nothing about placement where there was none to do', async () => {
    foundAndPermitted();
    const { client } = makeClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setLocationState(
      { params: { locationId: '13211' }, body: { membership: 'former', expected: WAITING }, user: CURATOR } as never,
      res as never,
    );

    // Absent rather than `false`: a field that is always there stops being read.
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('placementFailed');
  });

  it('deletes nothing, whatever the verdict', async () => {
    foundAndPermitted();
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setLocationState(
      { params: { locationId: '13211' }, body: { existence: 'lost', expected: WAITING }, user: CURATOR } as never,
      makeRes() as never,
    );

    // `user_visited_locations.location_id` cascades, so a delete here would erase
    // someone's record of having stood there — the whole point of ADR-0022.
    expect(queries.filter(q => /DELETE/i.test(q.sql))).toEqual([]);
  });
});

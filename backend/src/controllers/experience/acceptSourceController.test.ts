/**
 * Tests for the accept-source path.
 *
 * Split from `lifecycleController.test.ts` with the handler it covers (#526).
 * The rule worth pinning is the one a reader cannot infer from the column names:
 * accepting a value the source proposed has to release the curator's claim, or
 * the next run refuses it again — and the proposal is re-resolved under the write
 * lock, so a claim made since the card was drawn wins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  // Mirrors the real one, returning the rollback's own failure — which is
  // what `client.release()` needs to destroy a client carrying an open
  // transaction. A stub that swallowed it would make that untestable.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

vi.mock('./publishContents.js', () => ({ placeAfterRelease: vi.fn(async () => []) }));
// Commons is never asked from a unit test; a spec that needs its answer says what it was.
vi.mock('../../services/sync/imageCredit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/imageCredit.js')>()),
  creditForOneImage: vi.fn(async () => null),
}));

import { pool } from '../../db/index.js';
import { placeAfterRelease } from './publishContents.js';
import { creditForOneImage } from '../../services/sync/imageCredit.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { experienceCurationRoutes } from '../../routes/experienceRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const postAcceptSource = routeAt(experienceCurationRoutes, '/:id/accept-source', 'post');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedPlace = placeAfterRelease as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
const ADMIN = { id: 1, role: 'admin' as const };

/** The object's one claiming point, as the release statement returns it. */
const POINT = { id: 41, external_ref: '1739-005', name: 'Wing B' };

/**
 * Captures what the transaction ran, so assertions can read the statements.
 *
 * `claimed` answers the `FOR UPDATE` re-read, which is the point of the mock:
 * this handler reads `curated_fields` inside its own transaction rather than
 * trusting a value fetched before the lock, so a claim made since the card was
 * drawn has to be able to win. That is the only column the locked read selects
 * here — the lifecycle axes belong to the verdict handlers and their mock, in
 * `lifecycleController.test.ts`.
 */
type ClaimingPoint = { id: number; external_ref: string | null; name: string | null };

function makeClient(
  claimed?: string[],
  proposal?: unknown[],
  claimingPoints: ClaimingPoint[] = [],
  /** What `metadata->'imageCredit'` holds: a credit, an explicit null, or nothing. */
  imageCredit: unknown = null,
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('experience_sync_changes')) return { rows: proposal ?? [] };
        // Before the lock read: the release of the points' own claim is also an
        // UPDATE, and it is the one that names `experience_locations`. The
        // coordinate write that follows it names the same table and returns
        // nothing, which is what the `RETURNING` tells them apart by.
        if (sql.includes('UPDATE experience_locations')) {
          return { rows: sql.includes('RETURNING') ? claimingPoints : [] };
        }
        if (sql.includes(OBJECT_LOCK)) {
          return { rows: [{
            curated_fields: claimed ?? [], image_credit: imageCredit,
            metadata: { website: 'https://curator.example', imageCredit }, name_local: null,
          }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

describe('acceptSourceValue', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedPlace.mockReset();
    mockedPlace.mockResolvedValue([]);
  });

  it('refuses a curator whose scope does not reach the experience', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: CURATOR, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('says so when the source never proposed anything', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    mockedConnect.mockResolvedValue(makeClient(['name'], []).client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('clears a standing refusal along with the claim it belonged to', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'Renamed upstream', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // A refusal says "not while I hold this field". Accepting hands the field back, so
    // a refusal left behind would silence it the day someone claims it again — with an
    // answer given about a claim that no longer exists.
    const del = queries.find(q => q.sql.includes('DELETE FROM experience_conflict_decisions'));
    expect(del?.params).toEqual([5, ['name']]);
    // Inside the same transaction: a delete that survived a rolled-back acceptance
    // would un-answer a question nobody re-asked.
    expect(queries.findIndex(q => q === del)).toBeLessThan(queries.findIndex(q => q.sql === 'COMMIT'));
  });

  it('releases the curator claim, or the next run would refuse the value again', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'Renamed upstream', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name', 'subtitle'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.sql).toContain('name = $2');
    expect(update?.params).toContain('Renamed upstream');
    // 'name' released, 'subtitle' still claimed
    expect(update?.params).toContain(JSON.stringify(['subtitle']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fromSyncLogId: 9 }));
  });

  it('writes a name as a person would type it, however the run recorded it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    // A proposal recorded before the writers tidied (#835): accepting it must
    // not put the run of spaces back into the column migration 047 cleaned.
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: ' Renamed  upstream ', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.params).toContain('Renamed upstream');
    expect(update?.params).not.toContain(' Renamed  upstream ');
  });

  it('will not write a proposal the source has since withdrawn', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    // The withdrawal check is in the SQL, so a withdrawn proposal comes back
    // as no row — the same answer as no proposal ever existing
    const { client, queries } = makeClient(['name'], []);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      res as never,
    );

    const lookup = queries.find(q => q.sql.includes('experience_sync_changes'));
    expect(lookup?.sql).toContain('last_seen_sync_log_id');
    // Same gate as the queue, or a card fetched before a run started would be
    // refused mid-run with "no proposal on record", which is false
    // The two copies must stay identical, or the endpoint would refuse a
    // newer proposal while writing a retracted one. Sharing one definition is
    // what makes that structural; this asserts they really do share it.
    const queueSql = CHANGESET_LANDED_SQL.replace(/\s+/g, ' ').trim();
    expect(lookup!.sql.replace(/\s+/g, ' ')).toContain(queueSql);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('resolves the proposal under the same lock that writes it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // Resolving it before the lock would let a run landing in between have its
    // values written under the run id the curator sent — the substitution
    // expectedSyncLogId exists to refuse
    expect(queries[0].sql).toBe('BEGIN');
    expect(queries.some(q => q.sql.includes('experience_sync_changes'))).toBe(true);
    const lookup = queries.findIndex(q => q.sql.includes('experience_sync_changes'));
    const write = queries.findIndex(q => q.sql.includes('UPDATE experiences'));
    expect(lookup).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(lookup);
  });

  it('finishes rolling back before letting go of the client', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    let rollbackDone = false;
    let releasedBeforeRollback = false;
    const inner = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'ROLLBACK') {
        await new Promise(r => setTimeout(r, 5));
        rollbackDone = true;
        queries.push({ sql, params: params ?? [] });
        return { rows: [] };
      }
      return inner(sql, params);
    });
    client.release.mockImplementation(() => { if (!rollbackDone) releasedBeforeRollback = true; });
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      makeRes() as never,
    );

    // An unawaited refusal settles the try block at once, so `finally` hands
    // the client back while its ROLLBACK is still running on the wire
    expect(releasedBeforeRollback).toBe(false);
  });

  it('refuses a proposal a newer run has replaced', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    // The card was drawn from run 41; run 42 has since proposed something else
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'Rathaus', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      res as never,
    );

    // Writing here would replace the curator's edit with a value they never
    // saw — the same exposure `expected` closes on the verdict path
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('names the run its value came from, since a later one may differ', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    mockedConnect.mockResolvedValue(makeClient(['name'], PROPOSAL).client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 42 } } as never,
      res as never,
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ applied: ['name'], released: [], fromSyncLogId: 42 }));
  });

  it('writes every field it is answered for now, not at the next run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [
      { field: 'tags', new: ['a'], curatedConflict: true },
      { field: 'countryCodes', new: ['IT'], curatedConflict: true },
      { field: 'metadata.website', new: 'https://source.example', curatedConflict: true },
    ] }];
    const { client, queries } = makeClient(['tags', 'country_codes', 'metadata.website', 'name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // The value is on the card, and the run that proposed it is the one the
    // curator answered (#2222): releasing alone left it to a run nobody watches.
    await answerRoute(postAcceptSource,
      { user: ADMIN, params: { id: '5' }, body: { fields: ['tags', 'countryCodes', 'metadata.website'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).toContain('tags = ');
    expect(update.sql).toContain('country_codes = ');
    expect(update.params).toContain(JSON.stringify(['a']));
    expect(update.params).toContainEqual(['IT']);
    // The one metadata key, merged over what is stored rather than the column replaced.
    expect(update.params).toContain(JSON.stringify({ website: 'https://source.example', imageCredit: null }));
    expect(update.params).toContain(JSON.stringify(['name']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      applied: ['tags', 'countryCodes', 'metadata.website'], released: [],
    }));
  });

  it('releases a claim on a major metadata key under its own name', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'metadata.inDanger', new: false, curatedConflict: true }] }];
    const { client, queries } = makeClient(['metadata.inDanger', 'metadata.website'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // A metadata claim names its key (ADR-0077 decision 3), so the conflict
    // resolves to the claim that raised it and only that one is released.
    await answerRoute(postAcceptSource,
      { user: ADMIN, params: { id: '5' }, body: { fields: ['metadata.inDanger'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.params).toContain(JSON.stringify(['metadata.website']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ applied: [], released: ['metadata.inDanger'] }));
  });

  it('releases the coordinate on the object and on its pin together', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
      contents: null,
    }];
    const { client, queries } = makeClient(['location'], PROPOSAL, [POINT]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // The object's claim on `location` exists only because `editLocation` made
    // it, on the object's one visible point, in the same transaction as that
    // point's own. Releasing the object's half alone leaves the next run writing
    // the source's coordinate to `experiences.location` while the pin keeps the
    // curator's — the object positioned by the source and its only place by the
    // curator, which is #550 made by the endpoints written to close it.
    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const release = queries.find(q => q.sql.includes('UPDATE experience_locations'));
    expect(release?.sql).toContain("el.curated_fields - 'location'");
    // The pin the anchor was taken from, not every claiming point: a second
    // corrected point of the same object never raised this card, and undoing its
    // correction in answer to one about the anchor is destroying curated work.
    expect(release?.sql).toContain('el.location = e.location');
    expect(release?.params).toEqual([5]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      applied: ['location'], released: [], releasedPoints: [41],
    }));
    // The object's own coordinate lands now, after the pin was found by it.
    const placeWrite = queries.findIndex(q => q.sql.includes('UPDATE experiences') && q.sql.includes('location = ST_SetSRID'));
    expect(placeWrite).toBeGreaterThan(queries.findIndex(q => q.sql.includes('UPDATE experience_locations')));
    expect(queries[placeWrite].params).toEqual(expect.arrayContaining([2, 1]));
    // A place that moved is a region fact.
    expect(mockedPlace).toHaveBeenCalledWith(5, expect.stringContaining('accepted the source coordinate'));
    const log = queries.find(q => q.sql.includes('experience_curation_log'));
    expect(String(log?.params[3])).toContain('"releasedPoints":[41]');
  });

  it('puts a released pin back on the coordinate that run offered for it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
      // What the run offered for the point itself, kept out by the claim and
      // recorded per point — the object's own coordinate is a different number
      // on a serial site, so it is not the one to write here.
      contents: {
        locations: {
          changed: [{
            item: { name: 'Wing B', ref: '1739-005' },
            fields: [{ field: 'location', old: { lon: 10, lat: 50 }, new: { lon: 10.5, lat: 50.2 } }],
          }],
        },
      },
    }];
    const { client, queries } = makeClient(['location'], PROPOSAL, [POINT]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // Releasing the claim alone hands the pin back by retiring it: the pairing
    // needs the reference *and* ten metres, so a 2 km correction stops being a
    // candidate the moment nothing claims it, and the run withdraws the row and
    // inserts the source's point beside it — a `withdrawn` card for a component
    // nobody delisted, and the visit record left on a pin no reader is shown.
    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const write = queries.find(q => q.sql.includes('UPDATE experience_locations') && q.sql.includes('ST_MakePoint'));
    // The point, the coordinate, and the object it has to belong to (the lock's).
    expect(write?.params).toEqual([41, 10.5, 50.2, 5]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ movedPoints: [41] }));
    // A pin that moved is a region fact, and its `auto` rows were computed from
    // where it used to be.
    expect(mockedPlace).toHaveBeenCalledWith(5, expect.stringContaining('accepted the source coordinate'));
  });

  it('finds the entry for a referenceless point the same run renamed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
      // The record names an item by what it was called *before* the run, so on a
      // row the same run renamed, the stored label is the entry's `name.new` and
      // never its `item.name`. Matching one of them only would skip the write on
      // the one referenceless point in the catalogue — whose `samePointSql`
      // branch is exact coordinate equality, so the row released without a
      // coordinate is withdrawn at the next run.
      //
      // The record's names carry the run of spaces the run saw; the row holds
      // the tidied name since migration 047 (#835), and the match is by the
      // store rule on both sides.
      contents: {
        locations: {
          changed: [{
            item: { name: 'Camino  Francés', ref: null },
            fields: [
              { field: 'name', old: 'Camino  Francés', new: 'Routes of  Santiago' },
              { field: 'location', old: { lon: 1, lat: 2 }, new: { lon: 3.5, lat: 42.9 } },
            ],
          }],
        },
      },
    }];
    const point = { id: 55, external_ref: null, name: 'Routes of Santiago' };
    const { client, queries } = makeClient(['location'], PROPOSAL, [point]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const write = queries.find(q => q.sql.includes('UPDATE experience_locations') && q.sql.includes('ST_MakePoint'));
    expect(write?.params).toEqual([55, 3.5, 42.9, 5]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ movedPoints: [55] }));
  });

  it('writes no coordinate where that run offered none for the row', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
      contents: { locations: { changed: [{ item: { name: 'Other', ref: '1739-009' }, fields: [] }] } },
    }];
    const { client, queries } = makeClient(['location'], PROPOSAL, [POINT]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // The entry names another component. Writing its coordinate onto this row
    // would put the pin somewhere no source ever placed it, and a row the source
    // already matches within the tolerance pairs without any help.
    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(queries.some(q => q.sql.includes('UPDATE experience_locations') && q.sql.includes('ST_MakePoint'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ releasedPoints: [41], movedPoints: [] }));
  });

  it('does not read an entry with no rename as naming an unnamed point', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    // A referenceless entry for a named point that only moved, beside a
    // released referenceless row whose name is NULL. "No rename recorded" and
    // "the name is null" must not meet in the middle: compared through one
    // null, every such entry would name this row, and its coordinate would be
    // written onto a point no source ever placed there.
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
      contents: {
        locations: {
          changed: [{
            item: { name: 'Camino Francés', ref: null },
            fields: [{ field: 'location', old: { lon: 1, lat: 2 }, new: { lon: 3.5, lat: 42.9 } }],
          }],
        },
      },
    }];
    const unnamed = { id: 56, external_ref: null, name: null };
    const { client, queries } = makeClient(['location'], PROPOSAL, [unnamed]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(queries.some(q => q.sql.includes('UPDATE experience_locations') && q.sql.includes('ST_MakePoint'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ movedPoints: [] }));
  });

  it('leaves the points alone when the accepted field is not the coordinate', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name', 'location'], PROPOSAL, [POINT]);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // A claimed pin is not an answer about the object's name, and the object's
    // own `location` claim is left standing here too — this request was about
    // one field, and `open` is what the release follows.
    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(queries.some(q => q.sql.includes('UPDATE experience_locations'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ releasedPoints: [] }));
  });

  it('releases the credit with the picture, and drops the stored one', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'imageUrl', new: 'https://commons.wikimedia.org/wiki/Special:FilePath/Aqua_Vergine.jpg', curatedConflict: true }],
    }];
    const { client, queries } = makeClient(
      ['image_url', 'metadata.imageCredit'], PROPOSAL, [], { author: 'Jane Doe' },
    );
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['imageUrl'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // Both halves of one decision. Releasing the picture and keeping the credit
    // would leave the source's photograph credited to the curator's
    // photographer — and the per-key re-apply would put that name back on every
    // later run, so nothing could correct it.
    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).toContain('image_url = ');
    expect(update.params).toContain(JSON.stringify({ website: 'https://curator.example' }));
    const claims = String((update.params as unknown[]).find(
      (v) => typeof v === 'string' && v.startsWith('['),
    ));
    expect(claims).not.toContain('metadata.imageCredit');
    expect(claims).not.toContain('image_url');
  });

  it('does not report a credit that was never there', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'imageUrl', new: 'https://commons.wikimedia.org/wiki/Special:FilePath/Aqua_Vergine.jpg', curatedConflict: true }],
    }];
    // What `editExperience` stores for a picture that is not on Commons: the
    // key present and null, the claim deliberately withheld.
    const { client, queries } = makeClient(['image_url'], PROPOSAL, [], null);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['imageUrl'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    // Nothing to drop: no credit stood under the curator's picture. Telling a
    // curator that one was removed would be a sentence about nothing.
    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).toContain('image_url = ');
    expect(update.sql).not.toContain('metadata = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ releasedCredit: false }));
  });

  it('writes the run’s credit with its picture where both are taken', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const RUN_CREDIT = { author: 'A Commons author', license: 'CC BY-SA 4.0' };
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [
        { field: 'imageUrl', new: 'https://commons.wikimedia.org/wiki/Special:FilePath/Aqua_Vergine.jpg', curatedConflict: true },
        { field: 'metadata.imageCredit', new: RUN_CREDIT, curatedConflict: true },
      ],
    }];
    const { client, queries } = makeClient(
      ['image_url', 'metadata.imageCredit'], PROPOSAL, [], { author: 'Jane Doe' },
    );
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource,
      { user: ADMIN, params: { id: '5' }, body: { fields: ['imageUrl', 'metadata.imageCredit'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    // The picture lands named, rather than bare until a run fetches its credit.
    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params).toContain(JSON.stringify({ website: 'https://curator.example', imageCredit: RUN_CREDIT }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ applied: ['imageUrl', 'metadata.imageCredit'] }));
  });

  it('names the new picture’s author from Commons when the run sent no credit for it', async () => {
    const PICTURE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Aqua_Vergine.jpg';
    const COMMONS_CREDIT = { author: 'A Commons author', license: 'CC BY-SA 4.0' };
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    // The picture the open proposal offers, read before the transaction.
    mockedQuery.mockResolvedValueOnce({ rows: [{ url: PICTURE }] });
    vi.mocked(creditForOneImage).mockResolvedValueOnce(COMMONS_CREDIT as never);
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'imageUrl', new: PICTURE, curatedConflict: true }] }];
    const { client, queries } = makeClient(['image_url', 'metadata.imageCredit'], PROPOSAL, [], { author: 'Jane Doe' });
    mockedConnect.mockResolvedValue(client);

    // A run resends the stored credit over a claimed picture rather than
    // resolving the source's, so the card carries none: without this the
    // source's photograph would go out uncredited until its next run.
    await answerRoute(postAcceptSource,
      { user: ADMIN, params: { id: '5' }, body: { fields: ['imageUrl'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    expect(creditForOneImage).toHaveBeenCalledWith(PICTURE, expect.any(String));
    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params).toContain(JSON.stringify({ website: 'https://curator.example', imageCredit: COMMONS_CREDIT }));
  });

  it('refuses a picture no writer may store, rather than release it without a write', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'imageUrl', new: 'https://whc.unesco.org/document/1', curatedConflict: true }],
    }];
    const { client, queries } = makeClient(['image_url', 'metadata.imageCredit'], PROPOSAL, [], { author: 'Jane Doe' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // The World Heritage Centre's terms forbid drawing its photographs (ADR-0043).
    // Released without a write, the curator's photograph would stay with its
    // credit dropped; so the answer is refused, as publishing refuses it.
    await answerRoute(postAcceptSource,
      { user: ADMIN, params: { id: '5' }, body: { fields: ['imageUrl'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('keeps a credit claim when the picture is not what was accepted', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name', 'metadata.imageCredit'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).not.toContain('metadata = ');
    const claims = String((update.params as unknown[]).find(
      (v) => typeof v === 'string' && v.startsWith('['),
    ));
    expect(claims).toContain('metadata.imageCredit');
  });

  it('reads the claim it is about to rewrite under the same lock', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // Reading it before the transaction and writing the filtered result back
    // would drop whatever a concurrent edit claimed in between
    const order = queries.map(q => q.sql.trim().split(/\s+/).slice(0, 2).join(' '));
    expect(order[0]).toBe('BEGIN');
    expect(queries[1].sql).toContain(OBJECT_LOCK);
    expect(queries.findIndex(q => q.sql.includes('UPDATE experiences'))).toBeGreaterThan(1);
  });

  it('does not overwrite an answer another curator already gave', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    // The claim was released while this request was in flight
    const { client, queries } = makeClient([], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refuses a field the source did not propose', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, source_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    mockedConnect.mockResolvedValue(makeClient(['name'], PROPOSAL).client);
    const res = makeRes();

    await answerRoute(postAcceptSource, 
      { user: ADMIN, params: { id: '5' }, body: { fields: ['subtitle'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

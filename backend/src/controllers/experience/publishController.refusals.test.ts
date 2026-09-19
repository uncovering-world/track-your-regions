/**
 * Tests for what publishing refuses — out of scope, a stale or vanished card, a proposal
 * that is not the one the caller saw, a row the source turned down — and for the rollback
 * behind every refusal, which lets go of the client only once it is safe to.
 *
 * Every assertion is anchored to the one statement it is about, as
 * `publishController.test.ts` explains: `only()` fails when a fragment matches more than one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  // Mirrors the real one, returning the rollback's own failure — which is what
  // `client.release()` needs to destroy a client carrying an open transaction.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

// Mocked as a module rather than through the pool: placement opens its own
// transaction on its own connection, so driving it through the fake client would
// prove nothing about whether it ran off this one.
vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import {
  CURATOR, grantScope, makeClient, mockedConnect, mockedQuery, noWrites, only, publish,
  resetPublishMocks,
} from './publishController.fixtures.js';

beforeEach(resetPublishMocks);

describe('refusing to publish', () => {
  it('refuses a curator whose scope does not reach the experience', async () => {
    grantScope();
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const { client } = makeClient({ row: { curation_state: 'pending' } });

    const res = await publish({}, client, CURATOR);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('refuses when the pointer names a run whose changeset is not on record', async () => {
    grantScope();
    // Pointer set, no `experience_sync_changes` row for it: `recordSyncChanges`
    // writes a run's whole changeset as one batched insert, so a run whose
    // pointer landed and whose changeset did not is a reachable failure, and
    // the admin screen has an alert for exactly it.
    // `proposal` omitted is how this helper says "no changeset row", which is
    // the state under test — distinct from `proposal: []`, a row whose proposal
    // is empty.
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 500 },
    });

    const res = await publish({ expectedSyncLogId: 500 }, client);

    // Not 200-with-nothing-applied: that would clear the pointer, take the card
    // away and report success, leaving the held values unwritten and no record
    // that anything was held. `accept-source` refuses the same case, and two
    // endpoints disagreeing about it is worse than either answer alone.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('answers 404 for a row that vanished before the lock', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: null });

    const res = await publish({}, client);

    // The existence check ran on another connection and earlier in time.
    // Reading `curated_fields` off nothing would answer 500 to a 404.
    expect(res.status).toHaveBeenCalledWith(404);
    expect(noWrites(queries)).toBe(true);
  });

  it('names the run now holding the row when the card was stale', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('different run'), pendingChangeSyncLogId: 61,
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses when a proposal arrived under a caller that expected none', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', pending_change_sync_log_id: 61 },
      // A real, writable, unclaimed field — the row genuinely has something
      // left to answer, unlike the fully-claimed case the staleness check
      // now skips. Without this the fixture proves nothing under the new
      // check: an empty proposal writes nothing either way, and the refusal
      // this test is about would not fire for that reason instead. `held: true`
      // is required for `heldFieldWrites` to count it at all — it now reads the
      // field's own flag rather than inferring "held" from "not a claim" (#519).
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    const res = await publish({}, client);

    // Publishing here would either apply values the curator never saw or clear
    // the pointer without applying them, and the second loses the proposal.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses when the proposal it was holding has gone', async () => {
    grantScope();
    const { client } = makeClient({ row: { curation_state: 'auto', pending_change_sync_log_id: null } });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('is gone'), pendingChangeSyncLogId: null,
    }));
  });

  it('refuses rather than publish around a coordinate it cannot read', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: [
        { field: 'location', new: { lon: 'east', lat: null }, held: true },
        { field: 'name', new: 'N', held: true },
      ],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // Publishing the name and clearing the pointer would drop the coordinate
    // silently, and ST_MakePoint(NULL, NULL) would fail the transaction with an
    // error naming neither the field nor the reason. The message has to name the
    // field, or a curator is told only that publishing failed.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('location'),
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('asks the locked read for every column a decision here rests on', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // The one assertion in this file that has to be about the statement's text
    // rather than its effect. The mocked client answers the read after the lock
    // with a full row whatever the SELECT actually named, so a column dropped
    // from that list is invisible to every other test here while being
    // `undefined` in production — the refused-row guard silently stops firing,
    // the claim filter stops skipping, the pointer reads as "nothing held", and
    // `published_at` stops being stamped. Proved by mutation: removing
    // `admission` from the list killed no test until this one existed.
    const read = only(queries, 'm.id AS membership_id');
    // `name_local` and `image_url` too: `heldFieldWrites` reads both off `before`
    // (#728's one-language merge, #722's credit rule), and the fixture answers
    // them whatever the SELECT names.
    for (const column of [
      'curation_state', 'curated_fields', 'metadata', 'name_local', 'image_url',
      'admission', 'pending_change_sync_log_id',
    ]) {
      expect(read.sql, `the read under the lock does not select ${column}`).toContain(column);
    }
  });

  it('refuses to publish a row the source turned down', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', admission: 'refused' },
    });

    const res = await publish({}, client);

    // ADR-0025 decision 4: admission is asked before publication, so publishing
    // a refused row asks the second question first. Left unrefused, the row
    // leaves `arrivals` for ever — nothing returns a `verified` row to `pending`
    // — and a later override would put it in front of readers with nobody having
    // reviewed its contents.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('turned down'),
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses a contents publish on a row the source turned down', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', admission: 'refused' },
    });

    const res = await publish({ locationIds: [11] }, client);

    // A refused museum's unread paintings raise no `contents` card either —
    // that query carries `hideRefusedSql()` on the container — so this path
    // must refuse for the same reason and not only the object path.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('publishes a row the source admitted', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', admission: 'admitted' },
    });

    const res = await publish({}, client);

    // The other direction, or the guard above could be an unconditional refusal.
    expect(res.status).not.toHaveBeenCalled();
    expect(only(queries, 'UPDATE experience_kind_memberships').sql).toContain(`curation_state = 'verified'`);
  });

  it('destroys a client whose rollback also failed', async () => {
    grantScope();
    const { client } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
    });
    const inner = client.query.getMockImplementation()!;
    const rollbackFailure = new Error('connection terminated mid-rollback');
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'ROLLBACK') throw rollbackFailure;
      return inner(sql, params);
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // `pg-pool` keeps a released client unless the argument is truthy, so a
    // client whose ROLLBACK failed while the socket still works would go back to
    // the idle pool carrying an open transaction — and the next request would
    // run inside it. `release()` with no argument is the bug this pins.
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });

  it('finishes rolling back before letting go of the client', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
    });
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

    await publish({ expectedSyncLogId: 53 }, client);

    // A non-awaited `return refuse(…)` settles the try block immediately, so
    // `finally` releases the client mid-ROLLBACK — and reads `unusable` before
    // it has been assigned.
    expect(releasedBeforeRollback).toBe(false);
  });
});

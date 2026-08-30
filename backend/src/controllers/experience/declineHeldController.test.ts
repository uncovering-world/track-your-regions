/**
 * Tests for the decline-held path (#722).
 *
 * The rules worth pinning are the ones the column names do not carry. A refusal
 * records the value from the *locked proposal*, never from the request, because
 * the queue compares by that value and a refusal naming something nobody
 * proposed would silence nothing while looking like an answer. It writes nothing
 * to the row — the stored value has already won every run since the gate first
 * held this one — and it does not claim the field, which is the whole difference
 * from the one lever a curator had before.
 *
 * And the pointer: it is what the card is keyed on, so it goes only once nothing
 * is left open. Refusing one row of six has to leave the other five findable.
 *
 * The proposal in these tests is the one run 68 is really holding on Getbol,
 * Korean Tidal Flats (Phase II) on the development database: a rename dropping
 * the phase marker, and a description rewritten for the 2026 extension.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { declineHeldValue } from './declineHeldController.js';
import { OBJECT_LOCK } from '../../db/locks.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const ADMIN = { id: 1, role: 'admin' as const };
const CURATOR = { id: 7, role: 'curator' as const };

interface ClientOptions {
  pointer?: number | null;
  proposal?: { changed_fields?: unknown[]; contents?: unknown } | null;
  answered?: Array<{ kind: string | null; ref: string | null; name: string | null; field: string }>;
}

function makeClient(opts: ClientOptions = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        // Order matters: the answered read names the changeset table too, so the
        // narrower fragment is tested first.
        if (sql.includes('experience_held_decisions') && sql.includes('SELECT NULL::text AS kind')) {
          return { rows: opts.answered ?? [] };
        }
        if (sql.includes('SELECT changed_fields')) {
          return { rows: opts.proposal === null ? [] : [opts.proposal ?? { changed_fields: [] }] };
        }
        if (sql.includes(OBJECT_LOCK)) {
          return { rows: [{ pending_change_sync_log_id: opts.pointer ?? 68 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

/** What run 68 holds on Getbol: two of the six, the two a curator would argue about. */
const GETBOL = {
  changed_fields: [
    { field: 'name', old: 'Getbol, Korean Tidal Flats (Phase II)', new: 'Getbol, Korean Tidal Flats', held: true },
    { field: 'shortDescription', old: 'The property comprises four component parts…', new: 'The property comprises six component parts…', held: true },
  ],
  contents: null,
};

/** A museum's work whose attribution the gate held (ADR-0037). */
const WITH_A_WORK = {
  changed_fields: [],
  contents: {
    treasures: {
      changed: [{
        item: { name: 'The Wine Glass', ref: 'Q782639' },
        fields: [{ field: 'artist', old: 'Johannes Vermeer', new: 'Jan Vermeer van Haarlem the Elder', held: true }],
      }],
    },
  },
};

function decline(body: unknown, client: unknown, user: { id: number; role: 'admin' | 'curator' } = ADMIN) {
  const res = makeRes();
  return declineHeldValue(
    { user, params: { id: '1138' }, body } as never, res as never,
  ).then(() => res);
}

describe('declineHeldValue', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ id: 1138, category_id: 1 }] });
  });

  it('refuses a curator whose scope does not reach the experience', async () => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1138, category_id: 1 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const { client } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client, CURATOR);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('records the value from the proposal, not from the request', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({
      fields: ['name'],
      expectedSyncLogId: 68,
      // Ignored. The readers compare a stored answer against what the source is
      // proposing now, so an answer about a value nobody proposed silences
      // nothing while looking like one.
      value: 'something else',
    }, client);

    const insert = queries.find(q => q.sql.includes('INSERT INTO experience_held_decisions'));
    expect(insert?.params).toContain(JSON.stringify('Getbol, Korean Tidal Flats'));
    expect(insert?.params).not.toContain(JSON.stringify('something else'));
    expect(insert?.params).toContain('refused');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      declinedFields: ['name'], fromSyncLogId: 68,
    }));
  });

  it('writes nothing to the row, and claims nothing', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // The whole point of the endpoint: the one lever a curator had before was to
    // claim the field by editing it, and a claim is a different statement that
    // outlives this question. One row of two refused, so the pointer stays and
    // the object is not written at all — asserted as an absence rather than
    // through `every()` over an empty list, which passes whatever the endpoint
    // writes.
    expect(queries.filter(q => q.sql.includes('UPDATE experiences'))).toEqual([]);
  });

  it('touches nothing but the pointer even on the write it does make', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    await decline({ fields: ['name', 'shortDescription'], expectedSyncLogId: 68 }, client);

    // The other half of the promise above, on the one path that reaches an
    // UPDATE: answering the last open row clears the pointer, and the statement
    // that does it may carry nothing else — a claim least of all, since the
    // claim is the statement this endpoint exists to avoid making.
    const write = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(write?.sql).toContain('pending_change_sync_log_id = NULL');
    expect(write?.sql).not.toContain('curated_fields');
    expect(write?.sql).not.toContain('name = ');
    expect(write?.sql).not.toContain('short_description');
  });

  it('keeps the pointer while anything on the card is still open', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // One of two refused. Clearing the pointer here would take the description
    // off every screen there is, unanswered, and nothing else names the run it
    // belongs to.
    expect(queries.find(q => q.sql.includes('pending_change_sync_log_id = NULL'))).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ heldLeftOpen: 1 }));
  });

  it('clears the pointer once the last open row is answered', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({
      fields: ['name', 'shortDescription'], expectedSyncLogId: 68,
    }, client);

    expect(queries.find(q => q.sql.includes('pending_change_sync_log_id = NULL'))).toBeDefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ heldLeftOpen: 0 }));
  });

  it('counts a row someone already answered as closed, not as open', async () => {
    const { client, queries } = makeClient({
      proposal: GETBOL,
      answered: [{ kind: null, ref: null, name: null, field: 'shortDescription' }],
    });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // The description was published last week; the card has one row on it, and
    // refusing that row is the end of the card.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ heldLeftOpen: 0 }));
    expect(queries.find(q => q.sql.includes('pending_change_sync_log_id = NULL'))).toBeDefined();
  });

  it('refuses a row nothing is waiting on', async () => {
    const { client, queries } = makeClient({
      proposal: GETBOL,
      answered: [{ kind: null, ref: null, name: null, field: 'name' }],
    });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // Answered by somebody else while this card was open. Reporting success
    // would leave the curator believing they had settled it.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.find(q => q.sql.includes('INSERT INTO experience_held_decisions'))).toBeUndefined();
    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('refuses a run other than the one the card showed', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL, pointer: 71 });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ pendingChangeSyncLogId: 71 }));
    expect(queries.find(q => q.sql.includes('INSERT INTO experience_held_decisions'))).toBeUndefined();
  });

  it('refuses a row whose proposal the pointer no longer names', async () => {
    const { client } = makeClient({ pointer: null });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refuses when the changeset the pointer names is not on record', async () => {
    const { client } = makeClient({ proposal: null });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // Publishing refuses the same case with the same words. Two endpoints
    // disagreeing about it is worse than either answer.
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('answers a field of a part, named the way the record names it', async () => {
    const { client, queries } = makeClient({ proposal: WITH_A_WORK });
    mockedConnect.mockResolvedValue(client);

    const res = await decline({
      parts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artist'] }],
      expectedSyncLogId: 68,
    }, client);

    // ADR-0037's case, answered: Wikidata moved this painting to an obscure
    // namesake on 21 August, and a curator says no to that value without
    // claiming the column.
    const insert = queries.find(q => q.sql.includes('INSERT INTO experience_held_decisions'));
    expect(insert?.params).toContain('treasures');
    expect(insert?.params).toContain('Q782639');
    expect(insert?.params).toContain(JSON.stringify('Jan Vermeer van Haarlem the Elder'));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      declinedFields: [],
      declinedParts: [{ kind: 'treasures', name: 'The Wine Glass', fields: ['artist'] }],
      heldLeftOpen: 0,
    }));
  });

  it('refuses a part the record does not name', async () => {
    const { client } = makeClient({ proposal: WITH_A_WORK });
    mockedConnect.mockResolvedValue(client);

    // The reference is the record's own, and the name decides among duplicated
    // ones: a request that gets either wrong is not naming the row on the card.
    const res = await decline({
      parts: [{ kind: 'treasures', ref: 'Q999999', name: 'The Wine Glass', fields: ['artist'] }],
      expectedSyncLogId: 68,
    }, client);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('leaves a trail naming what was refused and how much is left', async () => {
    const { client, queries } = makeClient({ proposal: GETBOL });
    mockedConnect.mockResolvedValue(client);

    await decline({ fields: ['name'], expectedSyncLogId: 68 }, client);

    // The decision row is the standing answer and is overwritten by the next
    // one, so the log is where "what did we refuse in August" survives.
    const log = queries.find(q => q.sql.includes('experience_curation_log'));
    expect(log?.sql).toContain(`'declined_held'`);
    const details = JSON.parse(String(log?.params[3]));
    expect(details.fields).toEqual([
      { field: 'name', declined: 'Getbol, Korean Tidal Flats' },
    ]);
    expect(details.fromSyncLogId).toBe(68);
    expect(details.heldLeftOpen).toBe(1);
  });

  it('keeps a refused part\'s value too, since the decision row will not', async () => {
    const { client, queries } = makeClient({ proposal: WITH_A_WORK });
    mockedConnect.mockResolvedValue(client);

    await decline({
      parts: [{ kind: 'treasures', ref: 'Q782639', name: 'The Wine Glass', fields: ['artist'] }],
      expectedSyncLogId: 68,
    }, client);

    // `experience_held_decisions` holds one standing answer per row and the next
    // upsert overwrites it, so once the source proposes a third name the value
    // refused in August survives only here. One entry per field, as the object's
    // arm has always written them.
    const log = queries.find(q => q.sql.includes('experience_curation_log'));
    expect(JSON.parse(String(log?.params[3])).parts).toEqual([{
      kind: 'treasures', name: 'The Wine Glass', field: 'artist',
      declined: 'Jan Vermeer van Haarlem the Elder',
    }]);
  });
});

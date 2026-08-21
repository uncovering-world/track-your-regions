/**
 * Tests for the decline-source path.
 *
 * The rules worth pinning are the ones a reader cannot infer from the column names.
 * A refusal records the value from the *locked proposal*, never from the request, and
 * the queue compares by that value — so a refusal naming something nobody proposed
 * would look like an answer and silence nothing. And a refusal writes nothing to the
 * row at all: the stored value has already won every run since the disagreement began,
 * so what is being closed is the question, not the field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { declineSourceValue } from './declineSourceController.js';
import { OBJECT_LOCK } from '../../db/locks.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
const ADMIN = { id: 1, role: 'admin' as const };

/** Captures the transaction's statements; `claimed` answers the locked re-read. */
function makeClient(claimed?: string[], proposal?: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('experience_sync_changes')) return { rows: proposal ?? [] };
        if (sql.includes(OBJECT_LOCK)) return { rows: [{ curated_fields: claimed ?? [] }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

const PROPOSAL = [{
  sync_log_id: 9,
  changed_fields: [
    { field: 'shortDescription', new: 'The ruins of the ancient city of Aksum…', curatedConflict: true },
    { field: 'name', new: 'Renamed upstream', curatedConflict: true },
  ],
}];

describe('declineSourceValue', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('refuses a curator whose scope does not reach the experience', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await declineSourceValue(
      { user: CURATOR, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('records the value from the proposal, not from the request', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client, queries } = makeClient(['short_description'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await declineSourceValue({
      user: ADMIN,
      params: { id: '96' },
      // A caller naming its own value is ignored: the queue compares the stored refusal
      // against the live proposal, so a refusal of something nobody proposed silences
      // nothing while looking like an answer.
      body: { fields: ['shortDescription'], expectedSyncLogId: 9, declined: 'something else' },
    } as never, res as never);

    const insert = queries.find(q => q.sql.includes('experience_conflict_decisions'));
    expect(insert?.params).toContain('shortDescription');
    expect(insert?.params).toContain(JSON.stringify('The ruins of the ancient city of Aksum…'));
    expect(insert?.params).not.toContain(JSON.stringify('something else'));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      declined: ['shortDescription'], fromSyncLogId: 9,
    }));
  });

  it('writes nothing to the row it is about', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // The stored value has already won every run since the disagreement began. Touching
    // `curated_fields` in particular would be the opposite of the answer given: the claim
    // is what makes the stored value stand.
    expect(queries.find(q => q.sql.includes('UPDATE experiences'))).toBeUndefined();
  });

  it('records one standing answer per field rather than a pile', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    const insert = queries.find(q => q.sql.includes('experience_conflict_decisions'));
    expect(insert?.sql).toContain('ON CONFLICT (experience_id, field)');
    expect(insert?.sql).toContain('DO UPDATE SET declined = EXCLUDED.declined');
  });

  it('leaves a trail, since standing by your own edit used to leave none', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // The value goes in the trail as well as the decision row: the row is the standing
    // answer and is overwritten by the next one, so the log is where "what did we refuse
    // in July" survives.
    const log = queries.find(q => q.sql.includes('experience_curation_log'));
    expect(log?.sql).toContain("'declined_source'");
    expect(String(log?.params[3])).toContain('Renamed upstream');
  });

  it('refuses a run other than the one the card showed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client, queries } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 8 } } as never,
      res as never,
    );

    // Mirror image of accept-source's danger: accepting the wrong run writes a value
    // nobody read, refusing the wrong run silences a proposal nobody read.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fromSyncLogId: 9 }));
    expect(queries.find(q => q.sql.includes('experience_conflict_decisions'))).toBeUndefined();
    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('refuses a field the source is not proposing anything for', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const { client } = makeClient(['name'], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['imageUrl'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refuses on behalf of a claim that has since been released', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    // Someone accepted the source while this card was open: the field is no longer a
    // conflict, and suppressing it would hide a card that should be showing.
    const { client, queries } = makeClient([], PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.find(q => q.sql.includes('experience_conflict_decisions'))).toBeUndefined();
  });

  it('answers every field, including the ones accept-source cannot write', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 96, category_id: 1 }] });
    const LOCATION = [{
      sync_log_id: 9,
      changed_fields: [{ field: 'location', new: { lat: 1, lon: 2 }, curatedConflict: true }],
    }];
    const { client, queries } = makeClient(['location'], LOCATION);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await declineSourceValue(
      { user: ADMIN, params: { id: '96' }, body: { fields: ['location'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    // Refusing writes nothing to the row, so there is no such thing here as a field this
    // endpoint cannot answer for — the asymmetry with accept-source is the point.
    expect(queries.find(q => q.sql.includes('experience_conflict_decisions'))?.params)
      .toContain(JSON.stringify({ lat: 1, lon: 2 }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ declined: ['location'] }));
  });
});

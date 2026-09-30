/**
 * The two writes to a conflict's standing answer (#1148): each spends the
 * place's token and names that place, the refusal records a name the way the
 * catalogue stores one, and the release drops only the fields it was handed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { recordConflictRefusals, releaseConflictRefusals } from './conflictDecisions.js';

/** Aksum, as the token a lock of it would hand out. */
const AKSUM = { id: 96 } as LockedExperience;
const CURATOR = 7;

function fakeClient() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

describe('recording a refusal', () => {
  it('replaces the standing answer per field, on the place whose token it spends', async () => {
    const { client, queries } = fakeClient();
    await recordConflictRefusals(client, AKSUM, CURATOR, [
      { field: 'shortDescription', proposed: 'The ruins of the ancient city of Aksum…' },
      { field: 'location', proposed: { lat: 14.13, lon: 38.72 } },
    ]);
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain('INSERT INTO experience_conflict_decisions');
    expect(queries[0].sql).toContain('ON CONFLICT (experience_id, field)');
    expect(queries[0].params).toEqual([96, 'shortDescription', JSON.stringify('The ruins of the ancient city of Aksum…'), CURATOR]);
    expect(queries[1].params).toEqual([96, 'location', JSON.stringify({ lat: 14.13, lon: 38.72 }), CURATOR]);
  });

  it('records a name as the catalogue stores one, and an absent value as null', async () => {
    const { client, queries } = fakeClient();
    await recordConflictRefusals(client, AKSUM, CURATOR, [
      { field: 'name', proposed: ' Aksum  archaeological site ' },
      { field: 'shortDescription', proposed: undefined },
    ]);
    expect(queries[0].params[2]).toBe(JSON.stringify('Aksum archaeological site'));
    expect(queries[1].params[2]).toBe('null');
  });

  it('writes nothing when there is nothing to refuse', async () => {
    const { client, queries } = fakeClient();
    await recordConflictRefusals(client, AKSUM, CURATOR, []);
    expect(queries).toHaveLength(0);
  });
});

describe('releasing a refusal', () => {
  it('deletes only the named fields of the place whose token it spends', async () => {
    const { client, queries } = fakeClient();
    await releaseConflictRefusals(client, AKSUM, ['name']);
    expect(queries[0].sql).toContain('DELETE FROM experience_conflict_decisions');
    expect(queries[0].sql).toContain('experience_id = $1 AND field = ANY($2::text[])');
    expect(queries[0].params).toEqual([96, ['name']]);
  });
});

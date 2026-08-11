/**
 * Tests for changeset persistence.
 *
 * A run can produce thousands of rows, so these go in batched multi-row inserts
 * rather than one statement per object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { recordSyncChanges, CHANGE_INSERT_BATCH_SIZE, type ChangeRecord } from './changeRecorder.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function record(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    syncLogId: 9,
    experienceId: 501,
    externalId: '156',
    nameSnapshot: 'Serengeti National Park',
    changeType: 'updated',
    changedFields: [{
      field: 'shortDescription', old: 'a', new: 'b', significance: 'minor',
      curatedConflict: false, held: false,
    }],
    significance: 'minor',
    error: null,
    ...overrides,
  };
}

describe('recordSyncChanges', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('writes nothing when there is nothing to write', async () => {
    await recordSyncChanges([]);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('inserts one parameterised row per record', async () => {
    await recordSyncChanges([record(), record({ externalId: '157', experienceId: 502 })]);

    expect(mockedQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO experience_sync_changes');
    expect(params).toHaveLength(16);
    expect(params).toContain('156');
    expect(params).toContain('157');
  });

  it('serialises changed fields as JSON', async () => {
    await recordSyncChanges([record()]);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    const serialised = params.find(p => typeof p === 'string' && p.startsWith('[{'));
    expect(serialised).toBeDefined();
    expect(JSON.parse(String(serialised))[0].field).toBe('shortDescription');
  });

  it('splits large runs into batches', async () => {
    const many = Array.from({ length: CHANGE_INSERT_BATCH_SIZE + 3 }, (_, i) =>
      record({ externalId: String(i), experienceId: i }));

    await recordSyncChanges(many);

    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('accepts a failed record with no experience id', async () => {
    await recordSyncChanges([record({
      changeType: 'failed',
      experienceId: null,
      changedFields: null,
      significance: null,
      error: 'No valid coordinates',
    })]);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('No valid coordinates');
    expect(params).toContain(null);
  });
});

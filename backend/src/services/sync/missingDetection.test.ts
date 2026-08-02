/**
 * Tests for missing-object detection.
 *
 * The guards matter more than the detection: a source outage that returns half
 * the collection must never be read as half the collection disappearing. The
 * partial UNESCO run of 26 July 2026 is the shape of failure being defended
 * against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  countSeenAmongActive,
  MISSING_DETECTION_MIN_COVERAGE,
  type MissingDetectionInput,
} from './missingDetection.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function input(overrides: Partial<MissingDetectionInput> = {}): MissingDetectionInput {
  return {
    sourceCompleteness: 'authoritative',
    errors: 0,
    cancelled: false,
    force: false,
    seenCount: 1247,
    previousActiveCount: 1247,
    ...overrides,
  };
}

describe('missingDetectionSkipReason', () => {
  it('allows detection on a clean, complete run', () => {
    expect(missingDetectionSkipReason(input())).toBeNull();
  });

  it('refuses on a ranked source', () => {
    const reason = missingDetectionSkipReason(input({ sourceCompleteness: 'ranked' }));

    expect(reason).toContain('ranked');
  });

  it('refuses when the run had errors', () => {
    const reason = missingDetectionSkipReason(input({ errors: 1 }));

    expect(reason).toContain('error');
  });

  it('refuses on a force run, naming the wipe rather than blaming coverage', () => {
    // The cleanup empties the category first, so a coverage figure taken after
    // it describes nothing that happened
    const reason = missingDetectionSkipReason(input({ force: true, seenCount: 0 }));

    expect(reason).toContain('force run');
    expect(reason).not.toContain('coverage');
  });

  it('refuses when the run was cancelled', () => {
    expect(missingDetectionSkipReason(input({ cancelled: true }))).toContain('cancelled');
  });

  it('refuses when coverage fell below the floor', () => {
    const reason = missingDetectionSkipReason(input({ seenCount: 1000 }));

    expect(reason).toContain('coverage');
  });

  it('allows detection at exactly the coverage floor', () => {
    const seenCount = Math.ceil(1247 * MISSING_DETECTION_MIN_COVERAGE);

    expect(missingDetectionSkipReason(input({ seenCount }))).toBeNull();
  });

  it('allows detection for a category that was empty before', () => {
    expect(missingDetectionSkipReason(input({ seenCount: 0, previousActiveCount: 0 }))).toBeNull();
  });
});

describe('countSeenAmongActive', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('counts only rows that were already there, matching the denominator', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1200' }] });

    const count = await countSeenAmongActive(1, ['200', '201']);

    expect(count).toBe(1200);
    const sql = String(mockedQuery.mock.calls[0][0]);
    // Same predicate as countActiveExperiences, plus the ids this run saw —
    // otherwise the ratio is not a coverage figure at all
    expect(sql).toContain("source_membership = 'present'");
    expect(sql).toContain('missing_since IS NULL');
    expect(sql).toContain('is_manual = FALSE');
    expect(sql).toContain('external_id = ANY');
  });
});

describe('flagMissingExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('stamps missing_since and returns one record per row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 77, external_id: '1234', name: 'Dresden Elbe Valley' },
        { id: 78, external_id: '1235', name: 'Arabian Oryx Sanctuary' },
      ],
    });

    const records = await flagMissingExperiences(1, 9, false, ['200', '201']);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('UPDATE experiences');
    // Absence is judged against what the run saw, never against a column a dry
    // run does not write
    expect(String(mockedQuery.mock.calls[0][0])).toContain('external_id <> ALL');
    expect(mockedQuery.mock.calls[0][1]).toEqual([1, ['200', '201']]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      syncLogId: 9,
      experienceId: 77,
      externalId: '1234',
      nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing',
    });
  });

  it('leaves curator-created rows alone — they were never in the source to leave it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await flagMissingExperiences(1, 9, false, ['200']);

    // A manual row's `curator-<id>-<ts>` key can never appear in a source
    // listing, so measuring it against one reports the curator's own work as
    // delisted on every clean run
    expect(String(mockedQuery.mock.calls[0][0])).toContain('is_manual = FALSE');
  });

  it('only reads in dry-run mode', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 77, external_id: '1234', name: 'Dresden Elbe Valley' }] });

    const records = await flagMissingExperiences(1, 9, true, ['200']);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT');
    expect(sql).not.toContain('UPDATE');
    expect(records).toHaveLength(1);
  });
});

describe('countActiveExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('counts only rows still considered present', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1247' }] });

    const count = await countActiveExperiences(1);

    expect(count).toBe(1247);
    expect(String(mockedQuery.mock.calls[0][0])).toContain("source_membership = 'present'");
  });

  it('keeps curator-created rows out of the coverage denominator', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1247' }] });

    await countActiveExperiences(1);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('is_manual = FALSE');
  });

  it('excludes rows already flagged missing, so detection cannot switch itself off', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1047' }] });

    await countActiveExperiences(1);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('missing_since IS NULL');
  });
});

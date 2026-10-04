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
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
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
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

/**
 * The connection a real run marks on: what each statement sent, the places the
 * lock statement answers with, and the rows the mark returns.
 */
function markingClient(marked: Record<string, unknown>[] = [], locked: number[] = []) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/^UPDATE/.test(sql.trim())) return { rows: marked };
      if (/FOR NO KEY UPDATE/.test(sql)) return { rows: locked.map(id => ({ id })) };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  mockedConnect.mockResolvedValue(client);
  return { client, sent: () => client.query.mock.calls.map(c => String(c[0])) };
}

function input(overrides: Partial<MissingDetectionInput> = {}): MissingDetectionInput {
  return {
    sourceCompleteness: 'authoritative',
    errors: 0,
    cancelled: false,
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

  it('allows detection for a source that was empty before', () => {
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
    expect(sql).toContain("existence <> 'lost'");
    expect(sql).toContain('external_id = ANY');
  });

  it('keeps the denominator and the numerator on identical terms', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    await countActiveExperiences(1);
    const denominator = String(mockedQuery.mock.calls[0][0]);

    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    await countSeenAmongActive(1, ['200']);
    const numerator = String(mockedQuery.mock.calls[0][0]);

    // A term on one side only makes the ratio something other than coverage
    for (const term of ["source_membership = 'present'", 'missing_since IS NULL',
                        'is_manual = FALSE', "existence <> 'lost'"]) {
      expect(denominator).toContain(term);
      expect(numerator).toContain(term);
    }
  });
});

describe('flagMissingExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('does not ask again about an object already judged lost', async () => {
    const { sent } = markingClient();

    await flagMissingExperiences(1, 9, false, ['200']);

    // Re-stamping missing_since would return it to the review queue after every
    // run, and the only way out would be answering a different question
    const mark = sent().find(sql => /^UPDATE/.test(sql.trim()));
    expect(mark).toContain("existence <> 'lost'");
  });

  it('stamps missing_since on the membership and returns one record per row', async () => {
    const { client, sent } = markingClient([
      { id: 77, external_id: '1234', name: 'Dresden Elbe Valley' },
      { id: 78, external_id: '1235', name: 'Arabian Oryx Sanctuary' },
    ], [77, 78]);

    const records = await flagMissingExperiences(1, 9, false, ['200', '201']);

    // The source's silence is about its own membership (ADR-0084); the place's
    // flag follows from its memberships, so the run writes none of it there.
    const statements = sent();
    const mark = statements.find(sql => /^UPDATE/.test(sql.trim())) as string;
    expect(mark).toContain('UPDATE experience_kind_memberships m SET missing_since = NOW()');
    expect(statements.some(sql => /UPDATE experiences/.test(sql))).toBe(false);
    // The places are locked first, in id order, the order a curator's write
    // takes them before their memberships.
    const lock = statements.findIndex(sql => /ORDER BY id FOR NO KEY UPDATE/.test(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(statements.indexOf(mark));
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledWith(undefined);
    // Absence is judged against what the run saw, never against a column a dry
    // run does not write
    expect(mark).toContain('sm.external_id <> ALL');
    // The mark reaches only the places the lock statement returned.
    expect(mark).toContain('m.experience_id = ANY($3::int[])');
    expect(client.query.mock.calls.find(c => /^UPDATE/.test(String(c[0]).trim()))?.[1]).toEqual([1, ['200', '201'], [77, 78]]);
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
    const { sent } = markingClient();

    await flagMissingExperiences(1, 9, false, ['200']);

    // A manual row's `curator-<id>-<ts>` key can never appear in a source
    // listing, so measuring it against one reports the curator's own work as
    // delisted on every clean run
    expect(sent().find(sql => /^UPDATE/.test(sql.trim()))).toContain('is_manual = FALSE');
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

/**
 * Tests for the admission axis (ADR-0024).
 *
 * Two things are being defended. The guards, because a sweep that fires on a
 * broken run empties a catalogue rather than correcting one. And the SQL shape,
 * because every write here carries two exclusions a future edit could drop
 * without any test noticing — the curator's pin, whose naive form is silently
 * wrong, and `is_manual`, without which a run refuses the curator's own rows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  admissionSweepSkipReason,
  countAdmitted,
  markNotAdmitted,
  markRefused,
  restoreAdmission,
  ADMISSION_SWEEP_MIN_SHARE,
  type AdmissionSweepInput,
} from './admission.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function input(overrides: Partial<AdmissionSweepInput> = {}): AdmissionSweepInput {
  return {
    errors: 0,
    cancelled: false,
    admittedCount: 82,
    previousAdmittedCount: 110,
    ...overrides,
  };
}

/** The statement the last call sent, whitespace collapsed so indentation cannot break a match. */
function lastSql(): string {
  const [sql] = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1];
  return String(sql).replace(/\s+/g, ' ');
}

function lastParams(): unknown[] {
  const [, params] = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1];
  return params as unknown[];
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('admissionSweepSkipReason', () => {
  it('allows the sweep on a clean run that admitted most of the previous set', () => {
    expect(admissionSweepSkipReason(input())).toBeNull();
  });

  it('refuses on a cancelled run', () => {
    expect(admissionSweepSkipReason(input({ cancelled: true }))).toContain('cancelled');
  });

  it('refuses when the run had errors', () => {
    const reason = admissionSweepSkipReason(input({ errors: 3 }));

    expect(reason).toContain('3 error');
  });

  it('refuses when the run admitted nothing at all', () => {
    const reason = admissionSweepSkipReason(input({ admittedCount: 0 }));

    expect(reason).toContain('broken run');
  });

  it('refuses when the admitted set collapsed below the floor', () => {
    // 40 of 110 is 36 %, under the 50 % floor.
    const reason = admissionSweepSkipReason(input({ admittedCount: 40 }));

    expect(reason).toContain('floor');
  });

  it('allows the art test\'s real 110 -> 82, which is a rule working', () => {
    expect(admissionSweepSkipReason(input({ admittedCount: 82, previousAdmittedCount: 110 })))
      .toBeNull();
  });

  it('allows a first run, where there is no previous set to compare against', () => {
    expect(admissionSweepSkipReason(input({ previousAdmittedCount: 0 }))).toBeNull();
  });

  it('treats the floor as inclusive, so exactly half is allowed', () => {
    const exactly = admissionSweepSkipReason(
      input({ admittedCount: 55, previousAdmittedCount: 110 }),
    );
    const justUnder = admissionSweepSkipReason(
      input({ admittedCount: 54, previousAdmittedCount: 110 }),
    );

    expect(ADMISSION_SWEEP_MIN_SHARE).toBe(0.5);
    expect(exactly).toBeNull();
    expect(justUnder).not.toBeNull();
  });
});

describe('markRefused', () => {
  it('does not touch the database when nothing was refused', async () => {
    await markRefused(2, [], false);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('writes the rule\'s own reason against each external id', async () => {
    await markRefused(2, [
      { externalId: 'Q6373', reason: 'not an art museum — archaeology' },
      { externalId: 'Q313746', reason: 'not a museum class — a stretch of wall' },
    ], false);

    expect(lastSql()).toContain("SET admission = 'refused', admission_reason = v.reason");
    expect(lastParams()).toEqual([
      2,
      ['Q6373', 'Q313746'],
      ['not an art museum — archaeology', 'not a museum class — a stretch of wall'],
    ]);
  });

  it('skips a row whose admission a curator pinned', async () => {
    await markRefused(2, [{ externalId: 'Q6373', reason: 'why' }], false);

    // COALESCE, not a bare `?`: curated_fields is nullable, and NULL ? 'x' is
    // NULL, which would skip every row nobody has curated — that is, all of them.
    expect(lastSql()).toContain(
      "NOT COALESCE(experiences.curated_fields ? 'admission', false)",
    );
  });

  it('never refuses a curator-created row', async () => {
    await markRefused(2, [{ externalId: 'Q6373', reason: 'why' }], false);

    expect(lastSql()).toContain('experiences.is_manual = FALSE');
  });

  it('drops the must-see flag along with the admission', async () => {
    await markRefused(2, [{ externalId: 'Q6373', reason: 'why' }], false);

    // Invisible while the row is hidden, and wrong the moment a curator puts it
    // back: a highlight for a work the row no longer holds.
    expect(lastSql()).toContain('is_iconic = CASE');
  });

  it('leaves the must-see flag alone when a curator pinned that one', async () => {
    await markRefused(2, [{ externalId: 'Q6373', reason: 'why' }], false);

    // Its own pin, honoured separately from admission's.
    expect(lastSql()).toContain("COALESCE(experiences.curated_fields ? 'is_iconic', false)");
  });

  it('writes nothing in a dry run, but reports what it would have written', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 7, external_id: 'Q6373', name: 'British Museum' }] });

    const rows = await markRefused(2, [{ externalId: 'Q6373', reason: 'why' }], true);

    expect(lastSql()).toContain('SELECT');
    expect(lastSql()).not.toContain('UPDATE');
    expect(rows).toEqual([{ id: 7, externalId: 'Q6373', name: 'British Museum' }]);
  });
});

describe('restoreAdmission', () => {
  it('does nothing when the run admitted nothing', async () => {
    await restoreAdmission(2, [], false);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('clears the reason along with the refusal', async () => {
    await restoreAdmission(2, ['Q19675'], false);

    expect(lastSql()).toContain("SET admission = 'admitted', admission_reason = NULL");
  });

  it('only reaches rows that are actually refused', async () => {
    await restoreAdmission(2, ['Q19675'], false);

    expect(lastSql()).toContain("experiences.admission = 'refused'");
    expect(lastSql()).toContain('experiences.external_id = ANY($2::text[])');
  });

  it('respects the curator pin, so an override is not undone by a run', async () => {
    await restoreAdmission(2, ['Q19675'], false);

    expect(lastSql()).toContain(
      "NOT COALESCE(experiences.curated_fields ? 'admission', false)",
    );
  });
});

describe('markNotAdmitted', () => {
  it('refuses to run against an empty admitted set', async () => {
    // `external_id <> ALL('{}')` is true of every row, so this would refuse the
    // whole category. The guard says so too; this is the second lock.
    await markNotAdmitted(2, [], 'reason', false);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('only touches rows the category still admits', async () => {
    await markNotAdmitted(2, ['Q19675'], 'nothing placed here', false);

    // Scoped to `admitted`, so a row refused by name earlier in the same run
    // keeps its specific reason instead of this generic one.
    expect(lastSql()).toContain("experiences.admission = 'admitted'");
    expect(lastSql()).toContain('experiences.external_id <> ALL($2::text[])');
  });

  it('never sweeps a curator-created row out of the category', async () => {
    await markNotAdmitted(2, ['Q19675'], 'reason', false);

    expect(lastSql()).toContain('experiences.is_manual = FALSE');
  });

  it('records the generic reason it was given', async () => {
    await markNotAdmitted(2, ['Q19675'], 'nothing placed here', false);

    expect(lastParams()).toEqual([2, ['Q19675'], 'nothing placed here']);
  });

  it('drops the must-see flag on a swept row too', async () => {
    await markNotAdmitted(2, ['Q19675'], 'reason', false);

    expect(lastSql()).toContain('is_iconic = CASE');
  });

  it('writes nothing in a dry run', async () => {
    await markNotAdmitted(2, ['Q19675'], 'reason', true);

    expect(lastSql()).toContain('SELECT');
    expect(lastSql()).not.toContain('UPDATE');
  });
});

describe('countAdmitted', () => {
  it('counts only admitted, non-curator rows in the category', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ count: 82 }] });

    const count = await countAdmitted(2);

    expect(count).toBe(82);
    expect(lastSql()).toContain("admission = 'admitted'");
    expect(lastSql()).toContain('is_manual = FALSE');
  });
});

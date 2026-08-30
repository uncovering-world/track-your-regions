/**
 * Tests for the one statement that points a visible row at the run whose
 * proposal it is holding.
 *
 * Three writers reach it — the object upsert and the two content writers —
 * and what is worth pinning is the predicate they share: only a row a reader
 * can see, only under a gated source, and never from a run that cannot name
 * itself. A run with no log id has nothing to offer the column, and NULL is
 * not "unknown run", it is "nothing is held".
 */

import { describe, it, expect, vi } from 'vitest';
import { pointHeldProposalAt } from './heldProposalPointer.js';

function runner() {
  return { query: vi.fn(async () => ({ rows: [] })) };
}

describe('pointHeldProposalAt', () => {
  it('points the row at the run, only where a reader can see it and the source is gated', async () => {
    const db = runner();

    await pointHeldProposalAt(db, 501, 42);

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET pending_change_sync_log_id = \$2/);
    expect(sql).toMatch(/curation_state <> 'pending'/);
    expect(sql).toMatch(/requires_curation/);
    expect(params).toEqual([501, 42]);
  });

  it('writes nothing for a run that cannot name itself', async () => {
    const db = runner();

    await pointHeldProposalAt(db, 501, null);

    expect(db.query).not.toHaveBeenCalled();
  });
});

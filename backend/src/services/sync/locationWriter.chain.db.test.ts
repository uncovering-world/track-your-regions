import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { publishContents } from '../../controllers/experience/publishContents.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * The pairing chain, executed against PostgreSQL (#522).
 *
 * This spec lives in the database-backed lane (`vitest.db.config.ts`) because
 * what it asserts is which rows the writer's deferred-withdrawal CTE picks, not
 * what its SQL says. Twelve text-level tests of that CTE and fifteen killed
 * mutations did not see the defect it re-runs here: a point under a gated source
 * moved twice with no curator publishing in between, and the second arrival
 * held the *first arrival* — itself unoffered by then — rather than the row a
 * reader could see. Publishing the newest point then released nothing, and a
 * one-point site showed the same place with two pins, for ever.
 *
 * Every step reads its rows back by id. The fixture is one experience of its
 * own, under the gated source the schema seeds, deleted before and after; the
 * smoke fixture (ids 9001-9005) shares this database and is never touched.
 */

const EXPERIENCE_ID = 9100;
const RUN = { syncLogId: null };
const REF = 'X';

interface LocationRow {
  id: number;
  missing_since: Date | null;
  curation_state: string;
  withdrawal_deferred_for_location_id: number | null;
  ordinal: number | null;
}

async function rows(): Promise<LocationRow[]> {
  const result = await pool.query<LocationRow>(
    `SELECT id, missing_since, curation_state, withdrawal_deferred_for_location_id, ordinal
       FROM experience_locations WHERE experience_id = $1 ORDER BY id`,
    [EXPERIENCE_ID],
  );
  return result.rows;
}

async function visibleIds(): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM experience_locations
      WHERE experience_id = $1 AND missing_since IS NULL ORDER BY id`,
    [EXPERIENCE_ID],
  );
  return result.rows.map(r => r.id);
}

/** The unmarked rows a reader can actually see: not pending, so not an arrival nobody has passed. */
async function readerVisibleIds(): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM experience_locations
      WHERE experience_id = $1 AND missing_since IS NULL AND curation_state <> 'pending'
      ORDER BY id`,
    [EXPERIENCE_ID],
  );
  return result.rows.map(r => r.id);
}

/** The source offers one point, at `lon` under `ref`, and nothing else. */
const offer = (lon: number, ref: string) => writeExperienceLocations(
  EXPERIENCE_ID,
  [{ name: 'Chapel', externalRef: ref, lon, lat: 50.5 }],
  RUN,
);

/** A curator's publish of the named points, or of everything unread, in its own transaction. */
async function publish(locationIds?: number[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await publishContents(client, EXPERIENCE_ID, locationIds);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function resetFixture(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [EXPERIENCE_ID]);
}

describe('a point moved twice under a gated source, with no publish in between', () => {
  beforeEach(async () => {
    await resetFixture();
    // Looked up by name: 01-schema.sql inserts the sources ON CONFLICT (name)
    // DO NOTHING, so the id is only an accident of a fresh init.
    const source = await pool.query<{ id: number }>(
      `SELECT id FROM experience_sources WHERE name = 'Places of worship' AND requires_curation`,
    );
    expect(source.rowCount).toBe(1);
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, 'chain-9100', 'Chain chapel', ST_SetSRID(ST_MakePoint(10.5, 50.5), 4326))`,
      [EXPERIENCE_ID, source.rows[0].id],
    );
  });

  afterAll(async () => {
    await resetFixture();
    await pool.end();
  });

  /**
   * The chain, with the later runs offering the point under `laterRef`.
   *
   * Two shapes, because the CTE pairs by reference first and by position after,
   * and each shape rests on a different term of the withdrawn set. Under the
   * same reference, the intermediate arrival is excluded because the visible
   * row's holder is not an arrival the run keeps; under a new reference (a
   * renumbered component that also moved), it is excluded because it is
   * pending -- without that, the by-reference join pairs the newest arrival
   * with the intermediate, the visible row is left unheld and outlives the
   * publish.
   */
  async function chain(laterRef: string): Promise<void> {
    // Run 1: the point arrives pending, and a curator publishes it.
    const first = await offer(10.5, REF);
    expect(first.needsAssignment).toHaveLength(1);
    const l0 = first.needsAssignment[0];
    expect((await rows()).map(r => [r.id, r.curation_state])).toEqual([[l0, 'pending']]);

    await publish();
    expect(await rows()).toMatchObject([{ id: l0, curation_state: 'verified', missing_since: null }]);

    // Run 2: well over ten metres away. The arrival is gated, so the
    // withdrawal of L0 waits on it.
    const second = await offer(10.6, laterRef);
    expect(second.needsAssignment).toHaveLength(1);
    const l1 = second.needsAssignment[0];
    expect(l1).not.toBe(l0);
    expect(await rows()).toMatchObject([
      { id: l0, missing_since: null, ordinal: null, withdrawal_deferred_for_location_id: null },
      { id: l1, curation_state: 'pending', missing_since: null, withdrawal_deferred_for_location_id: l0 },
    ]);

    // Run 3: moved again before anyone answered. The first arrival is
    // unoffered now; the new one must hold L0 -- the row a reader can see --
    // and not L1. This is the row selection no text assertion could check.
    const third = await offer(10.7, laterRef);
    expect(third.needsAssignment).toHaveLength(1);
    const l2 = third.needsAssignment[0];
    expect(l2).not.toBe(l1);
    const afterThird = await rows();
    expect(afterThird).toMatchObject([
      { id: l0, missing_since: null, curation_state: 'verified', withdrawal_deferred_for_location_id: null },
      { id: l1, curation_state: 'pending', withdrawal_deferred_for_location_id: null },
      { id: l2, curation_state: 'pending', missing_since: null, withdrawal_deferred_for_location_id: l0 },
    ]);
    expect(afterThird[1].missing_since).not.toBeNull();
    // Two rows are unmarked -- the held L0 and the pending L2 -- and a reader
    // sees exactly one of them.
    expect(await visibleIds()).toEqual([l0, l2]);
    expect(await readerVisibleIds()).toEqual([l0]);

    // The curator publishes the newest point and nothing else.
    const published = await publish([l2]);
    expect(published.locationsPublished).toBe(1);
    expect(published.withdrawalsReleased).toBe(1);
    expect(await visibleIds()).toEqual([l2]);
    const afterPublish = await rows();
    expect(afterPublish.find(r => r.id === l2)).toMatchObject({ curation_state: 'verified' });
    expect(afterPublish.every(r => r.withdrawal_deferred_for_location_id === null)).toBe(true);

    // Three further runs offering the same point change nothing: one pin, the
    // same row.
    for (let i = 0; i < 3; i += 1) {
      const again = await offer(10.7, laterRef);
      expect(again.needsAssignment).toEqual([]);
      expect(again.unoffered).toBe(0);
      expect(await visibleIds()).toEqual([l2]);
    }
    expect(await rows()).toHaveLength(3);
  }

  it('holds the visible row on the newest arrival under the same reference, and a publish leaves exactly one pin', () =>
    chain(REF));

  it('holds the visible row on the newest arrival under a renumbered reference, and a publish leaves exactly one pin', () =>
    chain('Y'));
});

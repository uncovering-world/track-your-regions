import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { deleteRegions, inRegionTransaction, lockSubtree, restoreRegions, setRegionName } from './regionWriter.js';

/**
 * The region writer's transaction and locks (#689), executed against
 * PostgreSQL: what is asserted is what the statements do to real rows under a
 * real foreign key, which no mocked pool can say.
 *
 * The fixture is a world view of its own: Cyprus holding West, which holds
 * Paphos and Polis, and East with nothing under it. Deleted before and after.
 */

const WORLD_VIEW_ID = 9900;
const CYPRUS = 9901;
const WEST = 9902;
const EAST = 9903;
const PAPHOS = 9904;
const POLIS = 9905;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
}

async function names(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM regions WHERE world_view_id = $1 ORDER BY id', [WORLD_VIEW_ID],
  );
  return result.rows.map((row) => row.name);
}

beforeEach(async () => {
  await clear();
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Region writer fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id) VALUES
       ($1, $6, 'Cyprus', NULL), ($2, $6, 'West', $1), ($3, $6, 'East', $1),
       ($4, $6, 'Paphos', $2), ($5, $6, 'Polis', $2)`,
    [CYPRUS, WEST, EAST, PAPHOS, POLIS, WORLD_VIEW_ID],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('lockSubtree', () => {
  it('answers the branch below the roots, and the roots with withRoots', async () => {
    const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id).sort();
    await inRegionTransaction(async (tx) => {
      expect(ids(await lockSubtree(tx, [WEST], false))).toEqual([PAPHOS, POLIS]);
      expect(ids(await lockSubtree(tx, [WEST], true))).toEqual([WEST, PAPHOS, POLIS]);
      expect(ids(await lockSubtree(tx, [WEST, EAST], false))).toEqual([PAPHOS, POLIS]);
      expect(await lockSubtree(tx, [EAST], false)).toEqual([]);
      // Each answers the root it hangs under, which prune clears by.
      expect(await lockSubtree(tx, [CYPRUS], false)).toEqual(expect.arrayContaining([
        { id: PAPHOS, root: CYPRUS }, { id: WEST, root: CYPRUS },
      ]));
    });
  });

  it('holds the branch against a write from another transaction until the commit', async () => {
    const other = await pool.connect();
    try {
      await inRegionTransaction(async (tx) => {
        await lockSubtree(tx, [WEST], false);
        await other.query("SET lock_timeout = '200ms'");
        await expect(other.query("UPDATE regions SET name = 'Pafos' WHERE id = $1", [PAPHOS]))
          .rejects.toThrow(/lock timeout/);
      });
    } finally {
      await other.query('RESET lock_timeout');
      other.release();
    }
  });
});

describe('inRegionTransaction', () => {
  it('leaves nothing of a change that fails part-way', async () => {
    await expect(inRegionTransaction(async (tx) => {
      await setRegionName(tx, PAPHOS, 'Pafos');
      await deleteRegions(tx, [POLIS]);
      throw new Error('the next statement failed');
    })).rejects.toThrow('the next statement failed');

    expect(await names()).toEqual(['Cyprus', 'West', 'East', 'Paphos', 'Polis']);
  });
});

describe('restoreRegions', () => {
  it('puts back a branch whose child carries the lower id, under the real foreign key', async () => {
    // Paphos (9904) moved under a district the review added later (9910):
    // restored by id, Paphos would name a parent not yet there.
    const snapshot = [
      { id: PAPHOS, name: 'Paphos', parent_region_id: 9910, is_leaf: true, world_view_id: WORLD_VIEW_ID },
      { id: 9910, name: 'Pafos District', parent_region_id: WEST, is_leaf: false, world_view_id: WORLD_VIEW_ID },
    ];
    await inRegionTransaction((tx) => deleteRegions(tx, [PAPHOS]));

    await inRegionTransaction((tx) => restoreRegions(tx, snapshot));

    const restored = await pool.query<{ id: number; parent_region_id: number }>(
      'SELECT id, parent_region_id FROM regions WHERE id = ANY($1::int[]) ORDER BY id', [[PAPHOS, 9910]],
    );
    expect(restored.rows).toEqual([
      { id: PAPHOS, parent_region_id: 9910 },
      { id: 9910, parent_region_id: WEST },
    ]);
  });
});

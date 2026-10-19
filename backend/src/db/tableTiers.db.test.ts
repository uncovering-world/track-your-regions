import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * No serving table references a workbench table (ADR-0124, #1710). A dump of
 * the serving tables leaves the workbench schema behind, and a key from
 * `public` into it would point at nothing there: `region_import_state`'s key
 * to its import run is why `import_runs` is serving. A key the other way, from
 * a workbench table into a serving one, holds while the tiers share a
 * database, and the split decides what replaces it (#1693).
 */

afterAll(async () => {
  await pool.end();
});

describe('the keys between the tiers', () => {
  it('run from workbench into public only, never from public into workbench', async () => {
    const keys = await pool.query<{ key: string }>(
      `SELECT format('%s -> %s', c.conrelid::regclass, c.confrelid::regclass) AS key
         FROM pg_constraint c
         JOIN pg_class own ON own.oid = c.conrelid
         JOIN pg_namespace ons ON ons.oid = own.relnamespace
         JOIN pg_class ref ON ref.oid = c.confrelid
         JOIN pg_namespace rns ON rns.oid = ref.relnamespace
        WHERE c.contype = 'f' AND ons.nspname = 'public' AND rns.nspname = 'workbench'
        ORDER BY 1`,
    );
    expect(keys.rows.map(row => row.key)).toEqual([]);
  });
});

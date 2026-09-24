import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * The database compiles nothing (#994). `db/init/01-schema.sql` sets
 * `jit = off` on the database it builds, so a session opened on it inherits
 * the setting without asking. A planner estimate past `jit_above_cost` would
 * otherwise buy an LLVM compile that costs more than the read: the region
 * location feed for Europe spent 1 079 ms of 1 341 in JIT.
 */
describe('the database a session opens on', () => {
  afterAll(() => pool.end());

  it('runs without JIT compilation', async () => {
    const { rows } = await pool.query<{ jit: string }>('SHOW jit');
    expect(rows[0].jit).toBe('off');
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db/index.js';
import { TEST_DB_NAME_PATTERN } from '../db/testDbName.js';

/**
 * The lane's own proof that it ran (#522).
 *
 * Every other spec in `vitest.db.config.ts` is about one statement and can be
 * moved or retired with it. This one stays, so the lane can never report green
 * on zero files: it reaches the real pool — no `vi.mock` here, which is the
 * whole point of the lane — and asks the database the two things every spec
 * beside it relies on.
 */
describe('the database-backed lane', () => {
  afterAll(() => pool.end());

  it('runs against a database named like a test database', async () => {
    const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
    expect(rows[0].name).toMatch(TEST_DB_NAME_PATTERN);
  });

  it('finds the schema seeded, with a gated source for a spec to write under', async () => {
    // 01-schema.sql seeds "Places of worship" with requires_curation true
    // (ADR-0052); a spec of an arrival's gate builds its fixture under it.
    const { rowCount } = await pool.query(
      'SELECT 1 FROM experience_sources WHERE requires_curation',
    );
    expect(rowCount).toBeGreaterThan(0);
  });
});

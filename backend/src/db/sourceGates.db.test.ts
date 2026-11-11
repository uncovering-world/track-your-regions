/**
 * The gate each source of a fresh database is seeded with (#2335, ADR-0025): a
 * database built from `01-schema.sql` alone gates the arrivals of every place
 * source but the World Heritage list, UNESCO's own official list, and the
 * record of its components, a record in a whole that offers nothing to hold
 * back (ADR-0156, ADR-0198). Production starts from a fresh database, so the seed is the
 * gate it runs with.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';

afterAll(async () => { await pool.end(); });

describe('the seeded curation gates', () => {
  it('gate every place source but the World Heritage list and its components', async () => {
    const result = await pool.query<{ name: string; requires_curation: boolean }>(
      'SELECT name, requires_curation FROM experience_sources ORDER BY id',
    );
    const ungated = result.rows.filter((row) => !row.requires_curation).map((row) => row.name);
    expect(ungated).toEqual(['UNESCO World Heritage Sites', 'World Heritage components']);
    expect(result.rows.find((row) => row.name === 'Art Museums')?.requires_curation).toBe(true);
    expect(result.rows.find((row) => row.name === 'Public art')?.requires_curation).toBe(true);
  });
});

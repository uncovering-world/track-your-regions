/**
 * A claim on metadata names its key (ADR-0077 decision 3, #729): the CHECK on
 * `experiences.curated_fields` refuses the bare column name, which would
 * protect every key while matching none of the names the run records them
 * under. A database-backed spec, since the rule is the schema's.
 *
 * The fixture is the spec's own place, deleted before and after.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';

const PLACE = 9495;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
}

/** Inserts the fixture place with these claims; the error code where it is refused. */
async function placeClaiming(claims: string[]): Promise<string | null> {
  try {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location, curated_fields)
       SELECT $1, id, 'metadata-claim-check-fixture', 'Garamba National Park',
              ST_SetSRID(ST_MakePoint(29.25, 4.0), 4326), $2::jsonb
         FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
      [PLACE, JSON.stringify(claims)],
    );
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('experiences.curated_fields refuses a whole-column metadata claim', () => {
  it('takes a claim on each key, a major one included', async () => {
    expect(await placeClaiming(['description', 'metadata.inDanger', 'metadata.website'])).toBeNull();
    const stored = await pool.query('SELECT curated_fields FROM experiences WHERE id = $1', [PLACE]);
    expect(stored.rows).toEqual([{ curated_fields: ['description', 'metadata.inDanger', 'metadata.website'] }]);
  });

  it('refuses the bare column name on insert', async () => {
    expect(await placeClaiming(['metadata'])).toBe('23514');
  });

  it('refuses the bare column name added to a place that holds per-key claims', async () => {
    expect(await placeClaiming(['metadata.website'])).toBeNull();
    await expect(pool.query(
      `UPDATE experiences SET curated_fields = curated_fields || '["metadata"]'::jsonb WHERE id = $1`, [PLACE],
    )).rejects.toMatchObject({ code: '23514' });
  });
});

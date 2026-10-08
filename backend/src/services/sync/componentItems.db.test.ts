import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { recordComponentItems } from './locationWriter.js';

/**
 * A World Heritage run records each component point's Wikidata item (#1269),
 * against PostgreSQL, on three components of Prehistoric Pile Dwellings around
 * the Alps (1363): one resolves to its item, one held an item no item carries
 * any more and loses it, and one a curator chose an item for keeps that.
 */

const PILES = 9820;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PILES]);
}

async function point(ref: string, item: string | null, claimed: boolean, membershipId: number): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, wikidata_item, curated_fields)
     VALUES ($1, $2, $2, ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326), $3, $4::jsonb) RETURNING id`,
    [PILES, ref, item, JSON.stringify(claimed ? ['wikidata_item'] : [])],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId]);
}

const items = async () => (await pool.query<{ external_ref: string; wikidata_item: string | null }>(
  'SELECT external_ref, wikidata_item FROM experience_locations WHERE experience_id = $1 ORDER BY external_ref', [PILES],
)).rows;

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, '1363-fixture', 'Prehistoric Pile Dwellings around the Alps', ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [PILES],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '1363-fixture', 'auto', NOW() FROM experience_sources s
      WHERE s.name = 'UNESCO World Heritage Sites' RETURNING id`,
    [PILES],
  );
  const id = membership.rows[0].id;
  await point('1363-061', null, false, id);
  await point('1363-070', 'Q31828921', false, id);
  await point('1363-099', 'Q99999999', true, id);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a component's Wikidata item", () => {
  it('is recorded, cleared where no item carries the reference, and kept where a curator chose it', async () => {
    const changed = await recordComponentItems(PILES, [
      { ref: '1363-061', item: 'Q2108010' },
      { ref: '1363-070', item: null },
      { ref: '1363-099', item: 'Q2108011' },
    ], 1);

    expect(changed).toBe(2);
    expect(await items()).toEqual([
      { external_ref: '1363-061', wikidata_item: 'Q2108010' },
      { external_ref: '1363-070', wikidata_item: null },
      { external_ref: '1363-099', wikidata_item: 'Q99999999' },
    ]);
    expect(await recordComponentItems(PILES, [{ ref: '1363-061', item: 'Q2108010' }], 1)).toBe(0);
  });
});

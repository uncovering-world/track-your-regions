import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { descendantSearchScopes, trigramSearch } from './dbSearchMatcher.js';

/**
 * A region inside a matched container is searched for inside that container
 * (#1035), executed against PostgreSQL: the scope is a recursive walk up the
 * region tree and down GADM's, which no mocked pool can say.
 *
 * The fixture mirrors the defect's own case. Its GADM holds Benin with the
 * department Borgou and the commune Parakou under it, and Sudan with its
 * Northern state. Its world view holds Africa, with no members, over Benin,
 * matched to the Benin division, which holds "Northern Benin" and an unmatched
 * "Borgou" over "Parakou"; and a Sudan with no members over a "Northern".
 * Deleted before and after.
 */

const WORLD_VIEW_ID = 9600;
const AFRICA = 9601;
const BENIN = 9602;
const NORTHERN_BENIN = 9603;
const BORGOU = 9604;
const PARAKOU = 9605;
const SUDAN = 9606;
const NORTHERN = 9607;

const BENIN_DIV = 99601;
const BORGOU_DIV = 99602;
const PARAKOU_DIV = 99603;
const SUDAN_DIV = 99604;
const NORTHERN_DIV = 99605;
const DIVISIONS = [BENIN_DIV, BORGOU_DIV, PARAKOU_DIV, SUDAN_DIV, NORTHERN_DIV];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [DIVISIONS]);
}

beforeAll(async () => {
  await clear();
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, parent_id) VALUES
       ($1, 'Benin', NULL), ($2, 'Borgou', $1), ($3, 'Parakou', $2),
       ($4, 'Sudan', NULL), ($5, 'Northern', $4)`,
    DIVISIONS,
  );
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Scope fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $8, 'Africa', NULL, false),
       ($2, $8, 'Benin', $1, false),
       ($3, $8, 'Northern Benin', $2, true),
       ($4, $8, 'Borgou', $2, false),
       ($5, $8, 'Parakou', $4, true),
       ($6, $8, 'Sudan', $1, false),
       ($7, $8, 'Northern', $6, true)`,
    [AFRICA, BENIN, NORTHERN_BENIN, BORGOU, PARAKOU, SUDAN, NORTHERN, WORLD_VIEW_ID],
  );
  await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [BENIN, BENIN_DIV]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the scope a descendant is searched in (#1035)', () => {
  it("is its nearest matched ancestor's members and every level GADM holds under them", async () => {
    const scopes = await descendantSearchScopes([NORTHERN_BENIN, PARAKOU, NORTHERN]);
    const sorted = (ids: number[] | undefined) => [...(ids ?? [])].sort((a, b) => a - b);
    expect(sorted(scopes.get(NORTHERN_BENIN))).toEqual([BENIN_DIV, BORGOU_DIV, PARAKOU_DIV]);
    // Borgou has no members, so Parakou is scoped by Benin above it.
    expect(sorted(scopes.get(PARAKOU))).toEqual([BENIN_DIV, BORGOU_DIV, PARAKOU_DIV]);
    // Nothing above this Northern is matched: there is nothing to scope it by.
    expect(scopes.has(NORTHERN)).toBe(false);
  });

  it("leaves Sudan's Northern state out of a search inside Benin", async () => {
    const scopes = await descendantSearchScopes([NORTHERN_BENIN]);
    expect(await trigramSearch('Northern', 5, scopes.get(NORTHERN_BENIN))).toEqual([]);
    // The same search with Sudan in scope finds it, so the empty answer is the scope's.
    const inSudan = await trigramSearch('Northern', 5, [SUDAN_DIV, NORTHERN_DIV]);
    expect(inSudan.map(c => c.divisionId)).toContain(NORTHERN_DIV);
  });

  it('finds a division two levels under the matched container', async () => {
    const scopes = await descendantSearchScopes([PARAKOU]);
    const found = await trigramSearch('Parakou', 5, scopes.get(PARAKOU));
    expect(found.map(c => c.divisionId)).toEqual([PARAKOU_DIV]);
  });
});

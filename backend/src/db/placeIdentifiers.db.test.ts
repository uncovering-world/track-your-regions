import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { mergePlaces, undoMerge } from '../controllers/experience/placeMerge.js';

/**
 * The place identifier registry (ADR-0143 decision 2, #1892), against
 * PostgreSQL: the triggers on the tables that carry identifiers keep it as
 * `place_identifiers_expected()` derives it, an identifier two live places
 * claim is identifying on neither, and two writers claiming one item at once
 * both commit.
 *
 * The fixture is the Ajanta Caves as the World Heritage run leaves them (a site
 * of one point, its one item recorded on its membership) and a place of worship
 * a later run creates for the same item, as a run did before the resolver.
 */

const AJANTA = 9970;
const COPY = 9971;
const SERIAL = 9972;
const PART_A = 9973;
const PART_B = 9974;
const PLACES = [AJANTA, COPY, SERIAL, PART_A, PART_B];
const ITEM = 'Q9970001';
const OTHER_ITEM = 'Q9970002';
const ENSEMBLE = 'Q9970003';
const ADMIN = '00000000-0000-4000-8000-000000009970';

let heritage: { id: number; kind_id: number };
let worship: { id: number; kind_id: number };
let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[]) OR folded_id = ANY($1::int[])', [PLACES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

async function place(id: number, source: { id: number }, externalId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(75.70, 20.55), 4326))`,
    [id, source.id, externalId, name],
  );
}

async function membership(
  placeId: number, source: { id: number; kind_id: number }, externalId: string, items: string[] | null = null,
): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, wikidata_items, curation_state, published_at)
     VALUES ($1, $2, $3, $4, $5, 'auto', NOW()) RETURNING id`,
    [placeId, source.kind_id, source.id, externalId, items],
  )).rows[0].id;
}

async function point(placeId: number, ref: string, item: string | null = null): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, wikidata_item, location)
     VALUES ($1, $2, $2, $3, ST_SetSRID(ST_MakePoint(75.70, 20.55), 4326)) RETURNING id`,
    [placeId, ref, item],
  )).rows[0].id;
}

/** The registry's rows for these values, as `place:identifies`. */
async function held(values: string[]): Promise<string[]> {
  return (await pool.query<{ row: string }>(
    `SELECT experience_id || ':' || CASE WHEN identifies THEN 'identifies' ELSE 'refers' END AS row
       FROM place_identifiers WHERE value = ANY($1::text[]) ORDER BY experience_id, value`,
    [values],
  )).rows.map(r => r.row);
}

/** Rows the registry holds differently from what its columns derive: the check's own question. */
async function outOfStep(): Promise<number> {
  return Number((await pool.query<{ n: string }>(
    `WITH vals AS (SELECT scheme, array_agg(DISTINCT value) AS values
                     FROM (SELECT scheme, value FROM place_identifier_values()
                           UNION SELECT scheme, value FROM place_identifiers) v GROUP BY scheme),
          expected AS (SELECT vals.scheme, x.* FROM vals CROSS JOIN LATERAL place_identifiers_expected(vals.scheme, vals.values) x)
     SELECT count(*) AS n FROM expected x
       FULL JOIN place_identifiers pi ON pi.scheme = x.scheme AND pi.value = x.value AND pi.experience_id = x.experience_id
      WHERE x.experience_id IS NULL OR pi.experience_id IS NULL
         OR (x.identifies, x.claims_identity, x.basis) IS DISTINCT FROM (pi.identifies, pi.claims_identity, pi.basis)`,
  )).rows[0].n);
}

beforeEach(async () => {
  await clear();
  const source = async (name: string) => (await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  )).rows[0];
  heritage = await source('UNESCO World Heritage Sites');
  worship = await source('Places of worship');
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  await place(AJANTA, heritage, '9970-fixture', 'Ajanta Caves');
  await membership(AJANTA, heritage, '9970-fixture', [ITEM]);
  await point(AJANTA, '9970-fixture');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the place identifier registry (ADR-0143 decision 2)', () => {
  it("makes a site of one point its one item, and its own reference the site's", async () => {
    expect(await held([ITEM, '9970-fixture'])).toEqual([`${AJANTA}:identifies`, `${AJANTA}:identifies`]);
    expect(await outOfStep()).toBe(0);
  });

  it('holds a site of two points as only referring to its item', async () => {
    await point(AJANTA, '9970-second');
    expect(await held([ITEM])).toEqual([`${AJANTA}:refers`]);
  });

  it('makes an item two places claim identifying on neither, and gives it back when the copy goes', async () => {
    await place(COPY, worship, ITEM, 'Ajanta Caves (a copy)');
    await membership(COPY, worship, ITEM);
    expect(await held([ITEM])).toEqual([`${AJANTA}:refers`, `${COPY}:refers`]);
    const claimed = await pool.query(
      `SELECT value FROM place_identifiers WHERE claims_identity AND NOT identifies AND value = $1
        GROUP BY value HAVING count(*) > 1`, [ITEM],
    );
    expect(claimed.rowCount).toBe(1);

    await pool.query('DELETE FROM experiences WHERE id = $1', [COPY]);
    expect(await held([ITEM])).toEqual([`${AJANTA}:identifies`]);
    expect(await outOfStep()).toBe(0);
  });

  it('holds an item two parts carry as their ensemble\'s, and a part\'s own item as the part\'s', async () => {
    await place(SERIAL, heritage, '9972-fixture', 'A serial site');
    const site = await membership(SERIAL, heritage, '9972-fixture', [ENSEMBLE, OTHER_ITEM]);
    for (const [part, ref] of [[PART_A, '9972-001'], [PART_B, '9972-002']] as const) {
      await place(part, heritage, ref, `Part ${ref}`);
      await pool.query(
        `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
         VALUES ($1, $2, 'component', $3, $4)`, [SERIAL, part, site, ref],
      );
      await point(part, ref, ENSEMBLE);
    }
    expect(await held([ENSEMBLE])).toEqual([`${SERIAL}:refers`, `${PART_A}:refers`, `${PART_B}:refers`]);
    expect(await held(['9972-001', '9972-002'])).toEqual([`${PART_A}:identifies`, `${PART_B}:identifies`]);

    // The second part's point is given its own item: the first part's becomes its own.
    await pool.query('UPDATE experience_locations SET wikidata_item = $1 WHERE experience_id = $2', [OTHER_ITEM, PART_B]);
    expect(await held([ENSEMBLE])).toEqual([`${SERIAL}:refers`, `${PART_A}:identifies`]);
    expect(await held([OTHER_ITEM])).toEqual([`${SERIAL}:refers`, `${PART_B}:identifies`]);
    expect(await outOfStep()).toBe(0);
  });

  it('follows a merge to the place that stays, and an undo back', async () => {
    await place(COPY, worship, ITEM, 'Ajanta Caves (a copy)');
    await membership(COPY, worship, ITEM);
    const merged = await mergePlaces({ survivorId: AJANTA, foldedId: COPY, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(merged.refusal).toBeUndefined();
    expect(await held([ITEM])).toEqual([`${AJANTA}:identifies`]);

    const undone = await undoMerge(merged.result!.mergeId, adminId);
    expect(undone.refusal).toBeUndefined();
    expect(await held([ITEM])).toEqual([`${AJANTA}:refers`, `${COPY}:refers`]);
    expect(await outOfStep()).toBe(0);
  });

  it('lets two writers claiming one new item at once both commit, the second seeing the first', async () => {
    // Two runs that each create a place for one item, as runs did before the
    // resolver: the second waits on the item's lock, then reads the first's
    // place and holds both as referring, where without the lock it would be
    // refused by the unique index.
    await place(COPY, worship, OTHER_ITEM, 'A place of worship');
    await place(PART_A, heritage, '9973-fixture', 'An archaeological site');
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(
        `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state)
         VALUES ($1, $2, $3, $4, 'auto')`, [COPY, worship.kind_id, worship.id, OTHER_ITEM],
      );
      const archaeology = (await pool.query<{ id: number; kind_id: number }>(
        `SELECT id, kind_id FROM experience_sources WHERE name = 'Archaeology'`,
      )).rows[0];
      let settled = false;
      const waiting = second.query(
        `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state)
         VALUES ($1, $2, $3, $4, 'auto')`, [PART_A, archaeology.kind_id, archaeology.id, OTHER_ITEM],
      ).finally(() => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await first.query('COMMIT');
      await waiting;
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
    expect(await held([OTHER_ITEM])).toEqual([`${COPY}:refers`, `${PART_A}:refers`]);
    expect(await outOfStep()).toBe(0);
  });
});

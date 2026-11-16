import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { partLineAssertions } from './partLineAssertions.js';

/**
 * A list line's record and point on one place (#2123), against PostgreSQL.
 *
 * The fixture is Thessaloniki's Paleochristian and Byzantine Monuments as
 * #2527 found them: the Rotunda's line (456-002) recorded on the Arch of
 * Galerius and Rotunda, while the point the site places for it stands on a
 * Rotunda of its own that is no part of the site. Ids are the fixture's own,
 * deleted before and after.
 */

const SITE = 9690;
const ARCH = 9691;
const STRAY = 9692;
const CHURCH = 9693;
const PLACES = [SITE, ARCH, STRAY, CHURCH];
const COMPONENTS_SOURCE = 10;
const ROTUNDA = '9690-002';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
}

async function place(id: number, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, $2, $3, ST_SetSRID(ST_MakePoint(22.95, 40.63), 4326))`,
    [id, `line-fixture:${id}`, name],
  );
}

/** The place's record in the site under `reference`. */
const record = (id: number, reference: string) => pool.query(
  `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, $4)`,
  [id, SITE, COMPONENTS_SOURCE, reference],
);

/** A point under `reference` on the place `id`, placed by the site's World Heritage membership. */
async function linePoint(id: number, reference: string): Promise<number> {
  const point = (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Rotunda', $2, ST_SetSRID(ST_MakePoint(22.95, 40.63), 4326)) RETURNING id`,
    [id, reference],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_location_placements (location_id, membership_id)
     SELECT $1, m.id FROM source_records m WHERE m.experience_id = $2 AND m.kind_id IS NOT NULL`,
    [point, SITE],
  );
  return point;
}

async function rows(): Promise<Array<Record<string, unknown>>> {
  return (await pool.query<Record<string, unknown>>(partLineAssertions[0].sql)).rows
    .filter(row => Number(row.whole_id) === SITE);
}

beforeEach(async () => {
  await clear();
  await place(SITE, 'Monuments of Thessalonika (line fixture)');
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9690', 'auto', NOW() FROM experience_sources s WHERE s.id = 1`,
    [SITE],
  );
  await place(ARCH, 'Arch of Galerius and Rotunda');
  await place(STRAY, 'Rotunda');
  await place(CHURCH, 'Church of Acheiropoietos');
  await record(ARCH, ROTUNDA);
  await record(CHURCH, '9690-001');
  await linePoint(CHURCH, '9690-001');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a line whose record and point stand on different places', () => {
  it('names the line, the place holding its record and the one holding its point', async () => {
    const point = await linePoint(STRAY, ROTUNDA);

    const found = await rows();
    expect(found).toMatchObject([{ reference: ROTUNDA, record_place_id: ARCH, point_id: point, point_place_id: STRAY }]);
    expect(partLineAssertions[0].describe(found[0])).toBe(
      `Monuments of Thessalonika (line fixture), ${ROTUNDA}: its record is on Arch of Galerius and Rotunda `
      + `(#${ARCH}). Its point ${point} is on Rotunda (#${STRAY}).`,
    );
  });

  it('leaves a line whose point stands on its record\'s place, and a record whose line has no point', async () => {
    await linePoint(ARCH, ROTUNDA);
    expect(await rows()).toEqual([]);
    await pool.query('DELETE FROM experience_locations WHERE experience_id = $1', [ARCH]);
    expect(await rows()).toEqual([]);
  });

  it('leaves a point the site does not place, and one on a place holding a record under the same reference', async () => {
    // Another kind's point on the stray place, under the line's reference: not the site's line.
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location)
       VALUES ($1, 'Rotunda', $2, ST_SetSRID(ST_MakePoint(22.95, 40.63), 4326))`,
      [STRAY, ROTUNDA],
    );
    expect(await rows()).toEqual([]);
    // A line listed once per country holds a record on each of its places under one reference.
    await linePoint(STRAY, ROTUNDA);
    await record(STRAY, ROTUNDA);
    expect(await rows()).toEqual([]);
  });
});

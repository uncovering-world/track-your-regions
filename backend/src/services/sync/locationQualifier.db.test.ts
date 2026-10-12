import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * A part's name a gated source extended with a qualifier passes the gate
 * (#1353), executed against PostgreSQL: the writer decides it in SQL, under
 * the row it updates. The fixture is one of the Wooden Churches of Southern
 * Małopolska as the World Heritage list renamed it on 2026-10-10 — *Church of
 * All Saints* → *Church of All Saints, Blizne* — on a place readers see, under
 * a gated source. Ids are the fixture's own, deleted before and after.
 */

const CHURCHES = 9850;
const QID = 'Q9850-wooden-churches-fixture';
const REF = '1053-001';
const POINT = { externalRef: REF, lon: 21.9725, lat: 49.8986 };

let archaeology = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [CHURCHES, QID]);
}

const pointName = async () => (await pool.query<{ name: string }>(
  'SELECT name FROM experience_locations WHERE experience_id = $1 AND external_ref = $2', [CHURCHES, REF],
)).rows[0].name;

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number; requires_curation: boolean }>(
    "SELECT id, kind_id, requires_curation FROM experience_sources WHERE name = 'Archaeology'",
  )).rows[0];
  expect(source.requires_curation).toBe(true);
  archaeology = source.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Wooden Churches of Southern Małopolska', ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [CHURCHES, archaeology, QID, POINT.lon, POINT.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'verified', NOW())`,
    [CHURCHES, source.kind_id, archaeology, QID],
  );
  await writeExperienceLocations(CHURCHES, [{ ...POINT, name: 'Church of All Saints' }], { syncLogId: null, sourceId: archaeology });
  // Published, so a reader sees the point and the gate holds what the source changes.
  await pool.query(
    "UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1", [CHURCHES],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a part's name under a gated source (#1353)", () => {
  it('takes a qualifier the source added, written and recorded as passed', async () => {
    const result = await writeExperienceLocations(
      CHURCHES, [{ ...POINT, name: 'Church of All Saints, Blizne' }], { syncLogId: null, sourceId: archaeology },
    );

    expect(await pointName()).toBe('Church of All Saints, Blizne');
    expect(result.delta.changed[0].fields).toEqual([expect.objectContaining({
      field: 'name', held: false, passedTheGate: 'qualifier',
    })]);
  });

  it('holds a name that only begins with the stored one: another dedication', async () => {
    await pool.query("UPDATE experience_locations SET name = 'Church of St Mary' WHERE experience_id = $1", [CHURCHES]);
    const result = await writeExperienceLocations(
      CHURCHES, [{ ...POINT, name: 'Church of St Mary Magdalene' }], { syncLogId: null, sourceId: archaeology },
    );

    expect(await pointName()).toBe('Church of St Mary');
    expect(result.delta.changed[0].fields).toEqual([expect.objectContaining({ field: 'name', held: true })]);
  });

  it('holds a name the source replaced', async () => {
    const result = await writeExperienceLocations(
      CHURCHES, [{ ...POINT, name: 'All Saints, Blizne' }], { syncLogId: null, sourceId: archaeology },
    );

    expect(await pointName()).toBe('Church of All Saints');
    expect(result.delta.changed[0].fields).toEqual([expect.objectContaining({ field: 'name', held: true })]);
    expect(result.delta.changed[0].fields[0]).not.toHaveProperty('passedTheGate');
  });
});

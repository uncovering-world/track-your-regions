import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * A record's default shape at the 1 km rule (ADR-0218 decision 3), against
 * PostgreSQL. `default_shape_of()` measures each part's point from an origin,
 * the point nearest the points' centre, and measures a pair only when its two
 * distances from the origin add up to 1 km. The cases stand on either side of
 * the rule and name their origin; the 720 m and 600 m ones are records that
 * distances from the origin alone would call areas, which only measuring
 * their pair shows to be of shape none.
 *
 * The points are placed by geodesic distance and bearing from a spot in the
 * Vienna Woods (`ST_Project`), as the parcels of one estate would lie.
 * Everything is deleted before and after; the dependants cascade.
 */

const WHOLE = 923000;
const CENTRE = { lon: 16.25, lat: 48.2 };

type Placed = [metres: number, bearing: number];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id BETWEEN 923000 AND 923999');
}

/** A whole made a whole by one statement, its parts placed from the centre in this order. */
async function shapeOf(parts: Placed[]): Promise<string | null> {
  const ids = parts.map((_, i) => WHOLE + 1 + i);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT g, s.id, 'Q' || g || '001', 'Whole shape fixture ' || g, ST_SetSRID(ST_MakePoint($2, $3), 4326)
       FROM unnest($1::int[]) AS g, experience_sources s WHERE s.name = 'Art Museums'`,
    [[WHOLE, ...ids], CENTRE.lon, CENTRE.lat],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     SELECT p.id, 'fixture point', 1,
            ST_Project(ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, p.metres, radians(p.bearing))::geometry, 'auto'
       FROM unnest($1::int[], $2::float8[], $3::float8[]) WITH ORDINALITY AS p(id, metres, bearing, n)
      ORDER BY p.n`,
    [ids, parts.map(([metres]) => metres), parts.map(([, bearing]) => bearing), CENTRE.lon, CENTRE.lat],
  );
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason) SELECT $1, g, 'curator' FROM unnest($2::int[]) AS g`,
    [WHOLE, ids],
  );
  const shape = await pool.query<{ shape: string }>('SELECT shape FROM experiences WHERE id = $1', [WHOLE]);
  return shape.rows[0].shape;
}

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a record's default shape at the 1 km rule (ADR-0218)", () => {
  it('is an area with two parts 999.9 m apart, and none with two 1,000.1 m apart', async () => {
    // Either part is the origin, the two lying as near the centre; the other
    // reaches past half the rule, and the pair is measured.
    expect(await shapeOf([[0, 0], [999.9, 0]])).toBe('area');
    await clear();
    expect(await shapeOf([[0, 0], [1000.1, 0]])).toBe('none');
  });

  it('measures a pair 700 m or 720 m from the origin at right angles: 990 m apart an area, 1,018 m none', async () => {
    // The origin is the corner part, nearest the three's centre; both others
    // are within 1 km of it, so only measuring their pair settles the whole.
    expect(await shapeOf([[0, 0], [700, 0], [700, 90]])).toBe('area');
    await clear();
    expect(await shapeOf([[0, 0], [720, 0], [720, 90]])).toBe('none');
  });

  it('is none by a pair 1,200 m apart, each 600 m from the origin between them', async () => {
    expect(await shapeOf([[0, 0], [600, 0], [600, 180]])).toBe('none');
  });

  it('is an area with 40 parts on one spot, and with 40 parts all within 470 m of the first', async () => {
    expect(await shapeOf(Array.from({ length: 40 }, (): Placed => [0, 0]))).toBe('area');
    await clear();
    expect(await shapeOf(Array.from({ length: 40 }, (_, i): Placed => [i * 12, i * 9]))).toBe('area');
  });

  it('is an area with a gatehouse 700 m from 757 parcels within 150 m, measured from a parcel', async () => {
    // The gatehouse is the first part, and never the origin: measured from it,
    // every parcel would reach past half the rule and every pair be measured.
    // From a parcel near the centre only the gatehouse reaches that far, and no
    // parcel reaches the 300 m that would make a pair with it worth measuring.
    const parcels = Array.from({ length: 757 }, (_, i): Placed => [150 * Math.sqrt((i + 0.5) / 757), i * 137.508]);
    expect(await shapeOf([[700, 90], ...parcels])).toBe('area');
  });
});

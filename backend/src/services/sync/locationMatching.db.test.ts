import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * The pairing of a run's points with the stored ones finds the complete match
 * (#549, ADR-0117), against PostgreSQL. The fixture is the Bronze Horseman as
 * Wikidata gives it: one item, Q672444, with two coordinates under one
 * reference, under the ungated Public Art & Monuments source. The geometry is
 * the issue's: the run's two points stand 15 m apart; the stored first point is
 * halfway between them, 7.5 m from each, and the stored second point 9 m from
 * the run's eastern one. The run lists them in the other order from the stored
 * one, as a Wikidata item does when its statements are reordered, so the fast
 * path's pairing by position fails and the pairing decides. Both run points'
 * best row is then the stored first, and the greedy passes alone paired one
 * point, inserted the other as new and withdrew the stored second. Ids are the
 * fixture's own, deleted before and after.
 */

const HORSEMAN = 9549;
const QID = 'Q9549-bronze-horseman-fixture';
const REF = 'Q672444';
const LAT = 59.9364;
const LON = 30.3022;
// Metres east and north to degrees at Senate Square's latitude, as the
// geography type measures them to well under the margins below.
const at = (east: number, north: number) => ({
  lon: LON + east / (111_320 * Math.cos((LAT * Math.PI) / 180)),
  lat: LAT + north / 110_640,
});

let source = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [HORSEMAN, QID]);
}

const offeredIds = async () => (await pool.query<{ id: number }>(
  'SELECT id FROM experience_locations WHERE experience_id = $1 AND missing_since IS NULL ORDER BY id',
  [HORSEMAN],
)).rows.map(row => row.id);

/** The run: the eastern point first, then the western one. */
const RUN = [
  { name: null, externalRef: REF, ...at(15, 0) },
  { name: null, externalRef: REF, ...at(0, 0) },
];

beforeEach(async () => {
  await clear();
  const row = (await pool.query<{ id: number; kind_id: number; requires_curation: boolean }>(
    "SELECT id, kind_id, requires_curation FROM experience_sources WHERE name = 'Public Art & Monuments'",
  )).rows[0];
  expect(row.requires_curation).toBe(false);
  source = row.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Bronze Horseman', ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [HORSEMAN, source, QID, LON, LAT],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW())`,
    [HORSEMAN, row.kind_id, source, QID],
  );
  // The stored state: the first point halfway between where the run will put
  // its two, the second 9 m north of the run's second.
  await writeExperienceLocations(HORSEMAN, [
    { name: null, externalRef: REF, ...at(7.5, 0) },
    { name: null, externalRef: REF, ...at(15, 9) },
  ], { syncLogId: null, sourceId: source });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('two points of one reference 10–20 m apart (#549)', () => {
  it('is the geometry the greedy passes lose on', async () => {
    // Both run points' best row is the stored first, which is what made the
    // greedy passes give it to both and keep it for the lower ordinal.
    const distances = await pool.query<{ ordinal: number; to_first: number; to_second: number }>(
      `WITH run(ordinal, lon, lat) AS (VALUES (1, $2::float8, $3::float8), (2, $4::float8, $5::float8))
       SELECT run.ordinal,
              ST_Distance(a.location::geography, ST_SetSRID(ST_MakePoint(run.lon, run.lat), 4326)::geography) AS to_first,
              ST_Distance(b.location::geography, ST_SetSRID(ST_MakePoint(run.lon, run.lat), 4326)::geography) AS to_second
       FROM run,
            experience_locations a, experience_locations b
       WHERE a.experience_id = $1 AND a.ordinal = 1 AND b.experience_id = $1 AND b.ordinal = 2
       ORDER BY run.ordinal`,
      [HORSEMAN, RUN[0].lon, RUN[0].lat, RUN[1].lon, RUN[1].lat],
    );
    const [east, west] = distances.rows;
    // The eastern point can be either stored row and prefers the first...
    expect(east.to_first).toBeLessThan(east.to_second);
    expect(east.to_second).toBeLessThan(10);
    // ...and the western one can only be the first.
    expect(west.to_first).toBeLessThan(10);
    expect(west.to_second).toBeGreaterThan(10);
  });

  it('pairs both run points with the stored rows, inserting nothing and withdrawing nothing', async () => {
    const before = await offeredIds();
    const result = await writeExperienceLocations(HORSEMAN, RUN, { syncLogId: null, sourceId: source });

    expect(await offeredIds()).toEqual(before);
    expect(result.unoffered).toBe(0);
    expect(result.delta.added).toEqual([]);
    expect(result.delta.withdrawn).toEqual([]);
    expect((await pool.query('SELECT 1 FROM experience_locations WHERE experience_id = $1', [HORSEMAN])).rowCount).toBe(2);
  });
});

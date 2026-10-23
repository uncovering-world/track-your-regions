import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { shortMovePassesSql } from '../../db/shortMove.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * A short move of a place or a point a reader sees passes the gate (#1837,
 * ADR-0140), against PostgreSQL. The fixture is the Choragic Monument of
 * Lysicrates as Archaeology's run held it on 2026-10-22: its point moved 28 m,
 * onto the monument. Two GADM leaves of the fixture's own stand in for the
 * district and its neighbour. Ids are the fixture's own, deleted before and
 * after.
 */

const LYSICRATES = 9837;
const QID = 'Q9837-lysicrates-fixture';
const NEIGHBOUR = 9838;
const NEIGHBOUR_QID = 'Q9838-neighbour-fixture';
const DISTRICT = 98370001;
const NEXT_DISTRICT = 98370002;

const STORED = { lon: 23.73, lat: 37.970833 };
const ONTO_THE_MONUMENT = { lon: 23.729949, lat: 37.971083 };

let archaeology = 0;
let kind = 0;

const box = (west: number, east: number) =>
  `MULTIPOLYGON(((${west} 37.95, ${east} 37.95, ${east} 37.99, ${west} 37.99, ${west} 37.95)))`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[]) OR external_id = ANY($2::text[])',
    [[LYSICRATES, NEIGHBOUR], [QID, NEIGHBOUR_QID]]);
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[DISTRICT, NEXT_DISTRICT]]);
}

/** A place readers see, with one verified point under its own reference. */
async function publishedPlace(id: number, qid: string, at: { lon: number; lat: number }): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [id, archaeology, qid, at.lon, at.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, admission)
     VALUES ($1, $2, $3, $4, 'verified', NOW(), 'admitted')`,
    [id, kind, archaeology, qid],
  );
  await writeExperienceLocations(id, [{ externalRef: qid, name: null, ...at }], { syncLogId: null, sourceId: archaeology });
  await pool.query("UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1", [id]);
}

const passes = async (to: { lon: number; lat: number }) => (await pool.query<{ passes: boolean }>(
  `SELECT ${shortMovePassesSql('$1::int', 'ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)',
    'ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326)')} AS passes`,
  [LYSICRATES, STORED.lon, STORED.lat, to.lon, to.lat],
)).rows[0].passes;

const points = async () => (await pool.query<{
  lon: number; lat: number; state: string; missing: boolean; moved_to: number | null;
}>(
  `SELECT ST_X(location) AS lon, ST_Y(location) AS lat, curation_state AS state,
          missing_since IS NOT NULL AS missing, moved_to_location_id AS moved_to
     FROM experience_locations WHERE experience_id = $1 ORDER BY id`, [LYSICRATES],
)).rows;

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number; requires_curation: boolean }>(
    "SELECT id, kind_id, requires_curation FROM experience_sources WHERE name = 'Archaeology'",
  )).rows[0];
  expect(source.requires_curation).toBe(true);
  [archaeology, kind] = [source.id, source.kind_id];
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, geom) VALUES
       ($1, 'Lysicrates district fixture', ST_GeomFromText($3, 4326)),
       ($2, 'Neighbouring district fixture', ST_GeomFromText($4, 4326))`,
    // The district's edges lie 88 m west and 88 m east of the stored point.
    [DISTRICT, NEXT_DISTRICT, box(23.729, 23.731), box(23.731, 23.733)],
  );
  await publishedPlace(LYSICRATES, QID, STORED);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the short-move rule', () => {
  it('passes 28 m onto the monument, in the same district', async () => {
    expect(await passes(ONTO_THE_MONUMENT)).toBe(true);
  });

  it('holds a move into another district, into none, and one of 250 m or more', async () => {
    expect(await passes({ lon: 23.7312, lat: STORED.lat })).toBe(false);
    expect(await passes({ lon: 23.7289, lat: STORED.lat })).toBe(false);
    // 278 m north, inside the district.
    expect(await passes({ lon: STORED.lon, lat: STORED.lat + 0.0025 })).toBe(false);
  });

  it('holds a move that lands nearer another place than its own stored point', async () => {
    await publishedPlace(NEIGHBOUR, NEIGHBOUR_QID, { lon: 23.72995, lat: 37.97112 });
    expect(await passes(ONTO_THE_MONUMENT)).toBe(false);
  });

  it('passes it all the same where that place is a part of the same place', async () => {
    await publishedPlace(NEIGHBOUR, NEIGHBOUR_QID, { lon: 23.72995, lat: 37.97112 });
    await pool.query("INSERT INTO experience_parts (whole_id, part_id, reason) VALUES ($1, $2, 'curator')", [LYSICRATES, NEIGHBOUR]);
    expect(await passes(ONTO_THE_MONUMENT)).toBe(true);
  });
});

describe('a point a reader sees, moved a short way', () => {
  it('takes the new spot: the arrival is published, the old point names it and leaves the map', async () => {
    const result = await writeExperienceLocations(
      LYSICRATES, [{ externalRef: QID, name: null, ...ONTO_THE_MONUMENT }], { syncLogId: null, sourceId: archaeology },
    );

    const [old, arrived] = await points();
    expect(arrived).toMatchObject({ lon: ONTO_THE_MONUMENT.lon, lat: ONTO_THE_MONUMENT.lat, state: 'verified', missing: false });
    expect(old).toMatchObject({ missing: true, moved_to: expect.any(Number) });
    expect(result.delta.changed).toEqual([expect.objectContaining({
      fields: [expect.objectContaining({ field: 'location', held: false, passedTheGate: 'short-move' })],
    })]);
  });

  it('leaves alone a point the run placed as adopted from another source (ADR-0137)', async () => {
    await pool.query(
      `UPDATE experience_location_placements SET adopted_ref = $2
        WHERE location_id IN (SELECT id FROM experience_locations WHERE experience_id = $1)`,
      [LYSICRATES, QID],
    );
    await writeExperienceLocations(
      LYSICRATES, [{ externalRef: QID, name: null, ...ONTO_THE_MONUMENT }], { syncLogId: null, sourceId: archaeology },
    );

    // The arrival waits for a curator, and the adopted point stays where readers see it.
    const [old, arrived] = await points();
    expect(old).toMatchObject({ lon: STORED.lon, missing: false, moved_to: null });
    expect(arrived).toMatchObject({ state: 'pending' });
  });

  it('waits for a curator where the point moves 300 m', async () => {
    await writeExperienceLocations(
      LYSICRATES, [{ externalRef: QID, name: null, lon: STORED.lon, lat: STORED.lat + 0.0027 }],
      { syncLogId: null, sourceId: archaeology },
    );

    const [old, arrived] = await points();
    expect(old).toMatchObject({ state: 'verified', missing: false, moved_to: null });
    expect(arrived).toMatchObject({ state: 'pending' });
  });

  it('waits where no curator verified the old point', async () => {
    // A point written before the source was gated, which nobody passed.
    const old = (await pool.query<{ id: number }>('SELECT id FROM experience_locations WHERE experience_id = $1', [LYSICRATES])).rows[0].id;
    await pool.query('DELETE FROM experience_location_placements WHERE location_id = $1', [old]);
    await pool.query('DELETE FROM experience_locations WHERE id = $1', [old]);
    await pool.query(
      `WITH point AS (
         INSERT INTO experience_locations (experience_id, external_ref, ordinal, location, curation_state)
         VALUES ($1, $2, 1, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'auto') RETURNING id)
       INSERT INTO experience_location_placements (location_id, membership_id)
       SELECT point.id, m.id FROM point, experience_kind_memberships m WHERE m.experience_id = $1`,
      [LYSICRATES, QID, STORED.lon, STORED.lat],
    );
    await writeExperienceLocations(
      LYSICRATES, [{ externalRef: QID, name: null, ...ONTO_THE_MONUMENT }], { syncLogId: null, sourceId: archaeology },
    );

    const [kept, arrived] = await points();
    expect(kept).toMatchObject({ state: 'auto', missing: false, moved_to: null });
    expect(arrived).toMatchObject({ state: 'pending' });
  });
});

describe('the place\'s own coordinate, moved a short way', () => {
  const record = (at: { lon: number; lat: number }): ExperienceUpsertParams => ({
    sourceId: archaeology, externalId: QID, name: QID, nameLocal: {}, subtitle: null, description: null,
    type: null, tags: [], ...at, countryCodes: ['GR'], countryNames: ['Greece'], imageUrl: null, metadata: {},
  });

  it('is written past the gate, and a move into another district is held', async () => {
    await upsertExperienceRecord(record(STORED));
    const moved = await upsertExperienceRecord(record(ONTO_THE_MONUMENT));
    expect(moved.changeSet.heldFields).toEqual([]);
    expect(moved.changeSet.changedFields.map(f => [f.field, f.passedTheGate])).toEqual([['location', 'short-move']]);

    // 110 m east, across the district's edge.
    const crossed = await upsertExperienceRecord(record({ lon: 23.7312, lat: ONTO_THE_MONUMENT.lat }));
    expect(crossed.changeSet.heldFields.map(f => f.field)).toEqual(['location']);
    const place = (await pool.query<{ lon: number }>('SELECT ST_X(location) AS lon FROM experiences WHERE id = $1', [LYSICRATES])).rows[0];
    expect(place.lon).toBeCloseTo(ONTO_THE_MONUMENT.lon, 6);
  });
});

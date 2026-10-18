import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';
import { mergePlaces, undoMerge } from './placeMerge.js';
import { editLocation } from './locationEditController.js';

/**
 * A part of a serial site merged with another kind's place (ADR-0100 decision
 * 4, #1250), against PostgreSQL. The fixture is Ancient Thebes as the World
 * Heritage run leaves it, the Temple of Karnak and the Luxor Temple its parts,
 * and the Karnak Temple Complex of Places of worship, one place with the
 * Temple of Karnak on the ground, its point a few metres from the component's.
 */

const THEBES = 9960;
const COMPLEX = 9961;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const ADMIN = '00000000-0000-4000-8000-000000009960';

let run: LocationWriteRun;
let adminId = 0;
let complexPoint = 0;

const PLACES = `(SELECT part_id FROM experience_parts WHERE whole_id = ${THEBES}
                 UNION SELECT folded_id FROM experience_merges WHERE survivor_id = ${COMPLEX})`;

async function clear(): Promise<void> {
  await pool.query(`DELETE FROM experience_merges WHERE survivor_id = $1 OR folded_id = $1`, [COMPLEX]);
  await pool.query(`UPDATE experience_locations SET merged_into_id = NULL
                     WHERE experience_id IN ${PLACES} OR experience_id = ANY($1::int[])`, [[THEBES, COMPLEX]]);
  await pool.query(`UPDATE experiences SET merged_into_id = NULL WHERE id IN ${PLACES}`);
  await pool.query(`DELETE FROM experiences WHERE id IN ${PLACES} AND id <> $1`, [COMPLEX]);
  await pool.query(`DELETE FROM experiences WHERE id IN (SELECT experience_id FROM experience_locations
                     WHERE external_ref LIKE '87-00%' AND experience_id <> ALL($1::int[]))`, [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[THEBES, COMPLEX]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

/** Thebes' parts, by their component reference. */
async function parts() {
  return (await pool.query<{ part_id: number; external_ref: string; name: string }>(
    `SELECT p.part_id, p.external_ref, e.name FROM experience_parts p JOIN experiences e ON e.id = p.part_id
      WHERE p.whole_id = $1 ORDER BY p.external_ref`, [THEBES],
  )).rows;
}

const complex = async () => (await pool.query<{ name: string; lon: number; lat: number; curated: string[] }>(
  `SELECT name, ST_X(location) AS lon, ST_Y(location) AS lat, curated_fields AS curated FROM experiences WHERE id = $1`,
  [COMPLEX],
)).rows[0];

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  const heritage = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: heritage.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '87-fixture', 'Ancient Thebes (part merge fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
    [THEBES, heritage.id],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '87-fixture', 'auto', NOW())`,
    [THEBES, heritage.kind_id, heritage.id],
  );
  await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, 'Q522862-fixture', 'Karnak Temple Complex', ST_SetSRID(ST_MakePoint(32.6575, 25.7189), 4326)
       FROM experience_sources s WHERE s.name = 'Places of worship'`,
    [COMPLEX],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, 'Q522862-fixture', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'
     RETURNING id`,
    [COMPLEX],
  );
  complexPoint = (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Karnak Temple Complex', 'Q522862-fixture', ST_SetSRID(ST_MakePoint(32.6575, 25.7189), 4326)) RETURNING id`,
    [COMPLEX],
  )).rows[0].id;
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [complexPoint, membership.rows[0].id]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** Fold the Temple of Karnak into the Karnak Temple Complex, as the catalogue's merge on an equal item would. */
async function mergeKarnak(): Promise<{ templeId: number; mergeId: number }> {
  const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
  const outcome = await mergePlaces({ survivorId: COMPLEX, foldedId: templeId, mergedBy: null, reason: 'equal_wikidata_item' });
  expect(outcome.refusal).toBeUndefined();
  return { templeId, mergeId: outcome.result!.mergeId };
}

describe('a part merged with another kind\'s place (ADR-0100 decision 4)', () => {
  it('makes the place the part: the site keeps its part, under the same reference', async () => {
    const { templeId } = await mergeKarnak();
    const now = await parts();
    expect(now.map(p => p.external_ref)).toEqual(['87-001', '87-002']);
    expect(now[0].part_id).toBe(COMPLEX);
    const temple = await pool.query<{ merged_into_id: number }>('SELECT merged_into_id FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].merged_into_id).toBe(COMPLEX);
    // The component's point folded into the complex's: one place on the ground, one pin.
    const folded = await pool.query<{ merged_into_id: number }>(
      'SELECT merged_into_id FROM experience_locations WHERE experience_id = $1', [templeId],
    );
    expect(folded.rows).toEqual([{ merged_into_id: complexPoint }]);
  });

  it('keeps the place its own name and anchor, and the site no new part, when the site\'s run writes again', async () => {
    await mergeKarnak();
    const before = await complex();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);

    const after = await complex();
    expect(after.name).toBe('Karnak Temple Complex');
    expect([after.lon, after.lat]).toEqual([before.lon, before.lat]);
    expect((await parts()).map(p => [p.external_ref, p.part_id === COMPLEX])).toEqual([['87-001', true], ['87-002', false]]);
  });

  it('keeps the place its own name, anchor and the relation its reference when its own point is written', async () => {
    await mergeKarnak();
    const before = await complex();
    // What the Places of worship run, or a curator, writes on the complex's own point.
    await pool.query(
      `UPDATE experience_locations SET name = 'Karnak (temple point)', location = ST_SetSRID(ST_MakePoint(32.6590, 25.7195), 4326)
        WHERE id = $1`, [complexPoint],
    );
    const after = await complex();
    expect(after.name).toBe('Karnak Temple Complex');
    expect([after.lon, after.lat]).toEqual([before.lon, before.lat]);
    expect((await parts())[0]).toMatchObject({ external_ref: '87-001', part_id: COMPLEX });
  });

  it('gives the site its part back on the undo', async () => {
    const { templeId, mergeId } = await mergeKarnak();
    const outcome = await undoMerge(mergeId, adminId);
    expect(outcome.refusal).toBeUndefined();
    expect((await parts()).map(p => [p.external_ref, p.part_id])[0]).toEqual(['87-001', templeId]);
    const relations = await pool.query('SELECT 1 FROM experience_parts WHERE part_id = $1', [COMPLEX]);
    expect(relations.rowCount).toBe(0);
  });

  it('gives the part back its point\'s name on the undo where the kinded place folded into the part', async () => {
    const templeId = (await parts()).find(p => p.external_ref === KARNAK.externalRef)!.part_id;
    const outcome = await mergePlaces({ survivorId: templeId, foldedId: COMPLEX, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(outcome.refusal).toBeUndefined();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);
    expect((await undoMerge(outcome.result!.mergeId, adminId)).refusal).toBeUndefined();
    const temple = await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].name).toBe('Temple of Amun-Ra at Karnak');
  });

  it('refuses to fold a site and its own part into one place', async () => {
    await mergeKarnak();
    const outcome = await mergePlaces({ survivorId: THEBES, foldedId: COMPLEX, mergedBy: adminId, reason: 'curator' });
    expect(outcome.refusal).toEqual({ status: 409, error: 'One of the two places is part of the other, which is not one place' });
  });

  it('moves the place\'s own anchor with its one point when a curator corrects it', async () => {
    await mergeKarnak();
    await editLocation({
      params: { locationId: complexPoint },
      body: { latitude: 25.7190, longitude: 32.6580 },
      caller: { id: adminId, role: 'admin' } as Express.User,
    } as never);
    const after = await complex();
    expect([after.lon, after.lat]).toEqual([32.658, 25.719]);
    expect(after.curated).toContain('location');
    // The complex answers for its own point: the correction is in its own history, not the site's.
    const logged = await pool.query<{ experience_id: number }>(
      `SELECT experience_id FROM experience_curation_log WHERE action = 'location_edited' AND experience_id = ANY($1::int[])`,
      [[THEBES, COMPLEX]],
    );
    expect(logged.rows).toEqual([{ experience_id: COMPLEX }]);
  });

  it('gives the part back its point\'s name on the undo, where the site\'s run renamed it meanwhile', async () => {
    const { templeId, mergeId } = await mergeKarnak();
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Temple of Amun-Ra at Karnak' }, LUXOR], run);
    expect((await undoMerge(mergeId, adminId)).refusal).toBeUndefined();
    const temple = await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [templeId]);
    expect(temple.rows[0].name).toBe('Temple of Amun-Ra at Karnak');
  });
});

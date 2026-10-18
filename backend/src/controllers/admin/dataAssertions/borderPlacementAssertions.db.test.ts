import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { borderPlacementAssertions } from './borderPlacementAssertions.js';

/**
 * A near-border placement the data does not confirm is asked about (#1054),
 * against PostgreSQL. The fixture is Geghard's case drawn small: two leaf
 * regions side by side, "Ararat Fixture" west of 44.82° and "Kotayk Fixture"
 * east of it, and a monastery placed in Ararat 300 m from the line, whose
 * Wikidata item names Kotayk Province in its administrative chain.
 */

const assertion = borderPlacementAssertions[0];
const PLACE = 9971;
const QID = 'Q99710001';
const KOTAYK_ITEM = 'Q99710002';
const CURATOR = '00000000-0000-4000-8000-000000009971';
let curatorId = 0;
const ARARAT_ITEM = 'Q99710003';
let worldView = 0;
let ararat = 0;
let kotayk = 0;

const square = (west: number, east: number) =>
  `ST_Multi(ST_MakeEnvelope(${west}, 40.10, ${east}, 40.20, 4326))`;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_rejections WHERE experience_id = $1', [PLACE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  await pool.query(`DELETE FROM world_views WHERE name = 'Border fixture (#1054)'`);
  await pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1)', [[QID, KOTAYK_ITEM, ARARAT_ITEM]]);
  await pool.query('DELETE FROM wikidata_labels WHERE id = ANY($1)', [[KOTAYK_ITEM, ARARAT_ITEM]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

/**
 * Put the monastery at a longitude, placed automatically in Ararat: a place of
 * worship known by its item, or a World Heritage site known by UNESCO's number,
 * whose item the run resolved (`wikidata_items`).
 */
async function placeAt(longitude: number, source = 'Places of worship', externalId = QID): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Border fixture monastery', ST_SetSRID(ST_MakePoint($3, 40.14), 4326)
       FROM experience_sources s WHERE s.name = $4`,
    [PLACE, externalId, longitude, source],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, wikidata_items, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, $3::text[], 'auto', NOW() FROM experience_sources s WHERE s.name = $4`,
    [PLACE, externalId, externalId === QID ? null : [QID], source],
  );
  await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')`, [PLACE, ararat]);
}

/** The item's administrative chain: the monastery in `item`, labelled `label`. */
async function chainTo(item: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, 'P131', $1 || '$p131', 0, $2)`,
    [QID, item],
  );
  await pool.query(`INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', $2)`, [item, label]);
}

beforeEach(async () => {
  await clear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  worldView = (await pool.query<{ id: number }>(
    `INSERT INTO world_views (name) VALUES ('Border fixture (#1054)') RETURNING id`,
  )).rows[0].id;
  ararat = (await pool.query<{ id: number }>(
    `INSERT INTO regions (world_view_id, name, geom) VALUES ($1, 'Ararat Fixture', ${square(44.70, 44.82)}) RETURNING id`,
    [worldView],
  )).rows[0].id;
  kotayk = (await pool.query<{ id: number }>(
    `INSERT INTO regions (world_view_id, name, geom) VALUES ($1, 'Kotayk Fixture', ${square(44.82, 44.95)}) RETURNING id`,
    [worldView],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

async function asked(): Promise<Array<{ region_name: string; other_name: string; answer: string; metres: number }>> {
  const result = await pool.query(assertion.sql);
  return result.rows.filter(row => row.experience_id === PLACE)
    .map(row => ({ region_name: row.region_name, other_name: row.other_name, answer: row.answer, metres: row.metres }));
}

describe('a place within a kilometre of another region, its side not confirmed (#1054)', () => {
  it('asks about a placement whose item names the neighbour, and says so', async () => {
    // 44.8165 is about 300 m west of the line at 40.14° N.
    await placeAt(44.8165);
    await chainTo(KOTAYK_ITEM, 'Kotayk Fixture Province');
    const rows = await asked();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ region_name: 'Ararat Fixture', other_name: 'Kotayk Fixture', answer: 'names-other' });
    expect(rows[0].metres).toBeGreaterThan(250);
    expect(rows[0].metres).toBeLessThan(350);
    const said = assertion.describe((await pool.query(assertion.sql)).rows.find(row => row.experience_id === PLACE)!);
    expect(said).toBe(`Border fixture monastery (${QID}): placed in Ararat Fixture (Border fixture (#1054)), ${rows[0].metres} m from Kotayk Fixture; its Wikidata item names the neighbour (experience ${PLACE})`);
  });

  it('reads a World Heritage row by the item its number resolves to', async () => {
    await placeAt(44.8165, 'UNESCO World Heritage Sites', '99971');
    await chainTo(KOTAYK_ITEM, 'Kotayk Fixture Province');
    expect((await asked())[0]).toMatchObject({ other_name: 'Kotayk Fixture', answer: 'names-other' });
  });

  it('asks about a placement the data says nothing of, and is silent where the item confirms the side', async () => {
    await placeAt(44.8165);
    expect((await asked())[0]?.answer).toBe('no-chain');
    await chainTo(ARARAT_ITEM, 'Ararat Fixture Province');
    expect(await asked()).toEqual([]);
  });

  it('is silent once a curator has placed it by hand, and for a place well inside its region', async () => {
    await placeAt(44.8165);
    await chainTo(KOTAYK_ITEM, 'Kotayk Fixture Province');
    await pool.query(`UPDATE experience_regions SET assignment_type = 'manual' WHERE experience_id = $1`, [PLACE]);
    expect(await asked()).toEqual([]);

    await pool.query(`UPDATE experience_regions SET assignment_type = 'auto' WHERE experience_id = $1`, [PLACE]);
    // 44.76 is about 5 km from the line.
    await pool.query(`UPDATE experiences SET location = ST_SetSRID(ST_MakePoint(44.76, 40.14), 4326) WHERE id = $1`, [PLACE]);
    expect(await asked()).toEqual([]);
  });

  it('stays silent after a curator moved it, though the next placement run puts the automatic row back', async () => {
    await placeAt(44.8165);
    await chainTo(KOTAYK_ITEM, 'Kotayk Fixture Province');
    // The curator's move: Kotayk by hand, Ararat removed with its guard (removeExperienceFromRegion).
    await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`, [PLACE, kotayk]);
    await pool.query('DELETE FROM experience_regions WHERE experience_id = $1 AND region_id = $2', [PLACE, ararat]);
    await pool.query('INSERT INTO experience_rejections (experience_id, region_id, rejected_by) VALUES ($1, $2, $3)', [PLACE, ararat, curatorId]);
    // A placement run clears automatic rows and places the point again: Ararat is back.
    await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')`, [PLACE, ararat]);
    expect(await asked()).toEqual([]);

    // The rejection alone is the curator's answer too, with no manual row beside it.
    await pool.query(`DELETE FROM experience_regions WHERE experience_id = $1 AND assignment_type = 'manual'`, [PLACE]);
    expect(await asked()).toEqual([]);
  });

  it('is silent once a curator has placed the place by hand anywhere in the world view', async () => {
    await placeAt(44.8165);
    await chainTo(KOTAYK_ITEM, 'Kotayk Fixture Province');
    await pool.query(`INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'manual')`, [PLACE, kotayk]);
    expect(await asked()).toEqual([]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { withChosenCoordinate } from './itemCoordinate.js';
import { upsertExperienceRecord } from './experienceUpsert.js';

/**
 * Which of an item's coordinates a run writes for a place (ADR-0204), against
 * PostgreSQL. The fixture is Messene as the development catalogue held it:
 * an Archaeology place shown at a bot's point, its item carrying that point
 * and the excavation at Mavromati 15.6 km away, and the outline of the
 * excavation around Mavromati. Ids are the fixture's own.
 */

const MESSENE = 9620;
const PLACES = [MESSENE];
const MESSENE_ITEM = 'Q9620001';
const ITEMS = [MESSENE_ITEM];
const MAVROMATI = { lon: 21.92, lat: 37.175 };
const BOT = { lon: 22, lat: 37.05 };

let archaeology: { id: number; kind_id: number };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1::text[])', [ITEMS]);
}

/** An Archaeology place shown at `at`, its record published, its one point published there. */
async function place(id: number, item: string, at: { lon: number; lat: number }, pointAt = at): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, archaeology.id, item, `Coordinate fixture ${id}`, at.lon, at.lat],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at, reported_location)
     VALUES ($1, $2, $3, $4, 'auto', NOW(), ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, archaeology.kind_id, archaeology.id, item, at.lon, at.lat],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'auto')`,
    [id, `Coordinate fixture ${id}`, item, pointAt.lon, pointAt.lat],
  );
}

/** The item's coordinates as the local Wikidata copy holds them, at normal rank. */
async function coordinates(item: string, points: Array<{ lon: number; lat: number }>): Promise<void> {
  for (const [i, point] of points.entries()) {
    await pool.query(
      `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value)
       VALUES ($1, 'P625', $1 || '$p625-' || $2, 0, $3::jsonb)`,
      [item, i, JSON.stringify({ latitude: point.lat, longitude: point.lon, globe: 'http://www.wikidata.org/entity/Q2' })],
    );
  }
}

beforeEach(async () => {
  await clear();
  archaeology = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'Archaeology'`,
  )).rows[0];
  await place(MESSENE, MESSENE_ITEM, BOT);
  // The excavation's outline: a square about 600 m across around Mavromati.
  await pool.query(
    `UPDATE experiences SET boundary = ST_Multi(ST_Expand(ST_SetSRID(ST_MakePoint($2, $3), 4326), 0.003)) WHERE id = $1`,
    [MESSENE, MAVROMATI.lon, MAVROMATI.lat],
  );
  await coordinates(MESSENE_ITEM, [BOT, MAVROMATI]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a run's coordinate among its item's (ADR-0204)", () => {
  it('is the one inside the outline, wherever the place shows it now', async () => {
    const { record, choice } = await withChosenCoordinate(pool, MESSENE, { externalId: MESSENE_ITEM, ...BOT }, true);

    expect([record.lon, record.lat]).toEqual([MAVROMATI.lon, MAVROMATI.lat]);
    expect(choice).toMatchObject({ basis: 'outline', undecided: false });
  });

  it('is what a run of the source reports and proposes, held as a long move of a published place is', async () => {
    const outcome = await upsertExperienceRecord({
      sourceId: archaeology.id, externalId: MESSENE_ITEM, name: `Coordinate fixture ${MESSENE}`, nameLocal: {},
      subtitle: null, description: null, type: 'site', tags: [], ...BOT,
      countryCodes: [], countryNames: [], imageUrl: null, metadata: {},
    }, { dryRun: true });

    expect(outcome.location).toEqual(MAVROMATI);
    // 15.6 km is no short move, so the gate holds it for a curator (ADR-0140).
    expect(outcome.changeSet.heldFields.find(field => field.field === 'location')).toMatchObject({ new: MAVROMATI });
  });

  it('is as sent for an anchor, which no item holds, and for a record known by another id', async () => {
    const anchored = await withChosenCoordinate(pool, MESSENE, { externalId: MESSENE_ITEM, ...BOT }, false);
    expect(anchored.choice).toBeNull();
    const site = await withChosenCoordinate(pool, MESSENE, { externalId: '9620', ...BOT }, true);
    expect([site.record.lon, site.record.lat, site.choice]).toEqual([BOT.lon, BOT.lat, null]);
  });
});

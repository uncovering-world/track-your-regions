import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { coordinateAssertions, itemCoordinateAssertions } from './coordinateAssertions.js';

/**
 * The checks on a place's coordinate (ADR-0204), against PostgreSQL: a site
 * whose item's two coordinates, 4 km apart, nothing tells apart (Seleucia on
 * the Tigris as the development catalogue held it), and a place whose pin
 * stands 6.5 km from its own coordinate (Nemrut Dag). Ids are the fixture's
 * own, deleted before and after.
 */

const UNDECIDED = 9621;
const PIN_AWAY = 9622;
const PLACES = [UNDECIDED, PIN_AWAY];
const UNDECIDED_ITEM = 'Q9621001';
const PIN_AWAY_ITEM = 'Q9622001';
const ITEMS = [UNDECIDED_ITEM, PIN_AWAY_ITEM];

let archaeology: { id: number; kind_id: number };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1::text[])', [ITEMS]);
}

/** An Archaeology place shown at `at`, its record published, its one point published at `pointAt`. */
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
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("the checks on a place's coordinate", () => {
  it("list a place shown to readers whose item's coordinates nothing tells apart, until a curator sets it", async () => {
    // No outline, no other source: 4 km apart.
    await place(UNDECIDED, UNDECIDED_ITEM, { lon: 44.52, lat: 33.1 });
    await coordinates(UNDECIDED_ITEM, [{ lon: 44.52, lat: 33.1 }, { lon: 44.5172, lat: 33.1372 }]);
    const rule = itemCoordinateAssertions.find(assertion => assertion.id === 'item-coordinates-disagree')!;
    const listed = async () => (await rule.collect()).rows.filter(row => PLACES.includes(Number(row.experience_id)));

    const rows = await listed();
    expect(rows.map(row => row.experience_id)).toEqual([UNDECIDED]);
    expect(rule.describe(rows[0])).toMatch(/: Q9621001 gives coordinates up to 4\.\d km apart$/);

    await pool.query(`UPDATE experiences SET curated_fields = '["location"]'::jsonb WHERE id = $1`, [UNDECIDED]);
    expect(await listed()).toEqual([]);
  });

  it('list a place whose pin stands a kilometre from where its row and card send a reader', async () => {
    await place(PIN_AWAY, PIN_AWAY_ITEM, { lon: 38.76369, lat: 38.03661 }, { lon: 38.7409837, lat: 37.9807940 });
    const rule = coordinateAssertions.find(assertion => assertion.id === 'pin-away-from-its-place')!;
    const rows = (await pool.query<Record<string, unknown>>(rule.sql)).rows.filter(row => PLACES.includes(Number(row.experience_id)));

    expect(rows.map(row => row.experience_id)).toEqual([PIN_AWAY]);
    expect(rule.describe(rows[0])).toMatch(/its pin stands 6\.5 km from where its row and card send a reader$/);
  });
});

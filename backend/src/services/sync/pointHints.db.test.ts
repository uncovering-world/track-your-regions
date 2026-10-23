import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { findPointHints } from './pointHints.js';

/**
 * Where a component the list placed only roughly may stand (#1853), worked out
 * against PostgreSQL. The fixture is Echmiatsin: the Church of Saint Gayaneh on
 * the point three components share, with OpenStreetMap's church carrying its
 * reference 341 m off, its own Wikidata item a little further, an object named
 * like it, and an item that copies the shared point. Ids are the fixture's own,
 * deleted before and after.
 */

const SITE = 9855;
const OWN_ITEM = 'Q9855-gayane';
const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query("DELETE FROM osm_objects WHERE osm_type = 'W' AND osm_id BETWEEN 985500 AND 985599");
  await pool.query('DELETE FROM wikidata_claims WHERE subject = $1', [OWN_ITEM]);
}

async function point(ref: string, name: string, at: { lon: number; lat: number }): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, approximate)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'verified', 'shared') RETURNING id`,
    [SITE, name, ref, at.lon, at.lat],
  )).rows[0].id;
}

async function osm(id: number, tags: Record<string, string>, at: { lon: number; lat: number }): Promise<void> {
  await pool.query(
    `INSERT INTO osm_objects (osm_type, osm_id, tags, geom) VALUES ('W', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [id, JSON.stringify(tags), at.lon, at.lat],
  );
}

const hintsOf = async (locationId: number) => (await pool.query<{ source: string; ref: string; label: string | null; metres: number }>(
  'SELECT source, ref, label, metres FROM experience_point_hints WHERE location_id = $1 ORDER BY source, metres', [locationId],
)).rows;

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9855-fixture', 'Echmiatsin hints fixture', ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
    [SITE, SHARED.lon, SHARED.lat],
  );
  await osm(985501, { name: 'Saint Gayane Church', 'ref:whc': '9855-002' }, { lon: 44.2925, lat: 40.1587 });
  await osm(985502, { name: 'Church Saint Gayaneh' }, { lon: 44.2960, lat: 40.1600 });
  // A village named like the component is the place it is named after, never a hint (#1903).
  await osm(985504, { name: 'Church Saint Gayaneh', place: 'village' }, { lon: 44.2980, lat: 40.1610 });
  // A copy of the shared point, named like the component: not a measurement.
  await osm(985503, { name: 'Church Saint Gayaneh and surrounding buildings' }, SHARED);
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value)
     VALUES ($1, 'P625', 'fixture-statement', 0, '{"latitude": 40.1575, "longitude": 44.2919}')`,
    [OWN_ITEM],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('where a roughly placed component may stand', () => {
  it('keeps the object with its reference, its own item and a nearby namesake, each with its distance', async () => {
    const gayaneh = await point('9855-002', 'Church Saint Gayaneh and surrounding buildings', SHARED);
    await pool.query('UPDATE experience_locations SET wikidata_item = $2 WHERE id = $1', [gayaneh, OWN_ITEM]);

    expect(await findPointHints(SITE)).toEqual({ points: 1, hints: 3 });
    const hints = await hintsOf(gayaneh);
    expect(hints.map(h => [h.source, h.ref])).toEqual([
      ['item', OWN_ITEM], ['osm-name', 'W985502'], ['osm-ref', 'W985501'],
    ]);
    expect(hints.find(h => h.source === 'osm-ref')).toMatchObject({ label: 'Saint Gayane Church' });
    expect(hints.find(h => h.source === 'osm-ref')!.metres).toBeGreaterThan(200);
  });

  it('replaces what an earlier pass kept, and works out nothing for a point a curator placed', async () => {
    const gayaneh = await point('9855-002', 'Church Saint Gayaneh and surrounding buildings', SHARED);
    await findPointHints(SITE);
    await findPointHints(SITE);
    expect((await hintsOf(gayaneh)).length).toBe(2);

    await pool.query(`UPDATE experience_locations SET curated_fields = '["location"]'::jsonb WHERE id = $1`, [gayaneh]);
    expect(await findPointHints()).toMatchObject({ points: expect.any(Number) });
    expect(await hintsOf(gayaneh)).toEqual([]);
  });
});

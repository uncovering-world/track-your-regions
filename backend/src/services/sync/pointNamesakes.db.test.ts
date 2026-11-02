import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.js';
import type { OverpassElement } from './osm/overpassGeometry.js';
import { findPointHints } from './pointHints.js';
import { askPointNamesakes, namesakesQuery, nameWord } from './pointNamesakes.js';

/**
 * A rough point's namesakes asked of the full OpenStreetMap from the card
 * (#2243), against PostgreSQL, with Overpass answered by the fixture. The
 * Cemetery of Congregation shares Echmiatsin's point; OpenStreetMap maps it as
 * a `landuse=cemetery` 244 m west, which the layer does not keep. The answer
 * also holds the stream a rock shelter is named after, a village of the same
 * name and an object 3 km off. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9856;
const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };

const cemetery: OverpassElement = {
  type: 'way', id: 1095868935, center: { lat: 40.1591957, lon: 44.2922764 },
  tags: { landuse: 'cemetery', name: 'Cemetery of Congregation', 'name:en': 'Cemetery of Congregation' },
};
const stream: OverpassElement = {
  type: 'way', id: 9856001, center: { lat: 40.1610, lon: 44.2990 }, tags: { waterway: 'stream', name: 'Congregation Brook' },
};
const village: OverpassElement = {
  type: 'node', id: 9856002, lat: 40.1620, lon: 44.2900, tags: { place: 'village', name: 'Congregation' },
};
const far: OverpassElement = {
  type: 'node', id: 9856003, lat: 40.1900, lon: 44.2951, tags: { historic: 'memorial', name: 'Cemetery of Congregation' },
};

let curator = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query("DELETE FROM users WHERE uuid = '00000000-0000-4000-8000-000000009856'");
  await pool.query("DELETE FROM osm_objects WHERE osm_type = 'W' AND osm_id = 1095868935");
}

async function point(name: string): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, approximate)
     VALUES ($1, $2, '9856-003', ST_SetSRID(ST_MakePoint($3, $4), 4326), 'verified', 'shared') RETURNING id`,
    [SITE, name, SHARED.lon, SHARED.lat],
  )).rows[0].id;
}

const hintsOf = async (locationId: number) => (await pool.query<{ source: string; ref: string; metres: number }>(
  'SELECT source, ref, metres FROM experience_point_hints WHERE location_id = $1 ORDER BY metres', [locationId],
)).rows;

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9856-fixture', 'Echmiatsin namesakes fixture', ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
    [SITE, SHARED.lon, SHARED.lat],
  );
  curator = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ('00000000-0000-4000-8000-000000009856', 'A curator', 'curator') RETURNING id`,
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a rough point's namesakes, asked from the card", () => {
  it('keeps the cemetery and leaves out the stream, the village and the far object', async () => {
    const id = await point('Cemetery of Congregation');
    const ask = vi.fn(async () => [cemetery, stream, village, far]);

    expect(await askPointNamesakes(SITE, id, curator, ask)).toEqual({ found: 1, asked: true });
    expect(ask).toHaveBeenCalledWith(namesakesQuery(SHARED.lat, SHARED.lon, 'congregation'));
    const hints = await hintsOf(id);
    expect(hints.map(h => [h.source, h.ref])).toEqual([['osm-name', 'W1095868935']]);
    expect(hints[0].metres).toBeGreaterThan(200);
    expect(hints[0].metres).toBeLessThan(300);
  });

  it('asks a point once, and the next pass keeps what it answered', async () => {
    const id = await point('Cemetery of Congregation');
    const ask = vi.fn(async () => [cemetery]);
    await askPointNamesakes(SITE, id, curator, ask);
    expect(await askPointNamesakes(SITE, id, curator, ask)).toEqual({ found: 1, asked: false });
    expect(ask).toHaveBeenCalledTimes(1);

    await findPointHints(SITE);
    expect((await hintsOf(id)).map(h => h.ref)).toEqual(['W1095868935']);
  });

  it('asks OpenStreetMap once when two curators press the button on one point together', async () => {
    const id = await point('Cemetery of Congregation');
    const ask = vi.fn(async () => [cemetery]);
    const both = await Promise.all([
      askPointNamesakes(SITE, id, curator, ask), askPointNamesakes(SITE, id, curator, ask),
    ]);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(both.map(a => a?.asked).sort()).toEqual([false, true]);
    expect((await hintsOf(id)).map(h => h.ref)).toEqual(['W1095868935']);
  });

  it('keeps one hint where the layer offers the object the full OpenStreetMap answered', async () => {
    const id = await point('Cemetery of Congregation');
    await askPointNamesakes(SITE, id, curator, async () => [cemetery]);
    // A later layer build keeps the cemetery after all (a pin, or a new selector).
    await pool.query(
      `INSERT INTO osm_objects (osm_type, osm_id, tags, geom)
       VALUES ('W', 1095868935, $1, ST_SetSRID(ST_MakePoint(44.2922764, 40.1591957), 4326))`,
      [JSON.stringify(cemetery.tags)],
    );
    await findPointHints(SITE);
    expect((await hintsOf(id)).map(h => [h.source, h.ref])).toEqual([['osm-name', 'W1095868935']]);
  });

  it('lets the answer go when the point is renamed, so the card offers the question again', async () => {
    const id = await point('Cemetery of Congregation');
    await askPointNamesakes(SITE, id, curator, async () => [cemetery]);
    await pool.query("UPDATE experience_locations SET name = 'Congregation burial ground' WHERE id = $1", [id]);

    await findPointHints(SITE);
    expect(await hintsOf(id)).toEqual([]);
  });

  it('keeps an empty answer, so a point with no namesake is not asked again', async () => {
    const id = await point('Cemetery of Congregation');
    const ask = vi.fn(async (): Promise<OverpassElement[]> => []);
    expect(await askPointNamesakes(SITE, id, curator, ask)).toEqual({ found: 0, asked: true });
    expect(await askPointNamesakes(SITE, id, curator, ask)).toEqual({ found: 0, asked: false });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('answers nothing for a point a curator has placed, or one another site shows', async () => {
    const id = await point('Cemetery of Congregation');
    expect(await askPointNamesakes(SITE + 1, id, curator, async () => [cemetery])).toBeNull();
    await pool.query(`UPDATE experience_locations SET curated_fields = '["location"]'::jsonb WHERE id = $1`, [id]);
    expect(await askPointNamesakes(SITE, id, curator, async () => [cemetery])).toBeNull();
  });
});

describe('the word every namesake must contain', () => {
  it('is the name\'s longest word', () => {
    expect(nameWord('Cemetery of Congregation')).toBe('congregation');
    expect(nameWord('Barranc del Puig- Abric I')).toBe('barranc');
    expect(nameWord('I')).toBeNull();
  });

  it('stands for itself in the question, whatever it holds', () => {
    expect(namesakesQuery(1, 2, 'a.b"c')).toContain(String.raw`["name"~"a\.b\"c",i]`);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { writeExperienceLocations, type LocationWriteRun } from '../locationWriter.js';
import { serialSiteItems } from './serialSite.js';

/**
 * A place kind refuses the item of a World Heritage site of several
 * components, read from the World Heritage run's own records (#2276), against
 * PostgreSQL. The sites are parted as the run parts them: the Painted Churches
 * of the Troödos with two of their churches, Cologne Cathedral, a site of one
 * point, the Historic Ensemble of the Potala Palace, whose item the Potala
 * Palace component holds as a place of worship, the Abbey and Altenmünster of
 * Lorsch, whose item its abbey component's record holds, and the Historic
 * Centre of Macao, which resolves to several items. Ids and items are the
 * fixture's own, deleted before and after, so no seeded site answers for them.
 */

const TROODOS = 9690;
const COLOGNE = 9691;
const POTALA = 9692;
const LORSCH = 9693;
const MACAO = 9694;
const MAULBRONN = 9695;
const SITES = [TROODOS, COLOGNE, POTALA, LORSCH, MACAO, MAULBRONN];

const ITEM = {
  troodos: 'Q99962702', cologne: 'Q99904176', potala: 'Q99971229', lorsch: 'Q99957550',
  aMaTemple: 'Q99949114', stPauls: 'Q99951411', nikolaosChurch: 'Q99973293', maulbronn: 'Q99957886',
};

const PLACES_OF_WORSHIP = 4;

let run: LocationWriteRun;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = ANY($1::int[]))', [SITES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [SITES]);
}

async function site(id: number, name: string, items: string[], points: Array<{ name: string; externalRef: string; lon: number; lat: number }>) {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, run.sourceId, `${id}-fixture`, name, points[0].lon, points[0].lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, wikidata_items, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, $3::text[], 'auto', NOW() FROM experience_sources s WHERE s.id = $4`,
    [id, `${id}-fixture`, items, run.sourceId],
  );
  await writeExperienceLocations(id, points, run);
}

async function firstPart(whole: number): Promise<number> {
  return (await pool.query<{ part_id: number }>(
    `SELECT part_id FROM experience_parts WHERE whole_id = $1 AND reason = 'component' ORDER BY external_ref LIMIT 1`, [whole],
  )).rows[0].part_id;
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number }>(
    `SELECT id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: source.id, components: true };
  await site(TROODOS, 'Painted Churches in the Troodos Region (fixture)', [ITEM.troodos], [
    { name: 'Church of Panayia Phorviotissa (Asinou)', externalRef: '9690-003', lon: 33.0436, lat: 35.0328 },
    { name: 'Church of Ayios Nikolaos tis Steyis', externalRef: '9690-001', lon: 32.9450, lat: 34.9800 },
  ]);
  await site(COLOGNE, 'Cologne Cathedral (fixture)', [ITEM.cologne], [
    { name: 'Cologne Cathedral', externalRef: '9691', lon: 6.9583, lat: 50.9413 },
  ]);
  await site(POTALA, 'Historic Ensemble of the Potala Palace (fixture)', [ITEM.potala], [
    { name: 'Potala Palace', externalRef: '9692-001', lon: 91.1172, lat: 29.6578 },
    { name: 'Jokhang', externalRef: '9692-002', lon: 91.1322, lat: 29.6530 },
  ]);
  await site(LORSCH, 'Abbey and Altenmünster of Lorsch (fixture)', [ITEM.lorsch], [
    { name: 'Abbey of Lorsch', externalRef: '9693-001', lon: 8.5694, lat: 49.6536 },
    { name: 'Ruine Altenmünster', externalRef: '9693-002', lon: 8.5770, lat: 49.6500 },
  ]);
  await site(MACAO, 'Historic Centre of Macao (fixture)', [ITEM.aMaTemple, ITEM.stPauls], [
    { name: 'Zone 1', externalRef: '9694-001', lon: 113.5390, lat: 22.1970 },
    { name: 'Zone 2', externalRef: '9694-002', lon: 113.5490, lat: 22.1960 },
  ]);
  // A monastery with its ponds, all within a few kilometres: one visit, not a series.
  await site(MAULBRONN, 'Maulbronn Monastery Complex (fixture)', [ITEM.maulbronn], [
    { name: 'Maulbronn Monastery', externalRef: '9695-001', lon: 8.8131, lat: 49.0006 },
    { name: 'Tiefer See', externalRef: '9695-002', lon: 8.8290, lat: 49.0100 },
  ]);
  // The Potala Palace component is the place Places of worship holds under the site's item.
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.kind_id = $3 ORDER BY s.id LIMIT 1`,
    [await firstPart(POTALA), ITEM.potala, PLACES_OF_WORSHIP],
  );
  // The abbey component's record in World Heritage components carries the site's item; Ayios Nikolaos tis Steyis' its own.
  await pool.query(
    'UPDATE experience_kind_memberships SET wikidata_items = $2::text[] WHERE experience_id = $1 AND kind_id = 10',
    [await firstPart(LORSCH), [ITEM.lorsch]],
  );
  await pool.query(
    'UPDATE experience_kind_memberships SET wikidata_items = $2::text[] WHERE experience_id = $1 AND kind_id = 10',
    [await firstPart(TROODOS), [ITEM.nikolaosChurch]],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the item of a World Heritage site of several components (#2276)', () => {
  it('names the Painted Churches of the Troödos a series, with its count of components', async () => {
    const series = await serialSiteItems(Object.values(ITEM));
    expect([...series.keys()]).toEqual([ITEM.troodos]);
    expect(series.get(ITEM.troodos)).toEqual({ site: 'Painted Churches in the Troodos Region (fixture)', components: 2 });
  });

  it('keeps Cologne Cathedral, a site of one point, and a church of the Troödos, a component with an item of its own', async () => {
    const series = await serialSiteItems([ITEM.cologne, ITEM.nikolaosChurch]);
    expect(series.size).toBe(0);
  });

  it("keeps the site's item where one of its components holds it, on another kind's membership or on its record", async () => {
    const series = await serialSiteItems([ITEM.potala, ITEM.lorsch]);
    expect(series.size).toBe(0);
  });

  it('keeps a site whose components lie within 10 km of each other: Maulbronn with its ponds is one visit', async () => {
    const series = await serialSiteItems([ITEM.maulbronn]);
    expect(series.size).toBe(0);
  });

  it('keeps every item of a site that resolves to several: buildings within it, not the series', async () => {
    const series = await serialSiteItems([ITEM.aMaTemple, ITEM.stPauls]);
    expect(series.size).toBe(0);
  });

  it('reads a site the list no longer holds as no series', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET source_membership = 'former' WHERE experience_id = $1 AND kind_id = 1`, [TROODOS],
    );
    expect((await serialSiteItems([ITEM.troodos])).size).toBe(0);
  });
});

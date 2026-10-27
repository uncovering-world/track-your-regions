import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { openViewFieldsSql, placeViewSourcesSql } from '../../db/sourceViews.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from '../../services/sync/experienceUpsert.js';
import { writeExperienceLocations } from '../../services/sync/locationWriter.js';
import { querySources } from './reviewQueueSources.js';
import { chooseViewsUnderLock } from './viewChoiceController.js';

/**
 * A curator's choice between a serial site's view of one of its parts and
 * another source's (#2063), against PostgreSQL: the part holds no membership
 * of its site's kind (ADR-0100 decision 2), so the site's view is read off the
 * part's record in World Heritage components, which the site's run writes
 * (ADR-0156 decision 2), and named by that record.
 *
 * The fixture is the Roman Cologne components of the Frontiers of the Roman
 * Empire as `sourceView.part.db.test.ts` builds them: the Praetorium's point
 * bound to the item of Roman Cologne as a whole, which an Archaeology run then
 * reads with the city's name and a coordinate about 350 m away, past the
 * 250 m the card asks about (ADR-0140). Ids and items are the fixture's own,
 * deleted before and after.
 */

const SITE = 9491;
const ITEM = 'Q9491001';
const CURATOR = '00000000-0000-4000-8000-000000009491';
const PRAETORIUM = { name: 'Köln-Praetorium', externalRef: '9491-076', lon: 6.9588889, lat: 50.9380528 };
const DEUTZ = { name: 'Köln-Deutz', externalRef: '9491-077', lon: 6.9709, lat: 50.9364 };

let heritage = 0;
let archaeology = 0;
let componentRecord = 0;
let curatorId = 0;

const record = (): ExperienceUpsertParams => ({
  sourceId: archaeology,
  externalId: ITEM,
  name: 'Colonia Claudia Ara Agrippinensium',
  nameLocal: { en: 'Colonia Claudia Ara Agrippinensium' },
  subtitle: null,
  description: null,
  type: null,
  tags: [],
  lon: PRAETORIUM.lon + 0.005,
  lat: PRAETORIUM.lat,
  countryCodes: [],
  countryNames: [],
  imageUrl: null,
  metadata: { wikidataQid: ITEM },
});

async function praetorium(): Promise<{ id: number; name: string; lon: number }> {
  return (await pool.query(
    `SELECT e.id, e.name, ST_X(e.location) AS lon
       FROM experience_parts p JOIN experiences e ON e.id = p.part_id
      WHERE p.whole_id = $1 AND p.external_ref = $2`,
    [SITE, PRAETORIUM.externalRef],
  )).rows[0];
}

const open = async (id: number) => (await pool.query<{ fields: string[] }>(
  `SELECT ${openViewFieldsSql('e.id')} AS fields FROM experiences e WHERE e.id = $1`, [id],
)).rows[0].fields;
const sourcesOf = async (id: number) => (await pool.query<{ ids: number[] }>(
  `SELECT ${placeViewSourcesSql('$1::int')} AS ids`, [id],
)).rows[0].ids;
const viewsOfName = async (id: number) => (await querySources([id])).rows[0].source_views
  .find((row: { field: string }) => row.field === 'name').views;

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences
      WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)
         OR id IN (SELECT experience_id FROM experience_kind_memberships WHERE external_id = $2)`,
    [SITE, ITEM],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; kind_id: number; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name IN ('UNESCO World Heritage Sites', 'Archaeology')`,
  );
  const unesco = sources.rows.find(row => row.name === 'UNESCO World Heritage Sites')!;
  heritage = unesco.id;
  archaeology = sources.rows.find(row => row.name === 'Archaeology')!.id;
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9491-fixture', 'Frontiers of the Roman Empire (fixture)', ST_SetSRID(ST_MakePoint(6.96, 50.94), 4326))`,
    [SITE, heritage],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9491-fixture', 'auto', NOW())`,
    [SITE, unesco.kind_id, heritage],
  );
  await writeExperienceLocations(SITE, [PRAETORIUM, DEUTZ], { syncLogId: null, sourceId: heritage, components: true });
  componentRecord = (await pool.query<{ id: number }>(
    `SELECT rec.id FROM experience_parts p
       JOIN experience_kind_memberships rec ON rec.experience_id = p.part_id AND rec.kind_id = 10
      WHERE p.whole_id = $1 AND p.external_ref = $2`,
    [SITE, PRAETORIUM.externalRef],
  )).rows[0].id;
  await pool.query(
    'UPDATE experience_locations SET wikidata_item = $3 WHERE experience_id = (SELECT part_id FROM experience_parts WHERE whole_id = $1 AND external_ref = $2)',
    [SITE, PRAETORIUM.externalRef, ITEM],
  );
  await upsertExperienceRecord(record(), { syncLogId: null });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("the curator is asked which view a serial site's part shows (#2063)", () => {
  it("offers the site's view of the component beside the run's, and asks it of both sources", async () => {
    const part = await praetorium();

    expect(await open(part.id)).toEqual(['name', 'location']);
    expect(await viewsOfName(part.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ membership_id: componentRecord, value: 'Köln-Praetorium', shown: true }),
      expect.objectContaining({ value: 'Colonia Claudia Ara Agrippinensium', shown: false }),
    ]));
    expect(await sourcesOf(part.id)).toEqual([heritage, archaeology].sort((a, b) => a - b));
  });

  it('writes the chosen view to the part and stands answered', async () => {
    const part = await praetorium();
    const theRun = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_kind_memberships WHERE experience_id = $1 AND source_id = $2', [part.id, archaeology],
    )).rows[0].id;

    const outcome = await chooseViewsUnderLock(part.id, curatorId, null, [
      { field: 'name', membershipId: theRun },
      { field: 'location', membershipId: componentRecord },
    ], await sourcesOf(part.id));

    expect(outcome.refusal).toBeUndefined();
    expect(outcome.result?.changed).toEqual(['name']);
    const stored = await praetorium();
    expect(stored.name).toBe('Colonia Claudia Ara Agrippinensium');
    expect(stored.lon).toBeCloseTo(PRAETORIUM.lon, 6);
    expect(await open(part.id)).toEqual([]);
  });

  it("keeps the site's view on the record when a merge folds the component's point into another", async () => {
    const part = await praetorium();
    // As Karnak's "Temple of Karnak" was folded into the temple's Archaeology point.
    const kept = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location)
       VALUES ($1, 'Colonia Claudia Ara Agrippinensium', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)) RETURNING id`,
      [part.id, ITEM, PRAETORIUM.lon + 0.002, PRAETORIUM.lat],
    )).rows[0].id;
    await pool.query(
      'UPDATE experience_locations SET merged_into_id = $3 WHERE experience_id = $1 AND external_ref = $2',
      [part.id, PRAETORIUM.externalRef, kept],
    );

    expect(await viewsOfName(part.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ membership_id: componentRecord, value: 'Köln-Praetorium' }),
    ]));
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * A serial site's part keeps what UNESCO says of it when a kind's run reaches
 * it (#2061), against PostgreSQL: the component point is UNESCO's view of the
 * part, and the views that contradict a field are decided in SQL.
 *
 * The fixture is the Roman Cologne components of the Frontiers of the Roman
 * Empire as the World Heritage run leaves them: the site parted into the
 * Praetorium and the Deutz fort, the Praetorium's point bound to the item of
 * Roman Cologne as a whole. An Archaeology run then reads that item, with the
 * city's name and a coordinate 140 m away. Ids and items are the fixture's
 * own, deleted before and after. Which view the part then shows is a
 * curator's question (`viewChoices.part.db.test.ts`, #2063).
 */

const SITE = 9490;
const ITEM = 'Q9490001';
const PRAETORIUM = { name: 'Köln-Praetorium', externalRef: '9490-076', lon: 6.9588889, lat: 50.9380528 };
const DEUTZ = { name: 'Köln-Deutz', externalRef: '9490-077', lon: 6.9709, lat: 50.9364 };
const PICTURE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Cologne-fixture-kapitol.jpg';

let heritage = 0;
let archaeology = 0;

const record = (): ExperienceUpsertParams => ({
  sourceId: archaeology,
  externalId: ITEM,
  name: 'Colonia Claudia Ara Agrippinensium',
  nameLocal: { en: 'Colonia Claudia Ara Agrippinensium' },
  subtitle: 'Roman colony on the Rhine',
  description: null,
  type: null,
  tags: [],
  lon: PRAETORIUM.lon + 0.002,
  lat: PRAETORIUM.lat,
  countryCodes: [],
  countryNames: [],
  imageUrl: PICTURE,
  metadata: { wikidataQid: ITEM, imageCredit: { artist: 'Fixture photographer', license: 'CC BY-SA 4.0' } },
});

async function praetorium(): Promise<{ id: number; name: string; subtitle: string | null; image_url: string | null; lon: number }> {
  return (await pool.query(
    `SELECT e.id, e.name, e.subtitle, e.image_url, ST_X(e.location) AS lon
       FROM experience_parts p JOIN experiences e ON e.id = p.part_id
      WHERE p.whole_id = $1 AND p.external_ref = $2`,
    [SITE, PRAETORIUM.externalRef],
  )).rows[0];
}

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences
      WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)
         OR id IN (SELECT experience_id FROM experience_kind_memberships WHERE external_id = $2)`,
    [SITE, ITEM],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; kind_id: number; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name IN ('UNESCO World Heritage Sites', 'Archaeology')`,
  );
  const unesco = sources.rows.find(row => row.name === 'UNESCO World Heritage Sites')!;
  heritage = unesco.id;
  archaeology = sources.rows.find(row => row.name === 'Archaeology')!.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9490-fixture', 'Frontiers of the Roman Empire (fixture)', ST_SetSRID(ST_MakePoint(6.96, 50.94), 4326))`,
    [SITE, heritage],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9490-fixture', 'auto', NOW())`,
    [SITE, unesco.kind_id, heritage],
  );
  await writeExperienceLocations(SITE, [PRAETORIUM, DEUTZ], { syncLogId: null, sourceId: heritage, components: true });
  // The component-items pass binds the point to the item it found.
  await pool.query(
    'UPDATE experience_locations SET wikidata_item = $3 WHERE experience_id = (SELECT part_id FROM experience_parts WHERE whole_id = $1 AND external_ref = $2)',
    [SITE, PRAETORIUM.externalRef, ITEM],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a serial site's part keeps UNESCO's view of it (#2061)", () => {
  it("keeps the component's name and point when a kind's run joins the part, and records the run's view", async () => {
    const part = await praetorium();

    const outcome = await upsertExperienceRecord(record(), { syncLogId: null });

    expect(outcome.experienceId).toBe(part.id);
    const stored = await praetorium();
    expect(stored.name).toBe('Köln-Praetorium');
    expect(stored.lon).toBeCloseTo(PRAETORIUM.lon, 6);
    const view = await pool.query<{ name: string }>(
      'SELECT reported_name AS name FROM experience_kind_memberships WHERE experience_id = $1 AND source_id = $2',
      [part.id, archaeology],
    );
    expect(view.rows[0].name).toBe('Colonia Claudia Ara Agrippinensium');
  });

  it('keeps them once the membership is published, while the fields UNESCO does not hold reach the part', async () => {
    const part = await praetorium();
    await upsertExperienceRecord(record(), { syncLogId: null });
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [part.id, archaeology],
    );

    const outcome = await upsertExperienceRecord(record(), { syncLogId: null });

    const stored = await praetorium();
    expect(stored.name).toBe('Köln-Praetorium');
    expect(stored.lon).toBeCloseTo(PRAETORIUM.lon, 6);
    expect(stored.subtitle).toBe('Roman colony on the Rhine');
    expect(stored.image_url).toBe(PICTURE);
    const proposed = [...outcome.changeSet.changedFields, ...outcome.changeSet.heldFields].map(f => f.field);
    expect(proposed).not.toContain('name');
    expect(proposed).not.toContain('location');
  });
});

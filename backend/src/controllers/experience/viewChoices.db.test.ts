import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { openViewFieldsSql } from '../../db/sourceViews.js';
import { chooseViewsUnderLock, keepingChoices } from './viewChoiceController.js';
import { querySources } from './reviewQueueSources.js';

/**
 * A curator's choice between two data sources' views of one place (#1246),
 * executed against PostgreSQL.
 *
 * The fixture is Rila Monastery as a merge of a World Heritage row and a
 * Wikidata one will hold it: one place, a UNESCO membership (id 216) calling
 * it "Rila Monastery" with one photograph, and a Places of worship membership
 * (Q207945) calling it "Monastery of Saint John of Rila" with another, the two
 * points eight metres apart. The place shows UNESCO's view.
 */

const RILA = 9800;
const CURATOR = '00000000-0000-4000-8000-000000009800';
const UNESCO_PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Klosterkirche%20des%20Rilaklosters.jpg';
const WIKIDATA_PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Rila%20Monastery%2C%20August%202013.jpg';
const WIKIDATA_CREDIT = { author: 'Raggatt2000', license: 'CC BY-SA 3.0' };

let curatorId = 0;
let unescoView = 0;
let wikidataView = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [RILA]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [RILA]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function membership(source: string, externalId: string, name: string, picture: string, lon: number, lat: number,
  credit: object | null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at,
       reported_name, reported_image_url, reported_image_credit, reported_location)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), $3, $4, $5::jsonb, ST_SetSRID(ST_MakePoint($6, $7), 4326)
       FROM experience_sources s WHERE s.name = $8 RETURNING id`,
    [RILA, externalId, name, picture, credit ? JSON.stringify(credit) : null, lon, lat, source],
  );
  return row.rows[0].id;
}

/** The place's sources, as the curator's scope was resolved over them. */
const sources = async () => (await pool.query<{ source_id: number }>(
  'SELECT DISTINCT source_id FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id', [RILA],
)).rows.map(row => row.source_id);
const open = async () => (await pool.query<{ fields: string[] }>(
  `SELECT ${openViewFieldsSql('e.id')} AS fields FROM experiences e WHERE e.id = $1`, [RILA],
)).rows[0].fields;
const place = async () => (await pool.query<{ name: string; image_url: string; credit: unknown }>(
  `SELECT name, image_url, metadata->'imageCredit' AS credit FROM experiences WHERE id = $1`, [RILA],
)).rows[0];

beforeEach(async () => {
  await clear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, image_url, location)
     SELECT $1, s.id, '216', 'Rila Monastery', $2, ST_SetSRID(ST_MakePoint(23.340187, 42.133298), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [RILA, UNESCO_PICTURE],
  );
  unescoView = await membership('UNESCO World Heritage Sites', '216', 'Rila Monastery', UNESCO_PICTURE, 23.340187, 42.133298, null);
  wikidataView = await membership('Places of worship', 'Q207945', 'Monastery of Saint John of Rila', WIKIDATA_PICTURE,
    23.340278, 42.133333, WIKIDATA_CREDIT);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('two sources that describe one place differently (#1246)', () => {
  it('asks about the name and the picture, and says why the point and the description are not asked', async () => {
    expect(await open()).toEqual(['name', 'imageUrl']);

    const card = (await querySources([RILA])).rows[0];

    expect(card.source_views.map((f: { field: string }) => f.field)).toEqual(['name', 'imageUrl']);
    expect(card.source_views[0].views).toEqual([
      expect.objectContaining({ membership_id: unescoView, value: 'Rila Monastery', shown: true }),
      expect.objectContaining({ membership_id: wikidataView, value: 'Monastery of Saint John of Rila', shown: false }),
    ]);
    expect(card.source_views[1].views[1]).toMatchObject({ image_url: WIKIDATA_PICTURE, image_credit: WIKIDATA_CREDIT });
    expect(card.quiet_fields).toEqual([{ field: 'location', why: 'agree', metres: 8 }]);
  });

  it("shows the chosen source's name and picture, the picture with its credit, and asks no more", async () => {
    const outcome = await chooseViewsUnderLock(RILA, curatorId, null, [
      { field: 'name', membershipId: wikidataView },
      { field: 'imageUrl', membershipId: wikidataView },
    ], await sources());

    expect(outcome.result).toEqual({ fields: ['name', 'imageUrl'], changed: ['name', 'imageUrl'] });
    expect(await place()).toEqual({ name: 'Monastery of Saint John of Rila', image_url: WIKIDATA_PICTURE, credit: WIKIDATA_CREDIT });
    expect(await open()).toEqual([]);
    const log = await pool.query('SELECT action FROM experience_curation_log WHERE experience_id = $1', [RILA]);
    expect(log.rows).toEqual([{ action: 'views_chosen' }]);
  });

  it('keeps what readers see, and asks again once a source sends something different', async () => {
    const choices = await keepingChoices(RILA);
    expect(choices).toEqual([
      { field: 'name', membershipId: unescoView }, { field: 'imageUrl', membershipId: unescoView },
    ]);
    const outcome = await chooseViewsUnderLock(RILA, curatorId, null, choices, await sources());
    expect(outcome.result?.changed).toEqual([]);
    expect(await open()).toEqual([]);

    await pool.query(`UPDATE experience_kind_memberships SET reported_name = 'Rila Monastery of St John' WHERE id = $1`, [wikidataView]);

    expect(await open()).toEqual(['name']);
    expect((await place()).name).toBe('Rila Monastery');
  });

  it('never shows a picture without its photographer: refuses one nobody credited, takes one Commons named', async () => {
    await pool.query('UPDATE experience_kind_memberships SET reported_image_credit = NULL WHERE id = $1', [wikidataView]);

    const refused = await chooseViewsUnderLock(
      RILA, curatorId, null, [{ field: 'imageUrl', membershipId: wikidataView }], await sources(),
    );
    expect(refused.refusal).toMatchObject({ status: 503 });
    expect((await place()).image_url).toBe(UNESCO_PICTURE);

    const read = {
      author: 'Raggatt2000', license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0', detailsUrl: 'https://commons.wikimedia.org/wiki/File:Rila_Monastery,_August_2013.jpg',
    };
    const taken = await chooseViewsUnderLock(
      RILA, curatorId, null, [{ field: 'imageUrl', membershipId: wikidataView }], await sources(),
      { url: WIKIDATA_PICTURE, credit: read },
    );
    expect(taken.result?.changed).toEqual(['imageUrl']);
    expect(await place()).toMatchObject({ image_url: WIKIDATA_PICTURE, credit: read });
  });

  it('refuses a credit read for a picture the source has since replaced', async () => {
    await pool.query('UPDATE experience_kind_memberships SET reported_image_credit = NULL WHERE id = $1', [wikidataView]);
    const read = { author: 'Raggatt2000', license: 'CC BY-SA 3.0', licenseUrl: '', detailsUrl: '' };

    const outcome = await chooseViewsUnderLock(
      RILA, curatorId, null, [{ field: 'imageUrl', membershipId: wikidataView }], await sources(),
      { url: 'http://commons.wikimedia.org/wiki/Special:FilePath/An%20older%20photograph.jpg', credit: read },
    );

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect((await place()).image_url).toBe(UNESCO_PICTURE);
  });

  it('refuses once the place holds a source the curator was not checked for', async () => {
    const outcome = await chooseViewsUnderLock(
      RILA, curatorId, null, [{ field: 'name', membershipId: wikidataView }], (await sources()).slice(0, 1),
    );

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect((await place()).name).toBe('Rila Monastery');
  });

  it('refuses a field nobody is asked about, changing nothing', async () => {
    const outcome = await chooseViewsUnderLock(
      RILA, curatorId, null, [{ field: 'location', membershipId: wikidataView }], await sources(),
    );

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect(await open()).toEqual(['name', 'imageUrl']);
  });

  it('asks nothing of two views under one id, which read one Wikidata item (ADR-0085)', async () => {
    // Both memberships under one Wikidata item: the ADR's case, read one item.
    await pool.query(`UPDATE experience_kind_memberships SET external_id = 'Q207945' WHERE id = $1`, [unescoView]);

    expect(await open()).toEqual([]);
  });
});

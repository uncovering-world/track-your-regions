import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { recordComponentItems, writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';
import { writePointContents } from '../../services/sync/pointContentWriter.js';
import { getExperienceLocations } from './experienceLocationController.js';
import { editLocation } from './locationEditController.js';
import { claimPointItem, releasePointItem } from './experienceLocationWriter.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { experienceLocationsQuerySchema } from '../../types/index.js';

/**
 * A curator's correction of a serial site's part's point writes the part's own
 * fields (ADR-0156 decision 3), against PostgreSQL: the line under the Luxor
 * Temple's name is its part's subtitle, claimed there, so the next run keeps
 * it, and the site's read serves it as the point's description.
 */

const THEBES = 9970;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const ADMIN = '00000000-0000-4000-8000-000000009970';

let run: LocationWriteRun;
let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [THEBES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [THEBES]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [THEBES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

const luxor = async () => (await pool.query<{ part_id: number; point_id: number; subtitle: string | null; claims: string[]; point_description: string | null }>(
  `SELECT p.part_id, el.id AS point_id, e.subtitle, e.curated_fields AS claims, el.description AS point_description
     FROM experience_parts p JOIN experiences e ON e.id = p.part_id
     JOIN experience_locations el ON el.experience_id = p.part_id
    WHERE p.whole_id = $1 AND p.external_ref = $2`, [THEBES, LUXOR.externalRef],
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
     VALUES ($1, $2, '87-fields-fixture', 'Ancient Thebes (part fields fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
    [THEBES, heritage.id],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '87-fields-fixture', 'auto', NOW())`,
    [THEBES, heritage.kind_id, heritage.id],
  );
  await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a curator's correction of a part's point (ADR-0156)", () => {
  it('writes the line under its name as the part\'s subtitle, claimed there, which the next run keeps', async () => {
    const before = await luxor();
    await editLocation({
      params: { locationId: before.point_id },
      body: { description: 'Temple of Amun, Mut and Khonsu' },
      caller: { id: adminId, role: 'admin' } as Express.User,
    } as never);

    const after = await luxor();
    expect(after).toMatchObject({ subtitle: 'Temple of Amun, Mut and Khonsu', point_description: null });
    expect(after.claims).toContain('subtitle');

    const changed = await writePointContents(THEBES, [
      { ref: LUXOR.externalRef, imageUrl: null, imageCredit: null, subtitle: 'ancient Egyptian temple', articleUrl: null },
    ], run);
    expect((await luxor()).subtitle).toBe('Temple of Amun, Mut and Khonsu');
    expect(changed[0].fields).toMatchObject([{ field: 'subtitle', curatedConflict: true, held: false }]);

    // The site's read serves it as the point's description, the claim with it.
    const read = await getExperienceLocations({
      params: { id: THEBES }, query: experienceLocationsQuerySchema.parse({}), caller: undefined,
    });
    expect(read.locations.find(point => point.id === before.point_id)).toMatchObject({
      description: 'Temple of Amun, Mut and Khonsu', curated_fields: expect.arrayContaining(['description']),
    });
  });
});

describe('a component item confirmed or taken back on a part that holds a kind of its own (ADR-0156)', () => {
  it('only fills what the part lacks, and takes nothing off its row', async () => {
    const before = await luxor();
    const picture = 'http://commons.wikimedia.org/wiki/Special:FilePath/Luxor%20temple%20fixture.jpg';
    const kinds = 'http://commons.wikimedia.org/wiki/Special:FilePath/Luxor%20worship%20fixture.jpg';
    // The Luxor Temple as Places of worship brought it: a picture of its own, no subtitle.
    await pool.query('UPDATE experiences SET image_url = $2 WHERE id = $1', [before.part_id, kinds]);
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, 4, 4, 'Q9970002', 'verified', NOW())`, [before.part_id],
    );
    const row = async () => (await pool.query<{ image_url: string | null; subtitle: string | null }>(
      'SELECT image_url, subtitle FROM experiences WHERE id = $1', [before.part_id],
    )).rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, before.part_id);
      const outcome = await claimPointItem(client, locked!.lock, before.point_id, 'Q9970001', {
        imageUrl: picture, credit: { author: 'A photographer', license: 'CC BY 4.0', licenseUrl: null, detailsUrl: null },
        description: 'ancient Egyptian temple', articleUrl: null,
      });
      expect(outcome.pictured).toBe(false);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await row()).toEqual({ image_url: kinds, subtitle: 'ancient Egyptian temple' });

    const again = await pool.connect();
    try {
      await again.query('BEGIN');
      const locked = await lockExperience(again, before.part_id);
      expect(await releasePointItem(again, locked!.lock, before.point_id)).toEqual([]);
      await again.query('COMMIT');
    } finally {
      again.release();
    }
    expect(await row()).toEqual({ image_url: kinds, subtitle: 'ancient Egyptian temple' });
  });
});

describe("a part's item, on its record in World Heritage components (ADR-0156 decision 2)", () => {
  const record = async (partId: number) => (await pool.query<{ items: string[] | null; claims: string[] }>(
    `SELECT wikidata_items AS items, curated_fields AS claims FROM experience_kind_memberships
      WHERE experience_id = $1 AND kind_id = 10`, [partId],
  )).rows[0];

  it("is recorded by the run there, never on the point, and the registry reads it as the part's", async () => {
    const before = await luxor();
    expect(await recordComponentItems(THEBES, [{ ref: LUXOR.externalRef, item: 'Q9970001' }], run.sourceId)).toBe(1);

    expect((await record(before.part_id)).items).toEqual(['Q9970001']);
    const point = await pool.query<{ wikidata_item: string | null }>('SELECT wikidata_item FROM experience_locations WHERE id = $1', [before.point_id]);
    expect(point.rows[0].wikidata_item).toBeNull();
    const registry = await pool.query<{ identifies: boolean; basis: string[] }>(
      `SELECT identifies, basis FROM place_identifiers WHERE experience_id = $1 AND scheme = 'wikidata' AND value = 'Q9970001'`,
      [before.part_id],
    );
    expect(registry.rows).toEqual([{ identifies: true, basis: ['component-item'] }]);
  });

  it("keeps a curator's item against the run, and takes it off with the claim", async () => {
    const before = await luxor();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, THEBES);
      await claimPointItem(client, locked!.lock, before.point_id, 'Q9970002', {
        imageUrl: null, credit: null, description: null, articleUrl: null,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await record(before.part_id)).toMatchObject({ items: ['Q9970002'], claims: expect.arrayContaining(['wikidata_items']) });

    expect(await recordComponentItems(THEBES, [{ ref: LUXOR.externalRef, item: 'Q9970001' }], run.sourceId)).toBe(0);
    expect((await record(before.part_id)).items).toEqual(['Q9970002']);

    const again = await pool.connect();
    try {
      await again.query('BEGIN');
      const locked = await lockExperience(again, THEBES);
      await releasePointItem(again, locked!.lock, before.point_id);
      await again.query('COMMIT');
    } finally {
      again.release();
    }
    const after = await record(before.part_id);
    expect(after.items).toBeNull();
    expect(after.claims).not.toContain('wikidata_items');
  });
});

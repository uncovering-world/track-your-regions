import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writePointContents } from './pointContentWriter.js';

/**
 * A component's own picture, credit and description (#1270), against
 * PostgreSQL, on four components of Prehistoric Pile Dwellings around the Alps
 * (1363) under a gated source. Riesi and Bourg are on show: Riesi shows nothing
 * of its own yet, so the run fills it (ADR-0089), while Bourg's picture and
 * description are what readers see, so their replacement waits for a curator.
 * See and Port are unread, so the run writes them, but a curator wrote Port's
 * description and the run keeps it.
 */

const PILES = 9840;
const SOURCE_NAME = 'Point contents fixture source';
const RIESI = 'http://commons.wikimedia.org/wiki/Special:FilePath/Riesi%20Pfahlbau.jpg';
const SEE = 'http://commons.wikimedia.org/wiki/Special:FilePath/See%20Pfahlbau.jpg';
const BOURG_OLD = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bourg%20old.jpg';
const BOURG_NEW = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bourg%20new.jpg';
const OLD_CREDIT = { author: 'An earlier photographer', license: 'CC BY 4.0', licenseUrl: null, detailsUrl: null };
const CREDIT = { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };

let sourceId: number;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PILES]);
  await pool.query('DELETE FROM experience_sources WHERE name = $1', [SOURCE_NAME]);
}

async function point(
  ref: string, name: string, state: string, curated: string[], description: string | null, membershipId: number,
  picture: { url: string; credit: object } | null = null,
) {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations
       (experience_id, name, external_ref, location, curation_state, curated_fields, description, image_url, metadata)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326), $4, $5::jsonb, $6, $7, $8::jsonb) RETURNING id`,
    [PILES, name, ref, state, JSON.stringify(curated), description, picture?.url ?? null,
      JSON.stringify(picture ? { imageCredit: picture.credit } : {})],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId]);
}

const stored = async () => (await pool.query<{
  external_ref: string; image_url: string | null; credit: unknown; description: string | null;
}>(
  `SELECT external_ref, image_url, metadata -> 'imageCredit' AS credit, description
     FROM experience_locations WHERE experience_id = $1 ORDER BY external_ref`, [PILES],
)).rows;

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number }>(
    `INSERT INTO experience_sources (name, description, display_priority, requires_curation, kind_id)
     SELECT $1, 'A gated source for this test', 99, true, kind_id FROM experience_sources
      WHERE name = 'UNESCO World Heritage Sites' RETURNING id`,
    [SOURCE_NAME],
  );
  sourceId = source.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '1363-fixture', 'Prehistoric Pile Dwellings around the Alps', ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326))`,
    [PILES, sourceId],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, kind_id, id, '1363-fixture', 'verified', NOW() FROM experience_sources WHERE id = $2 RETURNING id`,
    [PILES, sourceId],
  );
  const id = membership.rows[0].id;
  await point('1363-002', 'Riesi', 'verified', [], null, id);
  await point('1363-015', 'Port', 'pending', ['description'], "A curator's words", id);
  await point('1363-016', 'Bourg', 'verified', [], 'pile dwelling', id, { url: BOURG_OLD, credit: OLD_CREDIT });
  await point('1363-061', 'See', 'pending', [], null, id);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a component's own picture and description", () => {
  it('holds what a reader sees, fills what is empty, writes what nobody has passed, and keeps a claim', async () => {
    const changed = await writePointContents(PILES, [
      { ref: '1363-002', imageUrl: RIESI, imageCredit: CREDIT, description: 'pile dwelling at Riesi' },
      { ref: '1363-015', imageUrl: null, imageCredit: null, description: 'pile dwelling at Port' },
      { ref: '1363-016', imageUrl: BOURG_NEW, imageCredit: CREDIT, description: 'pile dwelling at Bourg' },
      { ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, description: 'pile dwelling at See' },
    ], { syncLogId: null, sourceId });

    expect(await stored()).toEqual([
      { external_ref: '1363-002', image_url: RIESI, credit: CREDIT, description: 'pile dwelling at Riesi' },
      { external_ref: '1363-015', image_url: null, credit: null, description: "A curator's words" },
      { external_ref: '1363-016', image_url: BOURG_OLD, credit: OLD_CREDIT, description: 'pile dwelling' },
      { external_ref: '1363-061', image_url: SEE, credit: CREDIT, description: 'pile dwelling at See' },
    ]);
    const flags = (ref: string) => changed.find(entry => entry.item.ref === ref)?.fields
      .map(field => [field.field, field.held, field.curatedConflict]);
    expect(flags('1363-002')).toEqual([
      ['image_url', false, false], ['metadata.imageCredit', false, false], ['description', false, false],
    ]);
    expect(flags('1363-016')).toEqual([
      ['image_url', true, false], ['metadata.imageCredit', true, false], ['description', true, false],
    ]);
    expect(changed.find(entry => entry.item.ref === '1363-016')?.fields
      .find(field => field.field === 'metadata.imageCredit')?.new).toEqual(CREDIT);
    expect(flags('1363-015')).toEqual([['description', false, true]]);
  });

  it('holds a new credit for a picture a reader sees, and fills a missing one', async () => {
    const run = { syncLogId: null, sourceId };
    const changed = await writePointContents(PILES, [
      { ref: '1363-016', imageUrl: BOURG_OLD, imageCredit: CREDIT, description: 'pile dwelling' },
    ], run);
    expect(changed[0].fields.map(field => [field.field, field.held])).toEqual([['metadata.imageCredit', true]]);
    expect((await stored())[2].credit).toEqual(OLD_CREDIT);
  });

  it('keeps the credit it holds for the same file, and takes picture and credit away together', async () => {
    const run = { syncLogId: null, sourceId };
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, description: null }], run);

    expect(await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: null, description: null }], run))
      .toEqual([]);
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: SEE, credit: CREDIT, description: null });

    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: null, imageCredit: null, description: null }], run);
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: null, credit: null, description: null });
  });

  it("gives a second point the credit another point holds for the same file", async () => {
    const run = { syncLogId: null, sourceId };
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, description: null }], run);
    // Riesi resolves to an item with the same picture, and the run asked
    // Commons nothing about a file a point already holds a credit for.
    await writePointContents(PILES, [{ ref: '1363-002', imageUrl: SEE, imageCredit: null, description: null }], run);
    expect((await stored())[0]).toEqual({ external_ref: '1363-002', image_url: SEE, credit: CREDIT, description: null });
  });

  it('writes no picture that is not a Commons file, and no credit beside it', async () => {
    await writePointContents(PILES, [
      { ref: '1363-061', imageUrl: 'https://whc.unesco.org/uploads/sites/gallery/site_1363.jpg', imageCredit: CREDIT, description: null },
    ], { syncLogId: null, sourceId });
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: null, credit: null, description: null });
  });
});

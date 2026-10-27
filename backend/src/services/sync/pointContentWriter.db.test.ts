import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writePointContents } from './pointContentWriter.js';

/**
 * A component's own picture, credit, subtitle (#1270) and article (#1963),
 * written on its part's row (ADR-0156 decision 3), against PostgreSQL, on four
 * components of Prehistoric Pile Dwellings around the Alps (1363) under a gated
 * source, each a part of the site. Riesi and Bourg are on show: Riesi shows
 * nothing of its own yet, so the run fills it (ADR-0089), while Bourg's picture
 * and subtitle are what readers see, so their replacement waits for a curator.
 * See and Port are unread, so the run writes them, but a curator wrote Port's
 * subtitle and the run keeps it.
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
let membershipId: number;

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [PILES],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [PILES]);
  await pool.query('DELETE FROM experience_sources WHERE name = $1', [SOURCE_NAME]);
}

/** One component as the run leaves it: a part of the site, with its point placed by the site's membership. */
async function part(
  ref: string, name: string, state: string,
  own: { claims?: string[]; subtitle?: string | null; picture?: { url: string; credit: object }; article?: string } = {},
): Promise<number> {
  const metadata = {
    ...(own.picture ? { imageCredit: own.picture.credit } : {}),
    ...(own.article ? { wikipediaUrl: own.article } : {}),
  };
  const placed = await pool.query<{ id: number }>(
    `INSERT INTO experiences (source_id, external_id, name, location, subtitle, image_url, metadata, curated_fields)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326), $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
    [sourceId, `part:${ref}`, name, own.subtitle ?? null, own.picture?.url ?? null, JSON.stringify(metadata),
      JSON.stringify(own.claims ?? [])],
  );
  const partId = placed.rows[0].id;
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
     VALUES ($1, $2, 'component', $3, $4)`,
    [PILES, partId, membershipId, ref],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(9.0, 47.5), 4326), $4) RETURNING id`,
    [partId, name, ref, state],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [point.rows[0].id, membershipId]);
  return partId;
}

const stored = async () => (await pool.query<{
  external_ref: string; image_url: string | null; credit: unknown; subtitle: string | null;
}>(
  `SELECT p.external_ref, e.image_url, e.metadata -> 'imageCredit' AS credit, e.subtitle
     FROM experience_parts p JOIN experiences e ON e.id = p.part_id
    WHERE p.whole_id = $1 ORDER BY p.external_ref`, [PILES],
)).rows;

const articles = async () => (await pool.query<{ external_ref: string; article: string | null }>(
  `SELECT p.external_ref, e.metadata ->> 'wikipediaUrl' AS article
     FROM experience_parts p JOIN experiences e ON e.id = p.part_id
    WHERE p.whole_id = $1 ORDER BY p.external_ref`, [PILES],
)).rows.map(row => [row.external_ref, row.article]);

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
  membershipId = membership.rows[0].id;
  await part('1363-002', 'Riesi', 'verified');
  await part('1363-015', 'Port', 'pending', { claims: ['subtitle'], subtitle: "A curator's words" });
  await part('1363-016', 'Bourg', 'verified', { subtitle: 'pile dwelling', picture: { url: BOURG_OLD, credit: OLD_CREDIT } });
  await part('1363-061', 'See', 'pending');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a component's own picture and subtitle, on its part (ADR-0156)", () => {
  it('holds what a reader sees, fills what is empty, writes what nobody has passed, and keeps a claim', async () => {
    const changed = await writePointContents(PILES, [
      { ref: '1363-002', imageUrl: RIESI, imageCredit: CREDIT, subtitle: 'pile dwelling at Riesi', articleUrl: null },
      { ref: '1363-015', imageUrl: null, imageCredit: null, subtitle: 'pile dwelling at Port', articleUrl: null },
      { ref: '1363-016', imageUrl: BOURG_NEW, imageCredit: CREDIT, subtitle: 'pile dwelling at Bourg', articleUrl: null },
      { ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, subtitle: 'pile dwelling at See', articleUrl: null },
    ], { syncLogId: null, sourceId });

    expect(await stored()).toEqual([
      { external_ref: '1363-002', image_url: RIESI, credit: CREDIT, subtitle: 'pile dwelling at Riesi' },
      { external_ref: '1363-015', image_url: null, credit: null, subtitle: "A curator's words" },
      { external_ref: '1363-016', image_url: BOURG_OLD, credit: OLD_CREDIT, subtitle: 'pile dwelling' },
      { external_ref: '1363-061', image_url: SEE, credit: CREDIT, subtitle: 'pile dwelling at See' },
    ]);
    const flags = (ref: string) => changed.find(entry => entry.item.ref === ref)?.fields
      .map(field => [field.field, field.held, field.curatedConflict]);
    expect(flags('1363-002')).toEqual([
      ['image_url', false, false], ['metadata.imageCredit', false, false], ['subtitle', false, false],
    ]);
    expect(flags('1363-016')).toEqual([
      ['image_url', true, false], ['metadata.imageCredit', true, false], ['subtitle', true, false],
    ]);
    expect(changed.find(entry => entry.item.ref === '1363-016')?.fields
      .find(field => field.field === 'metadata.imageCredit')?.new).toEqual(CREDIT);
    expect(flags('1363-015')).toEqual([['subtitle', false, true]]);
    // The point says only where the part stands.
    const points = await pool.query<{ image_url: string | null; description: string | null }>(
      `SELECT el.image_url, el.description FROM experience_parts p JOIN experience_locations el ON el.experience_id = p.part_id
        WHERE p.whole_id = $1`, [PILES],
    );
    expect(points.rows.every(row => row.image_url === null && row.description === null)).toBe(true);
  });

  it('holds a new credit for a picture a reader sees, and fills a missing one', async () => {
    const run = { syncLogId: null, sourceId };
    const changed = await writePointContents(PILES, [
      { ref: '1363-016', imageUrl: BOURG_OLD, imageCredit: CREDIT, subtitle: 'pile dwelling', articleUrl: null },
    ], run);
    expect(changed[0].fields.map(field => [field.field, field.held])).toEqual([['metadata.imageCredit', true]]);
    expect((await stored())[2].credit).toEqual(OLD_CREDIT);
  });

  it('keeps the credit it holds for the same file, and takes picture and credit away together', async () => {
    const run = { syncLogId: null, sourceId };
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, subtitle: null, articleUrl: null }], run);

    expect(await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: null, subtitle: null, articleUrl: null }], run))
      .toEqual([]);
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: SEE, credit: CREDIT, subtitle: null });

    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: null, imageCredit: null, subtitle: null, articleUrl: null }], run);
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: null, credit: null, subtitle: null });
  });

  it('gives a second part the credit another place holds for the same file', async () => {
    const run = { syncLogId: null, sourceId };
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: SEE, imageCredit: CREDIT, subtitle: null, articleUrl: null }], run);
    // Riesi resolves to an item with the same picture, and the run asked
    // Commons nothing about a file a place already holds a credit for.
    await writePointContents(PILES, [{ ref: '1363-002', imageUrl: SEE, imageCredit: null, subtitle: null, articleUrl: null }], run);
    expect((await stored())[0]).toEqual({ external_ref: '1363-002', image_url: SEE, credit: CREDIT, subtitle: null });
  });

  it("writes a part's own article as its picture and subtitle are written, and asks nothing where it changes nothing (#1963)", async () => {
    const run = { syncLogId: null, sourceId };
    const article = (name: string) => `https://en.wikipedia.org/wiki/${name}`;
    // Bourg shows readers an article already.
    await pool.query(
      `UPDATE experiences SET metadata = metadata || '{"wikipediaUrl": "https://en.wikipedia.org/wiki/Bourg_old"}'::jsonb
        WHERE id = (SELECT part_id FROM experience_parts WHERE whole_id = $1 AND external_ref = '1363-016')`, [PILES],
    );
    const changed = await writePointContents(PILES, [
      { ref: '1363-002', imageUrl: null, imageCredit: null, subtitle: null, articleUrl: article('Riesi') },
      { ref: '1363-016', imageUrl: BOURG_OLD, imageCredit: OLD_CREDIT, subtitle: 'pile dwelling', articleUrl: article('Bourg') },
      { ref: '1363-061', imageUrl: null, imageCredit: null, subtitle: null, articleUrl: 'javascript:alert(1)' },
    ], run);

    // Riesi showed none and is filled; Bourg's is what readers see, so the new
    // one waits for a curator; a value that is no web address is no article.
    expect(await articles()).toEqual([
      ['1363-002', article('Riesi')], ['1363-015', null], ['1363-016', 'https://en.wikipedia.org/wiki/Bourg_old'], ['1363-061', null],
    ]);
    const field = (entries: typeof changed, ref: string) => entries.find(entry => entry.item.ref === ref)?.fields
      .find(one => one.field === 'metadata.wikipediaUrl');
    expect(field(changed, '1363-002')).toMatchObject({ held: false, new: article('Riesi') });
    expect(field(changed, '1363-016')).toMatchObject({ held: true, old: 'https://en.wikipedia.org/wiki/Bourg_old', new: article('Bourg') });
    // The article is written beside the credit, never in its place.
    expect((await stored())[2].credit).toEqual(OLD_CREDIT);

    // The article a reader is shown offered again asks nothing.
    const same = await writePointContents(PILES, [
      { ref: '1363-016', imageUrl: BOURG_OLD, imageCredit: OLD_CREDIT, subtitle: 'pile dwelling', articleUrl: 'https://en.wikipedia.org/wiki/Bourg_old' },
    ], run);
    expect(field(same, '1363-016')).toBeUndefined();

    // An item that has no article any more takes it from a part nobody has passed.
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: null, imageCredit: null, subtitle: null, articleUrl: article('See') }], run);
    await writePointContents(PILES, [{ ref: '1363-061', imageUrl: null, imageCredit: null, subtitle: null, articleUrl: null }], run);
    expect((await articles())[3]).toEqual(['1363-061', null]);
  });

  it('only fills a part that holds a kind of its own, which keeps what its kind brought', async () => {
    const run = { syncLogId: null, sourceId };
    const riesi = (await pool.query<{ part_id: number }>(
      `SELECT part_id FROM experience_parts WHERE whole_id = $1 AND external_ref = '1363-002'`, [PILES],
    )).rows[0].part_id;
    // Riesi as another kind brought it: a picture of its own, and no subtitle.
    await pool.query(`UPDATE experiences SET image_url = $2 WHERE id = $1`, [riesi, BOURG_OLD]);
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, 5, 5, 'Q9840002', 'verified', NOW())`, [riesi],
    );

    const changed = await writePointContents(PILES, [
      { ref: '1363-002', imageUrl: RIESI, imageCredit: CREDIT, subtitle: 'pile dwelling at Riesi', articleUrl: null },
    ], run);

    expect((await stored())[0]).toEqual({ external_ref: '1363-002', image_url: BOURG_OLD, credit: null, subtitle: 'pile dwelling at Riesi' });
    expect(changed[0].fields.map(field => field.field)).toEqual(['subtitle']);
  });

  it('writes no picture that is not a Commons file, and no credit beside it', async () => {
    await writePointContents(PILES, [
      { ref: '1363-061', imageUrl: 'https://whc.unesco.org/uploads/sites/gallery/site_1363.jpg', imageCredit: CREDIT, subtitle: null, articleUrl: null },
    ], { syncLogId: null, sourceId });
    expect((await stored())[3]).toEqual({ external_ref: '1363-061', image_url: null, credit: null, subtitle: null });
  });
});

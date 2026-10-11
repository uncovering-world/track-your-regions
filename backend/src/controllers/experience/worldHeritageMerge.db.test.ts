import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { mergeEqualItems } from './equalItemMerges.js';
import { undoMerge } from './placeMerge.js';

/**
 * A World Heritage site of one point is its one Wikidata item (#1248,
 * ADR-0088), against PostgreSQL. Chartres Cathedral is a World Heritage row
 * (81, one point) and a place of worship (Q180274) thirty metres apart: they
 * merge, to one point. A serial site of two points sharing an item, a site
 * whose id resolves to two items, and a site whose point was never written
 * merge with nothing. Osun-Osogbo is the same shape with a point each source
 * withdrew beside the one it stands on (#1360): a withdrawn point is no point,
 * so the site is still its one item and the grove's standing point folds into
 * the site's.
 */

const CHARTRES = 9830;
const CHARTRES_WORSHIP = 9831;
const SERIAL = 9832;
const SERIAL_WORSHIP = 9833;
const TWO_ITEMS = 9834;
const TWO_ITEMS_WORSHIP = 9835;
const NO_POINT = 9836;
const NO_POINT_WORSHIP = 9837;
const OSUN = 9838;
const OSUN_GROVE = 9839;
const PLACES = [
  CHARTRES, CHARTRES_WORSHIP, SERIAL, SERIAL_WORSHIP, TWO_ITEMS, TWO_ITEMS_WORSHIP, NO_POINT, NO_POINT_WORSHIP,
  OSUN, OSUN_GROVE,
];
const CURATOR = '00000000-0000-4000-8000-000000009830';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function place(
  id: number, source: string, externalId: string, items: string[] | null, points: Array<[string, number, number]>,
): Promise<void> {
  const [, lon, lat] = points[0] ?? ['', 30, 30];
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'World Heritage merge fixture', ST_SetSRID(ST_MakePoint($3, $4), 4326)
       FROM experience_sources s WHERE s.name = $5`,
    [id, externalId, lon, lat, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, wikidata_items)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), $3 FROM experience_sources s WHERE s.name = $4 RETURNING id`,
    [id, externalId, items, source],
  );
  for (const [ref, pointLon, pointLat] of points) {
    const point = await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location)
       VALUES ($1, $2, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)) RETURNING id`,
      [id, ref, pointLon, pointLat],
    );
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
      [point.rows[0].id, membership.rows[0].id]);
  }
}

/** A point its source withdrew: marked, kept, and on no reader's map. */
async function withdrawnPoint(id: number, ref: string, lon: number, lat: number): Promise<void> {
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, missing_since)
     VALUES ($1, $2, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())`,
    [id, ref, lon, lat],
  );
}

/** The pins a reader is drawn: neither folded nor withdrawn. */
const pins = async (id: number) => (await pool.query<{ ref: string }>(
  `SELECT external_ref AS ref FROM experience_locations
    WHERE experience_id = $1 AND merged_into_id IS NULL AND missing_since IS NULL ORDER BY id`, [id],
)).rows.map(row => row.ref);

const standingPoints = async (id: number) => (await pool.query<{ placements: number }>(
  `SELECT (SELECT count(*)::int FROM experience_location_placements p WHERE p.location_id = el.id) AS placements
     FROM experience_locations el WHERE el.experience_id = $1 AND el.merged_into_id IS NULL`, [id],
)).rows;

beforeEach(async () => {
  await clear();
  const unesco = 'UNESCO World Heritage Sites';
  const worship = 'Places of worship';
  await place(CHARTRES, unesco, '81-fixture', ['Q180274'], [['81-001', 1.4878, 48.4477]]);
  await place(CHARTRES_WORSHIP, worship, 'Q180274', null, [['Q180274', 1.4876, 48.4479]]);
  await place(SERIAL, unesco, '9832-fixture', ['Q98320'], [['9832-001', 10, 10], ['9832-002', 10.01, 10.01]]);
  await place(SERIAL_WORSHIP, worship, 'Q98320', null, [['Q98320', 10, 10]]);
  await place(TWO_ITEMS, unesco, '9834-fixture', ['Q98340', 'Q98341'], [['9834-001', 20, 20]]);
  await place(TWO_ITEMS_WORSHIP, worship, 'Q98340', null, [['Q98340', 20, 20]]);
  await place(NO_POINT, unesco, '9836-fixture', ['Q98360'], []);
  await place(NO_POINT_WORSHIP, worship, 'Q98360', null, [['Q98360', 30, 30]]);
  // 190 m apart, as on the development catalogue; each place also holds a
  // point its source withdrew.
  await place(OSUN, unesco, '9838-fixture', ['Q98380'], [['9838-001', 40, 40]]);
  await withdrawnPoint(OSUN, '9838-002', 40.01, 40.01);
  await place(OSUN_GROVE, worship, 'Q98380', null, [['Q98380', 40.0022, 40]]);
  await withdrawnPoint(OSUN_GROVE, 'Q98380', 40, 40);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a World Heritage site of one point and its one item (ADR-0088)', () => {
  it('merges with the place of worship sharing its item, to one point, and with nothing else', async () => {
    const report = await mergeEqualItems(['Q180274', 'Q98320', 'Q98340', 'Q98341', 'Q98360']);

    expect(report.merged).toEqual([expect.objectContaining({ qid: 'Q180274', survivorId: CHARTRES, foldedId: CHARTRES_WORSHIP })]);
    expect(report.refused).toEqual([]);
    expect(await standingPoints(CHARTRES)).toEqual([{ placements: 2 }]);
    expect(await standingPoints(CHARTRES_WORSHIP)).toEqual([]);
    expect(await standingPoints(SERIAL)).toHaveLength(2);
    expect(await standingPoints(SERIAL_WORSHIP)).toHaveLength(1);
    expect(await standingPoints(TWO_ITEMS_WORSHIP)).toHaveLength(1);
    expect(await standingPoints(NO_POINT_WORSHIP)).toHaveLength(1);
  });

  it('counts only standing points: a withdrawn one neither keeps a site from its item nor adds a pin (#1360)', async () => {
    const report = await mergeEqualItems(['Q98380']);

    expect(report.merged).toEqual([expect.objectContaining({ qid: 'Q98380', survivorId: OSUN, foldedId: OSUN_GROVE })]);
    expect(await pins(OSUN)).toEqual(['9838-001']);
    expect(await pins(OSUN_GROVE)).toEqual([]);
  });

  it('gives both places back their own point on an undo', async () => {
    const report = await mergeEqualItems(['Q180274']);
    const curator = await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
    );

    await undoMerge(report.merged[0].mergeId, curator.rows[0].id);

    expect(await standingPoints(CHARTRES)).toEqual([{ placements: 1 }]);
    expect(await standingPoints(CHARTRES_WORSHIP)).toEqual([{ placements: 1 }]);
  });
});

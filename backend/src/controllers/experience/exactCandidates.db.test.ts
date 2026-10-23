import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { acceptExactCandidates } from './exactCandidates.js';

/**
 * The catalogue accepts an exact component candidate nothing contradicts
 * (#1839, ADR-0141), against PostgreSQL. The fixture is three tombs of the
 * Mozu-Furuichi Kofun Group as the finder left them on 2026-10-22: the
 * Nagatsuka Kofun with one candidate of its own name 7 m off, and two points
 * whose exact candidates something contradicts.
 */

const SITE = 9839;
const NAGATSUKA = 'Q98391';
const OTHER = 'Q98392';
const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Nagatsuka%20Kofun.jpg';

let membershipId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

async function point(ref: string, name: string, lon: number): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, 34.56), 4326), 'auto') RETURNING id`,
    [SITE, name, ref, lon],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId],
  );
  return row.rows[0].id;
}

async function proposal(locationId: number, item: string, label: string, exact: boolean): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_component_item_proposals
            (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
     VALUES ($1, $2, $3, 7, $4, $5, 'near') RETURNING id`,
    [locationId, item, label, exact ? 1 : 0.5, exact],
  )).rows[0].id;
}

const pointOf = async (id: number) => (await pool.query<{ item: string | null; image: string | null; claimed: boolean }>(
  `SELECT wikidata_item AS item, image_url AS image, curated_fields ? 'wikidata_item' AS claimed
     FROM experience_locations WHERE id = $1`, [id],
)).rows[0];

/** No call to Wikidata: the item's picture and description as a read would give them. */
const readContents = async (items: readonly string[]) => new Map(items.map(item => [
  item, {
    imageUrl: item === NAGATSUKA ? PICTURE : null,
    credit: item === NAGATSUKA ? { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null } : null,
    description: 'Kofun in Sakai, Japan',
  },
]));

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9839-fixture', 'Mozu-Furuichi fixture', ST_SetSRID(ST_MakePoint(135.48, 34.56), 4326))`,
    [SITE],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9839-fixture', 'auto', NOW() FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [SITE],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("the catalogue's own answer to an exact candidate", () => {
  it('records the item on its point, with what it gives, and names no curator in the history', async () => {
    const nagatsuka = await point('1593-030', 'Nagatsuka Kofun', 135.48);
    const id = await proposal(nagatsuka, NAGATSUKA, 'Nagatsuka Kofun', true);

    expect(await acceptExactCandidates(SITE, { readContents })).toEqual({ accepted: 1, sites: 1, leftForNextPass: 0 });
    expect(await pointOf(nagatsuka)).toEqual({ item: NAGATSUKA, image: PICTURE, claimed: true });
    const answer = (await pool.query(
      'SELECT answer, answered_by, answered_by_catalogue FROM experience_component_item_proposals WHERE id = $1', [id],
    )).rows[0];
    expect(answer).toEqual({ answer: 'accepted', answered_by: null, answered_by_catalogue: true });
    const log = (await pool.query<{ curator_id: number | null; catalogue: string }>(
      `SELECT curator_id, details ->> 'catalogue' AS catalogue FROM experience_curation_log
        WHERE experience_id = $1 AND action = 'component_items_answered'`, [SITE],
    )).rows;
    expect(log).toEqual([{ curator_id: null, catalogue: 'exact' }]);
  });

  it('leaves a point with two exact candidates, and an item proposed for two points, to a curator', async () => {
    const twice = await point('1593-031', 'Twin Kofun', 135.481);
    await proposal(twice, NAGATSUKA, 'Twin Kofun', true);
    await proposal(twice, OTHER, 'Twin Kofun', true);
    const shared = await point('1593-032', 'Shared Kofun', 135.482);
    await proposal(shared, NAGATSUKA, 'Shared Kofun', true);

    expect(await acceptExactCandidates(SITE, { readContents })).toEqual({ accepted: 0, sites: 0, leftForNextPass: 0 });
  });

  it('leaves a candidate a register disagrees with, one taken back, and a partial name', async () => {
    const disagreed = await point('1593-033', 'Register Kofun', 135.483);
    const one = await proposal(disagreed, NAGATSUKA, 'Register Kofun', true);
    await pool.query('UPDATE experience_component_item_proposals SET register_disagrees = true WHERE id = $1', [one]);
    const takenBack = await point('1593-034', 'Taken Kofun', 135.484);
    const two = await proposal(takenBack, OTHER, 'Taken Kofun', true);
    await pool.query('UPDATE experience_component_item_proposals SET taken_back_at = NOW() WHERE id = $1', [two]);
    const partial = await point('1593-035', 'Partial Kofun', 135.485);
    await proposal(partial, 'Q98393', 'Partial Kofun Group', false);

    expect(await acceptExactCandidates(SITE, { readContents })).toEqual({ accepted: 0, sites: 0, leftForNextPass: 0 });
  });

  it('leaves a site whose items could not be read for the next pass, rather than accept it without its picture', async () => {
    const nagatsuka = await point('1593-030', 'Nagatsuka Kofun', 135.48);
    await proposal(nagatsuka, NAGATSUKA, 'Nagatsuka Kofun', true);
    const failing = async () => { throw new Error('Wikidata answered 429'); };

    expect(await acceptExactCandidates(SITE, { readContents: failing })).toEqual({ accepted: 0, sites: 0, leftForNextPass: 1 });
    expect(await pointOf(nagatsuka)).toEqual({ item: null, image: null, claimed: false });
  });

  it('writes no site once the pass is cancelled', async () => {
    const nagatsuka = await point('1593-030', 'Nagatsuka Kofun', 135.48);
    await proposal(nagatsuka, NAGATSUKA, 'Nagatsuka Kofun', true);

    expect(await acceptExactCandidates(SITE, { readContents, isCancelled: () => true }))
      .toEqual({ accepted: 0, sites: 0, leftForNextPass: 0 });
    expect((await pointOf(nagatsuka)).item).toBeNull();
  });

  it('accepts the rest of a site when one item comes back without its content', async () => {
    const nagatsuka = await point('1593-030', 'Nagatsuka Kofun', 135.48);
    await proposal(nagatsuka, NAGATSUKA, 'Nagatsuka Kofun', true);
    const other = await point('1593-036', 'Other Kofun', 135.486);
    await proposal(other, OTHER, 'Other Kofun', true);
    // The other item's picture had no credit, so the read left it out.
    const partial = async (items: readonly string[]) => new Map([...(await readContents(items))].filter(([item]) => item === NAGATSUKA));

    expect(await acceptExactCandidates(SITE, { readContents: partial })).toEqual({ accepted: 1, sites: 1, leftForNextPass: 1 });
    expect((await pointOf(nagatsuka)).item).toBe(NAGATSUKA);
    expect((await pointOf(other)).item).toBeNull();
  });
});

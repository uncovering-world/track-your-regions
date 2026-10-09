import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writePointContents } from '../../services/sync/pointContentWriter.js';
import {
  answerComponentItemsUnderLock, componentItemsSourceIds, openCandidates,
} from './componentItemController.js';
import { queryComponentItems } from './reviewQueueComponentItems.js';

/**
 * A curator's answer to the candidate Wikidata items of a serial site's
 * components (#1272), executed against PostgreSQL.
 *
 * The fixture is a stretch of the Dacian frontier as the finder leaves it:
 * three components, Bologa with two candidates — the fort of Bologa, the same
 * name 20 m off, and a nearby tower with a name half alike — Buciumi with one,
 * and a third point already resolved by its reference, which is asked nothing.
 */

const SITE = 9850;
const CURATOR = '00000000-0000-4000-8000-000000009850';
const BOLOGA_FORT = 'Q98501';
const BOLOGA_TOWER = 'Q98502';
const BUCIUMI_FORT = 'Q98503';
const RESOLVED = 'Q98509';
const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Castrul%20Bologa.jpg';
const CREDIT = { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };

let curatorId = 0;
let membershipId = 0;
let points: Record<string, number> = {};
let proposals: Record<string, number> = {};

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function point(ref: string, name: string, lat: number, lon: number, item: string | null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, wikidata_item, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, 'auto') RETURNING id`,
    [SITE, name, ref, lon, lat, item],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId],
  );
  return row.rows[0].id;
}

async function proposal(locationId: number, item: string, label: string, metres: number, similarity: number, exact: boolean,
  at: [lat: number, lon: number] | null = null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_component_item_proposals
            (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis, item_location)
     VALUES ($1, $2, $3, $4, $5, $6, 'near',
             CASE WHEN $7::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $8), 4326) END) RETURNING id`,
    [locationId, item, label, metres, similarity, exact, at?.[1] ?? null, at?.[0] ?? null],
  );
  return row.rows[0].id;
}

const stored = async (locationId: number) => (await pool.query<{
  wikidata_item: string | null; curated_fields: string[]; image_url: string | null; credit: unknown; description: string | null;
}>(
  `SELECT wikidata_item, curated_fields, image_url, metadata -> 'imageCredit' AS credit, description
     FROM experience_locations WHERE id = $1`, [locationId],
)).rows[0];

const answersOf = async () => (await pool.query<{ id: number; answer: string | null; answered_by: number | null }>(
  `SELECT p.id, p.answer, p.answered_by FROM experience_component_item_proposals p
     JOIN experience_locations el ON el.id = p.location_id WHERE el.experience_id = $1 ORDER BY p.id`, [SITE],
)).rows;

const card = async () => (await queryComponentItems([SITE])).rows[0];

const content = (image: string | null, credit: typeof CREDIT | null) => new Map([
  [BOLOGA_FORT, { imageUrl: image, credit, description: 'Roman fort in Cluj County, Romania' }],
]);

beforeEach(async () => {
  await clear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9850-fixture', 'Component answers fixture', ST_SetSRID(ST_MakePoint(22.87, 46.88), 4326))`,
    [SITE],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9850-fixture', 'auto', NOW() FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [SITE],
  )).rows[0].id;
  points = {
    bologa: await point('9850-001', 'Bologa', 46.8853, 22.8752, null),
    buciumi: await point('9850-002', 'Buciumi', 47.0383, 23.0581, null),
    resolved: await point('9850-003', 'Resolved', 46.9, 22.9, RESOLVED),
  };
  proposals = {
    fort: await proposal(points.bologa, BOLOGA_FORT, 'Castrul Bologa', 20, 1, true, [46.8855, 22.8753]),
    tower: await proposal(points.bologa, BOLOGA_TOWER, 'Turnul Bologa', 410, 0.52, false),
    buciumi: await proposal(points.buciumi, BUCIUMI_FORT, 'Castrul Buciumi', 35, 0.61, false, [47.0385, 23.0583]),
  };
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a site's candidate component items (#1272)", () => {
  it('draws the card by point, the better candidate first, and names the membership that places the points', async () => {
    const row = await card();
    expect(row.kind).toBe('component-items');
    expect(row.membership_id).toBe(membershipId);
    expect(row.component_items.map((c: { item: string }) => c.item)).toEqual([BOLOGA_FORT, BOLOGA_TOWER, BUCIUMI_FORT]);
    expect(row.component_items[0]).toMatchObject({
      proposalId: proposals.fort, locationId: points.bologa, pointName: 'Bologa', pointRef: '9850-001',
      label: 'Castrul Bologa', distanceM: 20, similarity: 1, exact: true, basis: 'near',
      itemLatitude: 46.8855, itemLongitude: 22.8753,
    });
    expect(row.component_items[1]).toMatchObject({ itemLatitude: null, itemLongitude: null });
    expect(await componentItemsSourceIds(SITE)).toEqual([1]);
  });

  it("confirms a candidate as the curator's choice with what the item gives the point, and turns another down", async () => {
    const outcome = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.fort, answer: 'accepted' },
      { proposalId: proposals.buciumi, answer: 'refused' },
    ], content(PICTURE, CREDIT));

    expect(outcome.result).toEqual({ experienceId: SITE, accepted: 1, refused: 1, pictured: 1 });
    expect(await stored(points.bologa)).toEqual({
      wikidata_item: BOLOGA_FORT, curated_fields: ['wikidata_item'], image_url: PICTURE, credit: CREDIT,
      description: 'Roman fort in Cluj County, Romania',
    });
    // The fort is the point's item now, so its other candidate is moot and goes;
    // the refusal stays, which is what keeps the candidate from coming back.
    expect(await answersOf()).toEqual([
      { id: proposals.fort, answer: 'accepted', answered_by: curatorId },
      { id: proposals.buciumi, answer: 'refused', answered_by: curatorId },
    ]);
    expect(await card()).toBeUndefined();
    const log = await pool.query(
      `SELECT action, details FROM experience_curation_log WHERE experience_id = $1`, [SITE],
    );
    expect(log.rows).toEqual([{
      action: 'component_items_answered',
      details: {
        accepted: [{ locationId: points.bologa, point: 'Bologa', item: BOLOGA_FORT, label: 'Castrul Bologa', pictured: true }],
        refused: [{ locationId: points.buciumi, point: 'Buciumi', item: BUCIUMI_FORT, label: 'Castrul Buciumi' }],
      },
    }]);
  });

  it('gives a point its identity and no picture where nobody could credit the photograph', async () => {
    const outcome = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.fort, answer: 'accepted' },
    ], content(PICTURE, null));

    expect(outcome.result).toMatchObject({ accepted: 1, pictured: 0 });
    expect(await stored(points.bologa)).toMatchObject({ wikidata_item: BOLOGA_FORT, image_url: null, credit: null });
  });

  it('writes no picture that is not a Commons file, credited or not (ADR-0043)', async () => {
    const outcome = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.fort, answer: 'accepted' },
    ], content('https://example.org/fort.jpg', CREDIT));

    expect(outcome.result).toMatchObject({ accepted: 1, pictured: 0 });
    expect(await stored(points.bologa)).toMatchObject({ wikidata_item: BOLOGA_FORT, image_url: null, credit: null });
  });

  it('refuses, writing nothing, a candidate answered meanwhile and an item that became another component\'s', async () => {
    await answerComponentItemsUnderLock(SITE, curatorId, null, [{ proposalId: proposals.fort, answer: 'accepted' }], content(null, null));
    const twice = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.fort, answer: 'accepted' },
    ], content(null, null));
    expect(twice.refusal).toMatchObject({ status: 409, error: expect.stringContaining('Bologa already has its item') });

    // The fort proposed for Buciumi too, after it became Bologa's: not open, so
    // the card never shows it, and an answer naming it is refused.
    const stale = await proposal(points.buciumi, BOLOGA_FORT, 'Castrul Bologa', 900, 0.3, false);
    expect((await card()).component_items.map((c: { proposalId: number }) => c.proposalId)).toEqual([proposals.buciumi]);
    const taken = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: stale, answer: 'accepted' },
    ], content(null, null));
    expect(taken.refusal).toMatchObject({ status: 409, error: expect.stringContaining("already another component's item") });

    const twoForOne = await answerComponentItemsUnderLock(SITE, curatorId, null, [
      { proposalId: proposals.buciumi, answer: 'accepted' }, { proposalId: stale, answer: 'accepted' },
    ], content(null, null));
    expect(twoForOne.refusal).toMatchObject({ status: 409 });
    expect(await stored(points.buciumi)).toMatchObject({ wikidata_item: null, curated_fields: [] });
  });

  it('waits on another site confirming the same item, and then reads it as taken', async () => {
    // Another site's answer holds the fort's lock: this one must wait, not read
    // the item as free, and once the other has recorded the fort on its point
    // and committed, read it as taken. The item's lock is what the site's lock
    // cannot give, since the two sites' rows are different.
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('wikidata_item:' || $1::text))`, [BOLOGA_FORT]);
      let settled = false;
      const answer = answerComponentItemsUnderLock(SITE, curatorId, null, [
        { proposalId: proposals.fort, answer: 'accepted' },
      ], content(null, null)).then(outcome => { settled = true; return outcome; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await other.query('UPDATE experience_locations SET wikidata_item = $1 WHERE id = $2', [BOLOGA_FORT, points.buciumi]);
      await other.query('COMMIT');

      const outcome = await answer;
      expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining("already another component's item") });
      expect(await stored(points.bologa)).toMatchObject({ wikidata_item: null, curated_fields: [] });
    } finally {
      other.release();
    }
  });

  it('offers a batch the exact candidates to confirm and every open one to turn down', async () => {
    expect(await openCandidates(SITE, 'exact')).toEqual([proposals.fort]);
    expect(await openCandidates(SITE, 'all')).toEqual([proposals.fort, proposals.tower, proposals.buciumi]);
  });

  it("leaves a point whose item a curator chose alone when the run's index knows nothing of it", async () => {
    await answerComponentItemsUnderLock(SITE, curatorId, null, [{ proposalId: proposals.fort, answer: 'accepted' }],
      content(PICTURE, CREDIT));
    // The run resolves Bologa's reference to no item and offers it nothing.
    const changed = await writePointContents(SITE, [
      { ref: '9850-001', imageUrl: null, imageCredit: null, description: null },
    ], { syncLogId: null, sourceId: 1 });

    expect(changed).toEqual([]);
    expect(await stored(points.bologa)).toMatchObject({ image_url: PICTURE, description: 'Roman fort in Cluj County, Romania' });
  });
});

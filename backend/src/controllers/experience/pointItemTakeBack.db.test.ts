import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerComponentItemsUnderLock, openCandidates } from './componentItemController.js';
import { takeBackPointItemUnderLock } from './pointItemTakeBackController.js';

/**
 * A confirmed component item taken back (#1317), against PostgreSQL: the fort
 * of Bologa confirmed for the point Bologa with its picture and description,
 * then taken back — the point has no item, no claim, no picture and no
 * description again, the candidate is open again (#1336), and the act is logged.
 * A point whose item a run recorded off the reference is not a curator's to
 * take back; a picture a curator chose since the confirmation stays.
 */

const SITE = 9870;
const CURATOR = '00000000-0000-4000-8000-000000009870';
const BOLOGA_FORT = 'Q98701';
const RESOLVED = 'Q98709';
const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Castrul%20Bologa.jpg';
const CREDIT = { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };

let curatorId = 0;
let membershipId = 0;
let bologa = 0;
let resolved = 0;
let fort = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function point(ref: string, name: string, item: string | null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, wikidata_item, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(22.8752, 46.8853), 4326), $4, 'auto') RETURNING id`,
    [SITE, name, ref, item],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [row.rows[0].id, membershipId]);
  return row.rows[0].id;
}

const stored = async (id: number) => (await pool.query<{
  wikidata_item: string | null; curated_fields: string[]; image_url: string | null; credit: unknown; description: string | null;
}>(
  `SELECT wikidata_item, curated_fields, image_url, metadata -> 'imageCredit' AS credit, description
     FROM experience_locations WHERE id = $1`, [id],
)).rows[0];

const confirm = () => answerComponentItemsUnderLock(SITE, curatorId, null, [{ proposalId: fort, answer: 'accepted' }],
  new Map([[BOLOGA_FORT, { imageUrl: PICTURE, credit: CREDIT, description: 'Roman fort in Cluj County, Romania' }]]));

beforeEach(async () => {
  await clear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9870-fixture', 'Take-back fixture', ST_SetSRID(ST_MakePoint(22.87, 46.88), 4326))`,
    [SITE],
  );
  membershipId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9870-fixture', 'auto', NOW() FROM experience_sources s WHERE s.id = 1 RETURNING id`,
    [SITE],
  )).rows[0].id;
  bologa = await point('9870-001', 'Bologa', null);
  resolved = await point('9870-002', 'Resolved', RESOLVED);
  fort = (await pool.query<{ id: number }>(
    `INSERT INTO experience_component_item_proposals
            (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
     VALUES ($1, $2, 'Castrul Bologa', 20, 1, true, 'near') RETURNING id`,
    [bologa, BOLOGA_FORT],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a confirmed component item taken back (#1317)', () => {
  it('takes the item, its claim and what the confirmation wrote off the point, reopens the candidate and logs it', async () => {
    await confirm();
    expect(await stored(bologa)).toMatchObject({ wikidata_item: BOLOGA_FORT, curated_fields: ['wikidata_item'], image_url: PICTURE });

    const outcome = await takeBackPointItemUnderLock(bologa, SITE, curatorId, null, BOLOGA_FORT);

    expect(outcome.result).toEqual({ locationId: bologa, item: BOLOGA_FORT, cleared: ['image_url', 'description'] });
    expect(await stored(bologa)).toEqual({ wikidata_item: null, curated_fields: [], image_url: null, credit: null, description: null });
    const proposal = await pool.query<{ answer: string | null; answered_by: number | null; answered_at: Date | null; marked: boolean }>(
      'SELECT answer, answered_by, answered_at, taken_back_at IS NOT NULL AS marked FROM experience_component_item_proposals WHERE id = $1', [fort],
    );
    // Open again and marked: the card asks about the point with this candidate
    // at once, and neither batch confirmation takes it (#1336).
    expect(proposal.rows[0]).toEqual({ answer: null, answered_by: null, answered_at: null, marked: true });
    expect(await openCandidates(SITE, 'all')).toEqual([fort]);
    expect(await openCandidates(SITE, 'exact')).toEqual([]);
    const log = await pool.query<{ action: string; details: unknown }>(
      `SELECT action, details FROM experience_curation_log WHERE experience_id = $1 ORDER BY id`, [SITE],
    );
    expect(log.rows.map(row => row.action)).toEqual(['component_items_answered', 'component_item_taken_back']);
    expect(log.rows[1].details).toEqual({
      locationId: bologa, point: 'Bologa', item: BOLOGA_FORT, label: 'Castrul Bologa', cleared: ['image_url', 'description'],
    });
  });

  it('keeps a picture a curator chose since the confirmation, and says only the description came off', async () => {
    await confirm();
    const mine = 'http://commons.wikimedia.org/wiki/Special:FilePath/My%20own%20photo.jpg';
    await pool.query(
      `UPDATE experience_locations SET image_url = $2, curated_fields = curated_fields || '["image_url"]'::jsonb WHERE id = $1`,
      [bologa, mine],
    );

    const outcome = await takeBackPointItemUnderLock(bologa, SITE, curatorId, null, BOLOGA_FORT);

    expect(outcome.result).toMatchObject({ cleared: ['description'] });
    expect(await stored(bologa)).toMatchObject({ wikidata_item: null, curated_fields: ['image_url'], image_url: mine, description: null });
  });

  it('refuses a point holding a different item than the history showed, writing nothing', async () => {
    // A history read before another curator took the fort back and confirmed
    // a different candidate names the fort; the point now holds the other one.
    await confirm();

    const stale = await takeBackPointItemUnderLock(bologa, SITE, curatorId, null, 'Q98702');

    expect(stale.refusal).toMatchObject({ status: 409, error: expect.stringContaining('different item') });
    expect(await stored(bologa)).toMatchObject({ wikidata_item: BOLOGA_FORT, curated_fields: ['wikidata_item'], image_url: PICTURE });
    expect((await pool.query('SELECT answer FROM experience_component_item_proposals WHERE id = $1', [fort])).rows[0].answer).toBe('accepted');
  });

  it("refuses a point whose item a run recorded off the reference, and one with no item, writing nothing", async () => {
    const runs = await takeBackPointItemUnderLock(resolved, SITE, curatorId, null, RESOLVED);
    expect(runs.refusal).toMatchObject({ status: 409, error: expect.stringContaining('recorded by a run') });
    expect(await stored(resolved)).toMatchObject({ wikidata_item: RESOLVED });

    const none = await takeBackPointItemUnderLock(bologa, SITE, curatorId, null, BOLOGA_FORT);
    expect(none.refusal).toMatchObject({ status: 409, error: expect.stringContaining('no item to take back') });
    expect((await pool.query('SELECT count(*)::int AS n FROM experience_curation_log WHERE experience_id = $1', [SITE])).rows[0].n).toBe(0);
  });
});

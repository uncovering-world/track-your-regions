import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { mergePlaces, undoMerge } from './placeMerge.js';
import { joinPlacesClaimingOneItem } from './equalItemMerges.js';
import { getExperience } from './experienceQueryController.js';
import { getCurationLog } from './curationLogController.js';
import { assignRegionsForExperiences } from '../../services/sync/regionAssignmentService.js';

/**
 * A merge of two places and its undo (#1247, ADR-0046, ADR-0086), executed
 * against PostgreSQL.
 *
 * The fixture is the Pantheon as the catalogue holds it before a merge: a
 * place of worship and an archaeological site, two rows on one Wikidata item
 * (Q99309), each with its own point on that item and one work both link.
 * One traveller marked both rows, another only the archaeological one. Ids
 * are the fixture's own, deleted before and after.
 */

const WORSHIP = 9700;
const SITE = 9701;
/** A third place with a lower id, for a merge that folds the survivor of an earlier one. */
const MUSEUM = 9699;
const QID = 'Q9700001';
const WORK_QID = 'Q9700-merge-fixture-work';
const TWICE = '00000000-0000-4000-8000-000000009700';
const ONCE = '00000000-0000-4000-8000-000000009701';
const CURATOR = '00000000-0000-4000-8000-000000009702';
/** A world view of the fixture's: a root over two leaves, around the baths and around the Pantheon. */
const ROME = 9706;
const PIGNA = 97060;
const CIAMBELLA = 97061;
const ROTONDA = 97062;

let twiceId = 0;
let onceId = 0;
let curatorId = 0;

async function clear(): Promise<void> {
  const places = [MUSEUM, WORSHIP, SITE];
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [places]);
  await pool.query("DELETE FROM experience_sync_logs WHERE error_details @> '[{\"fixture\": \"merge\"}]'");
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [places]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_regions WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [ROME]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [ROME]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK_QID]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[TWICE, ONCE, CURATOR]]);
}

async function place(id: number, source: string): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Pantheon (merge fixture)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
       FROM experience_sources s WHERE s.name = $3`,
    [id, QID, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, QID, source],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Pantheon', $2, ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)) RETURNING id`,
    [id, QID],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point.rows[0].id, membership.rows[0].id],
  );
  return point.rows[0].id;
}

beforeEach(async () => {
  await clear();
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES
       ($1, 'Twice', 'user'), ($2, 'Once', 'user'), ($3, 'A curator', 'curator') RETURNING id`,
    [TWICE, ONCE, CURATOR],
  );
  [twiceId, onceId, curatorId] = users.rows.map(row => row.id);
  await place(WORSHIP, 'Places of worship');
  await place(SITE, 'Archaeology');
  const work = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, 'Pantheon dome', 'artwork') RETURNING id`,
    [WORK_QID],
  );
  for (const id of [WORSHIP, SITE]) {
    await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [id, work.rows[0].id]);
  }
  await pool.query(
    `INSERT INTO user_visited_experiences (user_id, experience_id, marked_at, notes, rating) VALUES
       ($1, $3, '2024-05-01', 'Mass on Sunday', 4),
       ($1, $4, '2019-08-10', 'The oculus at noon', 5),
       ($2, $4, '2022-03-03', NULL, NULL)`,
    [twiceId, onceId, WORSHIP, SITE],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const placesOf = async (ids: number[]) => (await pool.query<{ id: number; merged_into_id: number | null }>(
  'SELECT id, merged_into_id FROM experiences WHERE id = ANY($1) ORDER BY id', [ids],
)).rows;

describe('a merge of two rows that are one place (ADR-0086)', () => {
  it('folds the second into the first: memberships, one point, one work, and the visits reconciled', async () => {
    const outcome = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(outcome.refusal).toBeUndefined();

    expect(await placesOf([WORSHIP, SITE])).toEqual([
      { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: WORSHIP },
    ]);
    const kinds = await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM source_records WHERE experience_id = ANY($1)', [[WORSHIP, SITE]],
    );
    expect(kinds.rows.map(row => row.experience_id)).toEqual([WORSHIP, WORSHIP]);

    // One point on the ground stays one point, placed by both kinds.
    const points = await pool.query<{ experience_id: number; merged_into_id: number | null; placements: number }>(
      `SELECT el.experience_id, el.merged_into_id,
              (SELECT count(*)::int FROM experience_location_placements p WHERE p.location_id = el.id) AS placements
         FROM experience_locations el WHERE el.experience_id = ANY($1) ORDER BY el.id`,
      [[WORSHIP, SITE]],
    );
    expect(points.rows).toEqual([
      { experience_id: WORSHIP, merged_into_id: null, placements: 2 },
      { experience_id: SITE, merged_into_id: expect.any(Number), placements: 0 },
    ]);

    // The traveller who marked both: the earlier date, both notes, the later visit's rating.
    const twice = await pool.query(
      'SELECT marked_at::date::text AS day, notes, rating FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2',
      [twiceId, WORSHIP],
    );
    expect(twice.rows[0]).toEqual({ day: '2019-08-10', notes: 'Mass on Sunday\n\nThe oculus at noon', rating: 4 });
    // The one who marked only the folded row is marked on the place.
    const once = await pool.query('SELECT 1 FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2', [onceId, WORSHIP]);
    expect(once.rowCount).toBe(1);

    const log = await pool.query<{ curator_id: number | null; action: string }>(
      'SELECT curator_id, action FROM experience_curation_log WHERE experience_id = ANY($1)', [[WORSHIP, SITE]],
    );
    expect(log.rows).toEqual([
      { curator_id: null, action: 'merged' }, { curator_id: null, action: 'merged' },
    ]);
  });

  it('folds onto the survivor\'s standing point, never onto one its source withdrew at the same reference (#1360)', async () => {
    // A moved coordinate: the old point is withdrawn and keeps the lower id,
    // the new one stands beside it under the same reference.
    await pool.query('UPDATE experience_locations SET missing_since = NOW() WHERE experience_id = $1', [WORSHIP]);
    const moved = await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location)
       VALUES ($1, 'Pantheon', $2, ST_SetSRID(ST_MakePoint(12.4769, 41.8987), 4326)) RETURNING id`,
      [WORSHIP, QID],
    );

    await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });

    const folded = await pool.query<{ merged_into_id: number }>(
      'SELECT merged_into_id FROM experience_locations WHERE experience_id = $1', [SITE],
    );
    expect(folded.rows).toEqual([{ merged_into_id: moved.rows[0].id }]);
  });

  it('is undone exactly: both places as they were, with their own points and visits', async () => {
    const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });

    const undone = await undoMerge(merged.result!.mergeId, curatorId);

    expect(undone.refusal).toBeUndefined();
    expect(await placesOf([WORSHIP, SITE])).toEqual([
      { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: null },
    ]);
    const kinds = await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM source_records WHERE experience_id = ANY($1) ORDER BY experience_id',
      [[WORSHIP, SITE]],
    );
    expect(kinds.rows.map(row => row.experience_id)).toEqual([WORSHIP, SITE]);
    const placements = await pool.query<{ experience_id: number; placements: number }>(
      `SELECT el.experience_id, (SELECT count(*)::int FROM experience_location_placements p WHERE p.location_id = el.id) AS placements
         FROM experience_locations el WHERE el.experience_id = ANY($1) AND el.merged_into_id IS NULL ORDER BY el.experience_id`,
      [[WORSHIP, SITE]],
    );
    expect(placements.rows).toEqual([{ experience_id: WORSHIP, placements: 1 }, { experience_id: SITE, placements: 1 }]);
    const visits = await pool.query(
      `SELECT user_id, experience_id, marked_at::date::text AS day, notes, rating FROM user_visited_experiences
        WHERE experience_id = ANY($1) ORDER BY user_id, experience_id`,
      [[WORSHIP, SITE]],
    );
    expect(visits.rows).toEqual([
      { user_id: twiceId, experience_id: WORSHIP, day: '2024-05-01', notes: 'Mass on Sunday', rating: 4 },
      { user_id: twiceId, experience_id: SITE, day: '2019-08-10', notes: 'The oculus at noon', rating: 5 },
      { user_id: onceId, experience_id: SITE, day: '2022-03-03', notes: null, rating: null },
    ]);

    const again = await undoMerge(merged.result!.mergeId, curatorId);
    expect(again.refusal).toMatchObject({ status: 409 });
  });

  it("moves a curator's assignment of the folded place to a region, and moves it back", async () => {
    // A region the survivor is not in: the curator's word is the only thing
    // that lists the folded place there, and no point of the survivor repeats it.
    const region = await pool.query<{ id: number }>(
      `SELECT r.id FROM regions r
        WHERE NOT EXISTS (SELECT 1 FROM experience_regions er WHERE er.region_id = r.id AND er.experience_id = ANY($1))
        ORDER BY r.id LIMIT 1`,
      [[WORSHIP, SITE]],
    );
    expect(region.rows).toHaveLength(1);
    const regionId = region.rows[0].id;
    await pool.query(
      `INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by) VALUES ($1, $2, 'manual', $3)`,
      [SITE, regionId, curatorId],
    );
    const holder = async () => (await pool.query<{ experience_id: number }>(
      `SELECT experience_id FROM experience_regions WHERE region_id = $1 AND assignment_type = 'manual' AND experience_id = ANY($2)`,
      [regionId, [WORSHIP, SITE]],
    )).rows.map(row => row.experience_id);

    const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(await holder()).toEqual([WORSHIP]);

    await undoMerge(merged.result!.mergeId, curatorId);
    expect(await holder()).toEqual([SITE]);
  });

  describe("a curator's assignment where a point the merge moves places the survivor too", () => {
    // The folded place's second point, the Baths of Agrippa behind the
    // Pantheon, is placed by the run's own placement in a world view of the
    // fixture's: boxes around the two points under one root, not the rione's
    // boundary. The baths lie in Arco della Ciambella, the Pantheon in Piazza
    // della Rotonda, both in Pigna, so the placement every merge and undo runs
    // after it commits writes the same point rows the spec starts from.
    let manualId = 0;
    const rowsIn = async (regionId: number) => (await pool.query<{ id: number; experience_id: number; assignment_type: string }>(
      `SELECT id, experience_id, assignment_type FROM experience_regions
        WHERE region_id = $1 AND experience_id = ANY($2) ORDER BY experience_id`,
      [regionId, [WORSHIP, SITE]],
    )).rows;
    const placeBoth = () => assignRegionsForExperiences([WORSHIP, SITE], ROME);
    /** The curator's word on the folded place in a region, over the row its points gave it there. */
    const assignSite = async (regionId: number) => {
      const manual = await pool.query<{ id: number }>(
        `INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by, listing)
         VALUES ($1, $2, 'manual', $3, 'offered')
         ON CONFLICT (experience_id, region_id) DO UPDATE SET assignment_type = 'manual', assigned_by = $3, listing = 'offered'
         RETURNING id`,
        [SITE, regionId, curatorId],
      );
      manualId = manual.rows[0].id;
    };

    beforeEach(async () => {
      await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Merge fixture', false)`, [ROME]);
      await pool.query(
        `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
           ($1, $4, 'Pigna', NULL, false, NULL),
           ($2, $4, 'Arco della Ciambella', $1, true, ST_Multi(ST_MakeEnvelope(12.4743, 41.8972, 12.4756, 41.8982, 4326))),
           ($3, $4, 'Piazza della Rotonda', $1, true, ST_Multi(ST_MakeEnvelope(12.4762, 41.8980, 12.4775, 41.8992, 4326)))`,
        [PIGNA, CIAMBELLA, ROTONDA, ROME],
      );
      await pool.query(
        `INSERT INTO experience_locations (experience_id, name, external_ref, location)
         VALUES ($1, 'Baths of Agrippa', 'merge-fixture-baths', ST_SetSRID(ST_MakePoint(12.4749, 41.8977), 4326))`,
        [SITE],
      );
      await placeBoth();
    });

    it('moves the manual row, its id kept, over the automatic one the moved point gave, and moves it back', async () => {
      // The survivor has no point in Arco della Ciambella; the baths give it one.
      expect(await rowsIn(CIAMBELLA)).toEqual([{ id: expect.any(Number), experience_id: SITE, assignment_type: 'auto' }]);
      await assignSite(CIAMBELLA);

      // The merge re-places the survivor once it commits, and placing it again
      // keeps the curator's row where the baths' point gives an automatic one.
      const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
      expect(await rowsIn(CIAMBELLA)).toEqual([{ id: manualId, experience_id: WORSHIP, assignment_type: 'manual' }]);
      await placeBoth();
      expect(await rowsIn(CIAMBELLA)).toEqual([{ id: manualId, experience_id: WORSHIP, assignment_type: 'manual' }]);

      await undoMerge(merged.result!.mergeId, curatorId);
      expect(await rowsIn(CIAMBELLA)).toEqual([{ id: manualId, experience_id: SITE, assignment_type: 'manual' }]);
    });

    it('gives the survivor back its own automatic row once the undo takes the manual one away', async () => {
      // Both places are in Pigna by their own points before the merge.
      expect((await rowsIn(PIGNA)).map(row => [row.experience_id, row.assignment_type]))
        .toEqual([[WORSHIP, 'auto'], [SITE, 'auto']]);
      await assignSite(PIGNA);

      const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
      expect(await rowsIn(PIGNA)).toEqual([{ id: manualId, experience_id: WORSHIP, assignment_type: 'manual' }]);

      await undoMerge(merged.result!.mergeId, curatorId);
      expect(await rowsIn(PIGNA)).toEqual([
        { id: expect.any(Number), experience_id: WORSHIP, assignment_type: 'auto' },
        { id: manualId, experience_id: SITE, assignment_type: 'manual' },
      ]);
    });
  });

  it("carries a folded visit's trips to the survivor's visit, and the undo takes back exactly those (#2120)", async () => {
    const trip = (user: number, place: number, year: number, month: number | null = null) => pool.query(
      `INSERT INTO user_visit_trips (visit_id, year, month)
       SELECT id, $3, $4 FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2`,
      [user, place, year, month],
    );
    const tripsOf = async (user: number, place: number) => (await pool.query<{ year: number; month: number | null }>(
      `SELECT t.year, t.month FROM user_visit_trips t JOIN user_visited_experiences v ON v.id = t.visit_id
        WHERE v.user_id = $1 AND v.experience_id = $2 ORDER BY t.year, t.month`,
      [user, place],
    )).rows.map(row => [row.year, row.month]);
    // Twice was at the church in 2024 and at the site in August 2019; Once at the site in 2022.
    await trip(twiceId, WORSHIP, 2024);
    await trip(twiceId, SITE, 2019, 8);
    await trip(onceId, SITE, 2022);

    const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    expect(await tripsOf(twiceId, WORSHIP)).toEqual([[2019, 8], [2024, null]]);
    expect(await tripsOf(onceId, WORSHIP)).toEqual([[2022, null]]);

    // A trip Twice adds while the merge stands stays with the survivor.
    await trip(twiceId, WORSHIP, 2025);
    await undoMerge(merged.result!.mergeId, curatorId);
    expect(await tripsOf(twiceId, WORSHIP)).toEqual([[2024, null], [2025, null]]);
    expect(await tripsOf(onceId, WORSHIP)).toEqual([]);
    expect(await tripsOf(twiceId, SITE)).toEqual([[2019, 8]]);
    expect(await tripsOf(onceId, SITE)).toEqual([[2022, null]]);
  });

  it('refuses two places of one kind, and changes nothing', async () => {
    await pool.query(
      `UPDATE source_records SET kind_id = (SELECT kind_id FROM experience_sources WHERE name = 'Places of worship')
        WHERE experience_id = $1`,
      [SITE],
    );

    const outcome = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: curatorId, reason: 'curator' });

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect(await placesOf([WORSHIP, SITE])).toEqual([
      { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: null },
    ]);
  });

  it('joins the places claiming one Wikidata item into the one with the lower id', async () => {
    const report = await joinPlacesClaimingOneItem([QID]);

    expect(report.merged).toEqual([expect.objectContaining({ qid: QID, survivorId: WORSHIP, foldedId: SITE })]);
    expect(report.refused).toEqual([]);
    expect((await placesOf([SITE]))[0].merged_into_id).toBe(WORSHIP);
  });

  it('never joins again a pair a curator took apart: the undone join is their word', async () => {
    const first = await joinPlacesClaimingOneItem([QID]);
    expect(first.merged).toHaveLength(1);
    expect((await undoMerge(first.merged[0].mergeId, curatorId)).refusal).toBeUndefined();

    const again = await joinPlacesClaimingOneItem([QID]);

    expect(again).toEqual({ merged: [], refused: [] });
    expect((await placesOf([SITE]))[0].merged_into_id).toBeNull();
  });

  it('keeps a visit a traveller wrote to after the merge when it is undone', async () => {
    const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    await pool.query(
      `UPDATE user_visited_experiences SET notes = 'Went back for the dome at dusk' WHERE user_id = $1 AND experience_id = $2`,
      [onceId, WORSHIP],
    );

    await undoMerge(merged.result!.mergeId, curatorId);

    const kept = await pool.query('SELECT notes FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2', [onceId, WORSHIP]);
    expect(kept.rows).toEqual([{ notes: 'Went back for the dome at dusk' }]);
  });

  it("answers the folded place's address with the surviving place's card, down a chain of merges", async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699001', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    const read = (id: number) => getExperience({ params: { id }, caller: undefined });

    await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    expect((await read(SITE)).id).toBe(WORSHIP);

    await mergePlaces({ survivorId: MUSEUM, foldedId: WORSHIP, mergedBy: curatorId, reason: 'curator' });
    expect((await read(SITE)).id).toBe(MUSEUM);
    expect((await read(WORSHIP)).id).toBe(MUSEUM);
  });

  it('refuses to undo a merge whose survivor has since been merged into another place', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699001', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    const first = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    const second = await mergePlaces({ survivorId: MUSEUM, foldedId: WORSHIP, mergedBy: curatorId, reason: 'curator' });
    expect(second.refusal).toBeUndefined();

    const undone = await undoMerge(first.result!.mergeId, curatorId);

    expect(undone.refusal).toMatchObject({ status: 409 });
    expect((await placesOf([SITE]))[0].merged_into_id).toBe(WORSHIP);
  });

  it("reads the decisions made about every entry folded into the place, down a chain, while the merges stand (#1366)", async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699001', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    // The archaeological site's admission was pinned before any merge.
    await pool.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, details)
       VALUES ($1, $2, 'admission_overridden', '{"reason": "an ancient temple"}')`,
      [SITE, curatorId],
    );
    const first = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    const second = await mergePlaces({ survivorId: MUSEUM, foldedId: WORSHIP, mergedBy: curatorId, reason: 'curator' });
    const history = () => getCurationLog({ params: { id: MUSEUM }, caller: { id: curatorId, role: 'admin' } as Express.User });

    const log = await history();
    expect(log.find(entry => entry.action === 'admission_overridden')).toMatchObject({
      folded_id: SITE, folded_name: 'Pantheon (merge fixture)', details: { reason: 'an ancient temple' },
    });
    // Each merge once: the museum's own, and the place of worship's fold of the
    // site — never a folded entry's copy of the merge that folded it.
    expect(log.filter(entry => entry.action === 'merged').map(entry => [entry.folded_id, entry.details?.mergeId]))
      .toEqual(expect.arrayContaining([[null, second.result!.mergeId], [WORSHIP, first.result!.mergeId]]));
    expect(log.filter(entry => entry.action === 'merged')).toHaveLength(2);

    expect((await undoMerge(second.result!.mergeId, curatorId)).refusal).toBeUndefined();
    expect((await history()).filter(entry => entry.folded_id !== null)).toEqual([]);
  });

  it("keeps a folded entry's earlier merge into another place, since undone, in the history (#1366)", async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699001', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    // The site went into the museum first, by mistake, and came back out.
    const wrong = await mergePlaces({ survivorId: MUSEUM, foldedId: SITE, mergedBy: curatorId, reason: 'curator' });
    expect((await undoMerge(wrong.result!.mergeId, curatorId)).refusal).toBeUndefined();
    const right = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });

    const log = await getCurationLog({ params: { id: WORSHIP }, caller: { id: curatorId, role: 'admin' } as Express.User });
    const merges = log.filter(entry => entry.action === 'merged' || entry.action === 'merge_undone')
      .map(entry => [entry.action, entry.folded_id, entry.details?.mergeId]);
    expect(merges).toHaveLength(3);
    expect(merges).toEqual(expect.arrayContaining([
      ['merged', null, right.result!.mergeId],
      ['merged', SITE, wrong.result!.mergeId],
      ['merge_undone', SITE, wrong.result!.mergeId],
    ]));
  });

  it('undoes two merges into one place last first', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699001', 'Pantheon (merge fixture monument)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Public art'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Public art'`,
      [MUSEUM],
    );
    // Both fold into the place of worship, the monument second.
    const first = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    const second = await mergePlaces({ survivorId: WORSHIP, foldedId: MUSEUM, mergedBy: curatorId, reason: 'curator' });

    expect((await undoMerge(first.result!.mergeId, curatorId)).refusal).toMatchObject({ status: 409 });
    expect((await undoMerge(second.result!.mergeId, curatorId)).refusal).toBeUndefined();
    expect((await undoMerge(first.result!.mergeId, curatorId)).refusal).toBeUndefined();
    expect(await placesOf([MUSEUM, WORSHIP, SITE])).toEqual([
      { id: MUSEUM, merged_into_id: null }, { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: null },
    ]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { mergePlaces, undoMerge } from './placeMerge.js';
import { mergeEqualItems } from './equalItemMerges.js';
import { getExperience } from './experienceQueryController.js';

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
const QID = 'Q99309';
const WORK_QID = 'Q9700-merge-fixture-work';
const TWICE = '00000000-0000-4000-8000-000000009700';
const ONCE = '00000000-0000-4000-8000-000000009701';
const CURATOR = '00000000-0000-4000-8000-000000009702';

let twiceId = 0;
let onceId = 0;
let curatorId = 0;

async function clear(): Promise<void> {
  const places = [MUSEUM, WORSHIP, SITE];
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [places]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [places]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK_QID]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[TWICE, ONCE, CURATOR]]);
}

async function place(id: number, source: string, visitedPoint: boolean): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Pantheon (merge fixture)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
       FROM experience_sources s WHERE s.name = $3`,
    [id, QID, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
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
  if (visitedPoint) {
    await pool.query('INSERT INTO user_visited_locations (user_id, location_id) VALUES ($1, $2)', [onceId, point.rows[0].id]);
  }
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
  await place(WORSHIP, 'Places of worship', false);
  await place(SITE, 'Archaeology', true);
  const work = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, 'Pantheon dome', 'artwork') RETURNING id`,
    [WORK_QID],
  );
  for (const id of [WORSHIP, SITE]) {
    await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [id, work.rows[0].id]);
  }
  await pool.query(
    `INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes, rating) VALUES
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
      'SELECT experience_id FROM experience_kind_memberships WHERE experience_id = ANY($1)', [[WORSHIP, SITE]],
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
      'SELECT visited_at::date::text AS day, notes, rating FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2',
      [twiceId, WORSHIP],
    );
    expect(twice.rows[0]).toEqual({ day: '2019-08-10', notes: 'Mass on Sunday\n\nThe oculus at noon', rating: 4 });
    // The one who marked only the folded row is marked on the place, and on its point.
    const once = await pool.query('SELECT 1 FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2', [onceId, WORSHIP]);
    expect(once.rowCount).toBe(1);
    const point = await pool.query(
      `SELECT 1 FROM user_visited_locations v JOIN experience_locations el ON el.id = v.location_id
        WHERE v.user_id = $1 AND el.experience_id = $2 AND el.merged_into_id IS NULL`,
      [onceId, WORSHIP],
    );
    expect(point.rowCount).toBe(1);

    const log = await pool.query<{ curator_id: number | null; action: string }>(
      'SELECT curator_id, action FROM experience_curation_log WHERE experience_id = ANY($1)', [[WORSHIP, SITE]],
    );
    expect(log.rows).toEqual([
      { curator_id: null, action: 'merged' }, { curator_id: null, action: 'merged' },
    ]);
  });

  it('is undone exactly: both places as they were, with their own points and visits', async () => {
    const merged = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });

    const undone = await undoMerge(merged.result!.mergeId, curatorId);

    expect(undone.refusal).toBeUndefined();
    expect(await placesOf([WORSHIP, SITE])).toEqual([
      { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: null },
    ]);
    const kinds = await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM experience_kind_memberships WHERE experience_id = ANY($1) ORDER BY experience_id',
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
      `SELECT user_id, experience_id, visited_at::date::text AS day, notes, rating FROM user_visited_experiences
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

  it('refuses two places of one kind, and changes nothing', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET kind_id = (SELECT kind_id FROM experience_sources WHERE name = 'Places of worship')
        WHERE experience_id = $1`,
      [SITE],
    );

    const outcome = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: curatorId, reason: 'curator' });

    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect(await placesOf([WORSHIP, SITE])).toEqual([
      { id: WORSHIP, merged_into_id: null }, { id: SITE, merged_into_id: null },
    ]);
  });

  it('merges the places sharing a Wikidata item into the one with the lower id', async () => {
    const report = await mergeEqualItems([QID]);

    expect(report.merged).toEqual([expect.objectContaining({ qid: QID, survivorId: WORSHIP, foldedId: SITE })]);
    expect(report.refused).toEqual([]);
    expect((await placesOf([SITE]))[0].merged_into_id).toBe(WORSHIP);
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
       SELECT $1, s.id, 'Q9699-merge-fixture', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699-merge-fixture', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
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
       SELECT $1, s.id, 'Q9699-merge-fixture', 'Pantheon (merge fixture museum)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699-merge-fixture', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [MUSEUM],
    );
    const first = await mergePlaces({ survivorId: WORSHIP, foldedId: SITE, mergedBy: null, reason: 'equal_wikidata_item' });
    const second = await mergePlaces({ survivorId: MUSEUM, foldedId: WORSHIP, mergedBy: curatorId, reason: 'curator' });
    expect(second.refusal).toBeUndefined();

    const undone = await undoMerge(first.result!.mergeId, curatorId);

    expect(undone.refusal).toMatchObject({ status: 409 });
    expect((await placesOf([SITE]))[0].merged_into_id).toBe(WORSHIP);
  });

  it('undoes two merges into one place last first', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9699-merge-fixture', 'Pantheon (merge fixture monument)', ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
         FROM experience_sources s WHERE s.name = 'Public Art & Monuments'`,
      [MUSEUM],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9699-merge-fixture', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Public Art & Monuments'`,
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

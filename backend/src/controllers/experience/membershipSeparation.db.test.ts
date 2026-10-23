import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { separateMembership } from './membershipSeparation.js';
import { mergeEqualItems } from './equalItemMerges.js';
import { mergePlaces, undoMerge } from './placeMerge.js';

/**
 * A curator separating one kind's membership of a place into a place of its
 * own (ADR-0142, #1885), executed against PostgreSQL.
 *
 * The fixture is the Pantheon as one place of Places of worship and
 * Archaeology on one Wikidata item (Q99309). The two memberships both place
 * one point and one work; Archaeology alone places a second point, the
 * portico's. One traveller marked the place visited. Ids are the fixture's
 * own, deleted before and after.
 */

const PANTHEON = 9710;
/** A place another source brought on the same item, for a merge and for a pass after the separation. */
const OTHER = 9712;
const QID = 'Q99309';
const WORK_QID = 'Q9710-separation-fixture-work';
const TRAVELLER = '00000000-0000-4000-8000-000000009710';
const CURATOR = '00000000-0000-4000-8000-000000009711';
const NAME = 'Pantheon (separation fixture)';

let travellerId = 0;
let curatorId = 0;
let worshipMembership = 0;
let siteMembership = 0;

async function clear(): Promise<void> {
  const places = (await pool.query<{ id: number }>('SELECT id FROM experiences WHERE name = $1', [NAME])).rows.map(row => row.id);
  await pool.query('DELETE FROM experience_separations WHERE original_id = ANY($1) OR separated_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [places]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [places]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [places]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK_QID]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[TRAVELLER, CURATOR]]);
}

const membershipOf = async (source: string): Promise<number> => (await pool.query<{ id: number }>(
  `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at,
                                            reported_name)
   SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), $4 FROM experience_sources s WHERE s.name = $3 RETURNING id`,
  [PANTHEON, QID, source, NAME],
)).rows[0].id;

const pointPlacedBy = async (name: string, lon: number, memberships: number[]): Promise<number> => {
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, 41.8986), 4326)) RETURNING id`,
    [PANTHEON, name, QID, lon],
  );
  for (const membership of memberships) {
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [point.rows[0].id, membership]);
  }
  return point.rows[0].id;
};

beforeEach(async () => {
  await clear();
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user'), ($2, 'A curator', 'curator') RETURNING id`,
    [TRAVELLER, CURATOR],
  );
  [travellerId, curatorId] = users.rows.map(row => row.id);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)
       FROM experience_sources s WHERE s.name = 'Places of worship'`,
    [PANTHEON, QID, NAME],
  );
  worshipMembership = await membershipOf('Places of worship');
  siteMembership = await membershipOf('Archaeology');
  await pointPlacedBy('Pantheon', 12.4768, [worshipMembership, siteMembership]);
  await pointPlacedBy('Portico', 12.4767, [siteMembership]);
  const work = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, 'Pantheon dome', 'artwork') RETURNING id`, [WORK_QID],
  );
  const link = await pool.query<{ id: number }>(
    'INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2) RETURNING id', [PANTHEON, work.rows[0].id],
  );
  for (const membership of [worshipMembership, siteMembership]) {
    await pool.query('INSERT INTO experience_treasure_placements (link_id, membership_id) VALUES ($1, $2)', [link.rows[0].id, membership]);
  }
  await pool.query(
    `INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes) VALUES ($1, $2, '2019-08-10', 'The oculus at noon')`,
    [travellerId, PANTHEON],
  );
});

/** A place of `source` on the same item, with a point it places. */
async function otherPlace(source: string): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326) FROM experience_sources s WHERE s.name = $4`,
    [OTHER, QID, NAME, source],
  );
  const membership = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [OTHER, QID, source],
  )).rows[0].id;
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Pantheon', $2, ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326)) RETURNING id`,
    [OTHER, QID],
  );
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [point.rows[0].id, membership]);
  return membership;
}

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a separation of one kind into a place of its own (ADR-0142)', () => {
  it('takes the membership, what it alone places, and a copy of what both place; the visit stays and its traveller is asked', async () => {
    const outcome = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    expect(outcome.refusal).toBeUndefined();
    const { separatedId } = outcome.result!;

    const kinds = await pool.query<{ id: number; experience_id: number }>(
      'SELECT id, experience_id FROM experience_kind_memberships WHERE id = ANY($1) ORDER BY id', [[worshipMembership, siteMembership]],
    );
    expect(kinds.rows).toEqual([{ id: worshipMembership, experience_id: PANTHEON }, { id: siteMembership, experience_id: separatedId }]);

    const points = await pool.query<{ experience_id: number; name: string; placed_by: number[] }>(
      `SELECT l.experience_id, l.name, array_agg(p.membership_id ORDER BY p.membership_id) AS placed_by
         FROM experience_locations l JOIN experience_location_placements p ON p.location_id = l.id
        WHERE l.experience_id = ANY($1) GROUP BY l.id ORDER BY l.experience_id = $2 DESC, l.name`,
      [[PANTHEON, separatedId], PANTHEON],
    );
    expect(points.rows).toEqual([
      { experience_id: PANTHEON, name: 'Pantheon', placed_by: [worshipMembership] },
      { experience_id: separatedId, name: 'Pantheon', placed_by: [siteMembership] },
      { experience_id: separatedId, name: 'Portico', placed_by: [siteMembership] },
    ]);

    const links = await pool.query<{ experience_id: number; placed_by: number[] }>(
      `SELECT t.experience_id, array_agg(p.membership_id) AS placed_by
         FROM experience_treasures t JOIN experience_treasure_placements p ON p.link_id = t.id
        WHERE t.experience_id = ANY($1) GROUP BY t.id ORDER BY t.experience_id = $2 DESC`,
      [[PANTHEON, separatedId], PANTHEON],
    );
    expect(links.rows).toEqual([
      { experience_id: PANTHEON, placed_by: [worshipMembership] },
      { experience_id: separatedId, placed_by: [siteMembership] },
    ]);

    const visits = await pool.query('SELECT experience_id FROM user_visited_experiences WHERE user_id = $1', [travellerId]);
    expect(visits.rows).toEqual([{ experience_id: PANTHEON }]);
    const asked = await pool.query('SELECT user_id, answer FROM separated_visit_questions WHERE separation_id = $1', [outcome.result!.separationId]);
    expect(asked.rows).toEqual([{ user_id: travellerId, answer: null }]);

    const log = await pool.query<{ experience_id: number }>(
      "SELECT experience_id FROM experience_curation_log WHERE action = 'separated' AND curator_id = $1",
      [curatorId],
    );
    expect(log.rows.map(row => row.experience_id).sort()).toEqual([PANTHEON, separatedId].sort());
  });

  it('leaves the two apart when the equal-item pass runs again', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const report = await mergeEqualItems([QID]);
    expect(report.merged).toEqual([]);
    const places = await pool.query('SELECT merged_into_id FROM experiences WHERE id = ANY($1)', [[PANTHEON, result!.separatedId]]);
    expect(places.rows).toEqual([{ merged_into_id: null }, { merged_into_id: null }]);
  });

  it('joins a third source on the item to the original, never to the separated place', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    await otherPlace('Art Museums');
    const report = await mergeEqualItems([QID]);
    expect(report.merged).toHaveLength(1);
    expect([report.merged[0].survivorId, report.merged[0].foldedId].sort()).toEqual([PANTHEON, OTHER].sort());
    const separated = await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [result!.separatedId]);
    expect(separated.rows).toEqual([{ merged_into_id: null }]);
  });

  it('refuses the kind that brought the place, which every reader names it by', async () => {
    const outcome = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect(outcome.refusal).toMatchObject({ status: 409 });
    const left = await pool.query('SELECT experience_id FROM experience_kind_memberships WHERE id = $1', [worshipMembership]);
    expect(left.rows).toEqual([{ experience_id: PANTHEON }]);
  });

  it('refuses to undo a merge whose kind was separated since, which would strand the folded place', async () => {
    const brought = await otherPlace('Art Museums');
    const merge = await mergePlaces({ survivorId: PANTHEON, foldedId: OTHER, mergedBy: curatorId, reason: 'curator' });
    expect(merge.refusal).toBeUndefined();
    const separation = await separateMembership({ placeId: PANTHEON, membershipId: brought, separatedBy: curatorId });
    expect(separation.refusal).toBeUndefined();
    const undo = await undoMerge(merge.result!.mergeId, curatorId);
    expect(undo.refusal).toMatchObject({ status: 409 });
    const folded = await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [OTHER]);
    expect(folded.rows).toEqual([{ merged_into_id: PANTHEON }]);
  });

  it('refuses the place\'s only kind, and changes nothing', async () => {
    await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const outcome = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect(outcome.refusal).toMatchObject({ status: 409 });
    const left = await pool.query('SELECT experience_id FROM experience_kind_memberships WHERE id = $1', [worshipMembership]);
    expect(left.rows).toEqual([{ experience_id: PANTHEON }]);
  });
});

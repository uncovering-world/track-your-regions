import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockIdentifiedPlace, lockSourcedExperience } from '../../db/experienceWriter.js';
import { separateMembership, undoSeparation } from './membershipSeparation.js';
import { joinPlacesClaimingOneItem } from './equalItemMerges.js';
import { mergePlaces, undoMerge } from './placeMerge.js';

/**
 * A curator separating one kind's membership of a place into a place of its
 * own (ADR-0144, #1885), executed against PostgreSQL.
 *
 * The fixture is the Pantheon as one place of Places of worship and
 * Archaeology on one Wikidata item (Q99309). The two memberships both place
 * one point and one work; Archaeology alone places a second point, the
 * portico's. One traveller marked the place visited. Ids are the fixture's
 * own, deleted before and after.
 */

const PANTHEON = 9710;
/** A place another source brought on the same item, for a merge and for a join after the separation. */
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
let worshipSource = 0;
let archaeologySource = 0;

async function clear(): Promise<void> {
  const places = (await pool.query<{ id: number }>('SELECT id FROM experiences WHERE name = $1', [NAME])).rows.map(row => row.id);
  await pool.query('DELETE FROM experience_separations WHERE original_id = ANY($1) OR separated_id = ANY($1)', [places]);
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [places]);
  await pool.query('DELETE FROM place_identifier_verdicts WHERE experience_id = ANY($1)', [places]);
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
  const sources = (await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM experience_sources WHERE name = ANY($1::text[])`, [['Places of worship', 'Archaeology']],
  )).rows;
  worshipSource = sources.find(s => s.name === 'Places of worship')!.id;
  archaeologySource = sources.find(s => s.name === 'Archaeology')!.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(12.4768, 41.8986), 4326))`,
    [PANTHEON, worshipSource, QID, NAME],
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

/** How a registry row holds its value: identifying, referring (claimed), or mentioned (carried, not claimed). */
function holding(row: { identifies: boolean; claims_identity: boolean }): string {
  if (row.identifies) return 'identifies';
  return row.claims_identity ? 'refers' : 'mentions';
}

/** What the registry holds of the item on each place, in the order the ids are given; a place with no row is left out. */
const held = async (...ids: number[]) => {
  const rows = (await pool.query<{ experience_id: number; identifies: boolean; claims_identity: boolean }>(
    `SELECT experience_id, identifies, claims_identity FROM place_identifiers
      WHERE scheme = 'wikidata' AND value = $1 AND experience_id = ANY($2::int[])`, [QID, ids],
  )).rows;
  return ids.flatMap(id => rows.filter(row => row.experience_id === id).map(row => `${id}:${holding(row)}`));
};

const pairOf = async (id: number) => (await pool.query<{ source_id: number; external_id: string }>(
  'SELECT source_id, external_id FROM experiences WHERE id = $1', [id],
)).rows[0];

describe('a separation of one kind into a place of its own (ADR-0144)', () => {
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

    // The new place is keyed by the membership's own pair; the original keeps its own.
    expect(await pairOf(separatedId)).toEqual({ source_id: archaeologySource, external_id: QID });
    expect(await pairOf(PANTHEON)).toEqual({ source_id: worshipSource, external_id: QID });
    const log = await pool.query<{ experience_id: number; details: Record<string, unknown> }>(
      "SELECT experience_id, details FROM experience_curation_log WHERE action = 'separated' AND curator_id = $1",
      [curatorId],
    );

    expect(log.rows.map(row => row.experience_id).sort()).toEqual([PANTHEON, separatedId].sort());
    expect(log.rows[0].details).toMatchObject({ kind: 'Archaeology', identifier: `wikidata:${QID}`, verdictWritten: true });
  });

  it('writes the curator\'s word on the original, so the item identifies the new place and the join leaves the two apart', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const separatedId = result!.separatedId;

    // Both memberships carried the item: the original still claimed it, and
    // the separation said it only refers to the original (ADR-0144 decision 4).
    expect(await held(PANTHEON, separatedId)).toEqual([`${PANTHEON}:mentions`, `${separatedId}:identifies`]);
    const verdict = await pool.query('SELECT verdict, curator_id FROM place_identifier_verdicts WHERE experience_id = $1 AND value = $2', [PANTHEON, QID]);
    expect(verdict.rows).toEqual([{ verdict: 'refers', curator_id: curatorId }]);
    const recorded = await pool.query('SELECT scheme, value, verdict_written FROM experience_separations WHERE id = $1', [result!.separationId]);
    expect(recorded.rows).toEqual([{ scheme: 'wikidata', value: QID, verdict_written: true }]);

    const report = await joinPlacesClaimingOneItem([QID]);
    expect(report).toEqual({ merged: [], refused: [] });
  });

  it('is where the item\'s runs find the place afterwards: the separated source by its membership, another source by the item', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const separatedId = result!.separatedId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect((await lockSourcedExperience(client, archaeologySource, QID))?.id).toBe(separatedId);
      const museums = (await client.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Art Museums'`)).rows[0].id;
      expect((await lockIdentifiedPlace(client, museums, [QID]))?.id).toBe(separatedId);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('joins a third source on the item to the new place, never to the original', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    await otherPlace('Art Museums');
    const report = await joinPlacesClaimingOneItem([QID]);
    expect(report.merged).toHaveLength(1);
    expect([report.merged[0].survivorId, report.merged[0].foldedId].sort()).toEqual([OTHER, result!.separatedId].sort());
    const original = await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [PANTHEON]);
    expect(original.rows).toEqual([{ merged_into_id: null }]);
  });

  it('separates the kind that brought the place too: the original keeps its pair, the new place is named by the separation', async () => {
    const outcome = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect(outcome.refusal).toBeUndefined();
    expect(await pairOf(PANTHEON)).toEqual({ source_id: worshipSource, external_id: QID });
    expect(await pairOf(outcome.result!.separatedId)).toEqual({
      source_id: worshipSource, external_id: `separated-${outcome.result!.separatedId}`,
    });
    // The pair the original keeps is carried by a live membership on the new
    // place, where its run finds it: not a mis-keyed place.
    const { objectAssertions } = await import('../admin/dataAssertions/objectAssertions.js');
    const check = objectAssertions.find(a => a.id === 'membership-source-disagrees-with-row')!;
    const flagged = await pool.query<{ experience_id: number }>(check.sql);
    expect(flagged.rows.map(row => row.experience_id)).not.toContain(PANTHEON);
    expect(flagged.rows.map(row => row.experience_id)).not.toContain(outcome.result!.separatedId);
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
    // The folded place still holds the membership's pair, so the new place is named by the separation.
    const museums = (await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Art Museums'`)).rows[0].id;
    expect(await pairOf(separation.result!.separatedId)).toEqual({
      source_id: museums, external_id: `separated-${separation.result!.separatedId}`,
    });
  });

  it('separates the same kind again after an undo: the folded place keeps its name, the new one has its own', async () => {
    const first = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect((await undoSeparation(first.result!.separationId, curatorId)).refusal).toBeUndefined();
    const again = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect(again.refusal).toBeUndefined();
    expect(again.result!.separatedId).not.toBe(first.result!.separatedId);
    expect(await pairOf(again.result!.separatedId)).toEqual({
      source_id: worshipSource, external_id: `separated-${again.result!.separatedId}`,
    });
    expect(await held(PANTHEON, again.result!.separatedId)).toEqual([`${PANTHEON}:mentions`, `${again.result!.separatedId}:identifies`]);
  });

  it('refuses the place\'s only kind, and changes nothing', async () => {
    await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const outcome = await separateMembership({ placeId: PANTHEON, membershipId: worshipMembership, separatedBy: curatorId });
    expect(outcome.refusal).toMatchObject({ status: 409 });
    const left = await pool.query('SELECT experience_id FROM experience_kind_memberships WHERE id = $1', [worshipMembership]);
    expect(left.rows).toEqual([{ experience_id: PANTHEON }]);
  });

  it('is undone by merging the two again: the word taken back, the questions withdrawn, and that merge undoable', async () => {
    const { result } = await separateMembership({ placeId: PANTHEON, membershipId: siteMembership, separatedBy: curatorId });
    const undone = await undoSeparation(result!.separationId, curatorId);
    expect(undone.refusal).toBeUndefined();

    const separated = await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [result!.separatedId]);
    expect(separated.rows).toEqual([{ merged_into_id: PANTHEON }]);
    expect(await held(PANTHEON)).toEqual([`${PANTHEON}:identifies`]);
    const questions = await pool.query('SELECT count(*)::int AS n FROM separated_visit_questions WHERE separation_id = $1', [result!.separationId]);
    expect(questions.rows).toEqual([{ n: 0 }]);
    const row = await pool.query('SELECT undone_by, merge_id FROM experience_separations WHERE id = $1', [result!.separationId]);
    expect(row.rows).toEqual([{ undone_by: curatorId, merge_id: undone.result!.mergeId }]);
    expect((await undoSeparation(result!.separationId, curatorId)).refusal).toMatchObject({ status: 409 });

    // The undo of the undo separates them again, and keeps them apart: the
    // word is written again, the separation stands again, the question is
    // asked again, and the join leaves the two alone.
    expect((await undoMerge(undone.result!.mergeId, curatorId)).refusal).toBeUndefined();
    const apart = await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [result!.separatedId]);
    expect(apart.rows).toEqual([{ merged_into_id: null }]);
    expect(await held(PANTHEON, result!.separatedId)).toEqual([`${PANTHEON}:mentions`, `${result!.separatedId}:identifies`]);
    const standing = await pool.query('SELECT undone_at, merge_id FROM experience_separations WHERE id = $1', [result!.separationId]);
    expect(standing.rows).toEqual([{ undone_at: null, merge_id: null }]);
    const askedAgain = await pool.query('SELECT count(*)::int AS n FROM separated_visit_questions WHERE separation_id = $1', [result!.separationId]);
    expect(askedAgain.rows).toEqual([{ n: 1 }]);
    expect(await joinPlacesClaimingOneItem([QID])).toEqual({ merged: [], refused: [] });
  });
});

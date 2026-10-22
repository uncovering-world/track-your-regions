import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerMergeProposalsOneByOne, mergeProposalSourceIds, openPairs } from './mergeProposalController.js';
import { undoMerge } from './placeMerge.js';

/** The sources of the fixture's places: World Heritage, Public art, Places of worship. */
const ALL_SOURCES = [1, 3, 4];

/**
 * A curator's answers to pairs of near places with similar names (#1249,
 * ADR-0046 decisions 2 to 4), executed against PostgreSQL.
 *
 * The fixture is Durham as the pass proposes it: the World Heritage row
 * "Durham Castle and Cathedral" (the lower id) with the cathedral as a place
 * of worship 139 m off, and a public-art row of the same name 20 m off, an
 * exact pair; and a second pair the merge refuses, two churches in one kind.
 * Ids are the fixture's own, deleted before and after.
 */

const SITE = 9740;
const CATHEDRAL = 9741;
const PLAQUE = 9742;
const CHAPEL_A = 9743;
const CHAPEL_B = 9744;
const PLACES = [SITE, CATHEDRAL, PLAQUE, CHAPEL_A, CHAPEL_B];
const CURATOR = '00000000-0000-4000-8000-000000009740';
let curatorId = 0;
const PAIRS = { cathedral: 0, plaque: 0, chapels: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merge_proposals WHERE place_a = ANY($1) OR place_b = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_regions WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function place(id: number, name: string, source: string, lon: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, 54.7745), 4326) FROM experience_sources s WHERE s.name = $5`,
    [id, `fixture-${id}`, name, lon, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, `fixture-${id}`, source],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, 54.7745), 4326), 'auto') RETURNING id`,
    [id, name, `fixture-${id}`, lon],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point.rows[0].id, membership.rows[0].id],
  );
}

async function propose(a: number, b: number, distance: number, similarity: number, exact: boolean): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO experience_merge_proposals (place_a, place_b, distance_m, name_similarity, exact, reach_m)
     VALUES ($1, $2, $3, $4, $5, 300) RETURNING id`,
    [a, b, distance, similarity, exact],
  );
  return result.rows[0].id;
}

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  );
  curatorId = user.rows[0].id;
  await place(SITE, 'Durham Castle and Cathedral', 'UNESCO World Heritage Sites', -1.5760);
  await place(CATHEDRAL, 'Durham Cathedral', 'Places of worship', -1.5755);
  await place(PLAQUE, 'Durham Castle and Cathedral', 'Public art', -1.5758);
  await place(CHAPEL_A, 'Fixture Chapel', 'Places of worship', -1.5700);
  await place(CHAPEL_B, 'Fixture Chapel', 'Places of worship', -1.5699);
  PAIRS.cathedral = await propose(SITE, CATHEDRAL, 139, 0.65, false);
  PAIRS.plaque = await propose(SITE, PLAQUE, 20, 1, true);
  // Two churches in one kind: the pass leaves such a pair apart, but a row of
  // it is what the merge's refusal is tested through.
  PAIRS.chapels = await propose(CHAPEL_A, CHAPEL_B, 10, 1, true);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const proposal = async (id: number) => (await pool.query<{ answer: string | null; part_id: number | null; merge_id: number | null }>(
  'SELECT answer, part_id, merge_id FROM experience_merge_proposals WHERE id = $1', [id],
)).rows[0];
const logged = async (placeId: number) => (await pool.query<{ action: string; details: Record<string, unknown> }>(
  'SELECT action, details FROM experience_curation_log WHERE experience_id = $1 ORDER BY id', [placeId],
)).rows;

describe("a curator's answers to pairs of near places", () => {
  it('lists the open pairs of a place, the exact ones alone for a batch accept, and scopes them by either place', async () => {
    expect(await openPairs(SITE, 'all')).toEqual([PAIRS.cathedral, PAIRS.plaque]);
    expect(await openPairs(SITE, 'exact')).toEqual([PAIRS.plaque]);
    expect(await openPairs(CATHEDRAL, 'all')).toEqual([]);
    const sources = await mergeProposalSourceIds(SITE);
    expect(sources?.sort()).toEqual([1, 3, 4]);
  });

  it('keeps a pair as two places and records which is the part, each with its log row, and never asks again', async () => {
    const outcome = await answerMergeProposalsOneByOne(SITE, curatorId, null, [
      { proposalId: PAIRS.plaque, answer: 'two' },
      { proposalId: PAIRS.cathedral, answer: 'part_of', partId: CATHEDRAL },
    ], ALL_SOURCES);
    expect(outcome).toEqual({ experienceId: SITE, merged: [], two: 1, partOf: 1, refused: [] });
    expect(await proposal(PAIRS.plaque)).toEqual({ answer: 'two', part_id: null, merge_id: null });
    expect(await proposal(PAIRS.cathedral)).toEqual({ answer: 'part_of', part_id: CATHEDRAL, merge_id: null });
    const rows = await logged(SITE);
    expect(rows.map(row => [row.action, row.details.answer, row.details.otherId])).toEqual([
      ['merge_proposal_answered', 'two', PLAQUE],
      ['merge_proposal_answered', 'part_of', CATHEDRAL],
    ]);
    expect(rows[1].details.partId).toBe(CATHEDRAL);
    expect(await openPairs(SITE, 'all')).toEqual([]);
    // Nothing merged: both places stand as they were.
    const merged = await pool.query('SELECT id FROM experiences WHERE id = ANY($1) AND merged_into_id IS NOT NULL', [PLACES]);
    expect(merged.rows).toEqual([]);
  });

  it('makes one place of a pair through the merge, records the merge on the answer, and refuses a pair the merge refuses', async () => {
    const outcome = await answerMergeProposalsOneByOne(SITE, curatorId, null, [{ proposalId: PAIRS.plaque, answer: 'one' }], ALL_SOURCES);
    expect(outcome.merged).toHaveLength(1);
    expect(outcome.refused).toEqual([]);
    const { mergeId } = outcome.merged[0];
    expect(await proposal(PAIRS.plaque)).toEqual({ answer: 'one', part_id: null, merge_id: mergeId });
    const folded = await pool.query<{ merged_into_id: number | null }>('SELECT merged_into_id FROM experiences WHERE id = $1', [PLAQUE]);
    expect(folded.rows[0].merged_into_id).toBe(SITE);
    const merge = await pool.query<{ reason: string; merged_by: number; survivor_id: number }>(
      'SELECT reason, merged_by, survivor_id FROM experience_merges WHERE id = $1', [mergeId],
    );
    expect(merge.rows[0]).toEqual({ reason: 'curator', merged_by: curatorId, survivor_id: SITE });
    // The merge's own row first, then the answer that ran it.
    expect((await logged(SITE)).map(row => row.action)).toEqual(['merged', 'merge_proposal_answered']);

    const chapels = await answerMergeProposalsOneByOne(CHAPEL_A, curatorId, null, [{ proposalId: PAIRS.chapels, answer: 'one' }], ALL_SOURCES);
    expect(chapels.merged).toEqual([]);
    expect(chapels.refused).toEqual([{ proposalId: PAIRS.chapels, error: 'Both places belong to the same kind, which one place cannot hold twice' }]);
    expect(await proposal(PAIRS.chapels)).toEqual({ answer: null, part_id: null, merge_id: null });
  });

  it("refuses a pair that is not this place's, one answered meanwhile, and a part that is neither place", async () => {
    await answerMergeProposalsOneByOne(SITE, curatorId, null, [{ proposalId: PAIRS.plaque, answer: 'two' }], ALL_SOURCES);
    const outcome = await answerMergeProposalsOneByOne(SITE, curatorId, null, [
      { proposalId: PAIRS.plaque, answer: 'one' },
      { proposalId: PAIRS.chapels, answer: 'two' },
      { proposalId: PAIRS.cathedral, answer: 'part_of', partId: PLAQUE },
    ], ALL_SOURCES);
    expect(outcome.merged).toEqual([]);
    expect(outcome.two).toBe(0);
    expect(outcome.refused.map(r => r.proposalId)).toEqual([PAIRS.plaque, PAIRS.chapels, PAIRS.cathedral]);
    expect(outcome.refused[2].error).toBe('The part named is neither place of the pair');
    expect(await proposal(PAIRS.cathedral)).toEqual({ answer: null, part_id: null, merge_id: null });
  });

  it('holds each pair to the sources of its own two places: admitted through one pair is not admitted to another', async () => {
    // A curator of Places of worship alone reaches the card through the
    // cathedral and may answer that pair; the plaque's pair, a World Heritage
    // site and a public-art row, is outside their sources and is refused.
    const outcome = await answerMergeProposalsOneByOne(SITE, curatorId, null, [
      { proposalId: PAIRS.cathedral, answer: 'two' },
      { proposalId: PAIRS.plaque, answer: 'one' },
    ], [4]);
    expect(outcome.two).toBe(1);
    expect(outcome.merged).toEqual([]);
    expect(outcome.refused).toEqual([{ proposalId: PAIRS.plaque, error: 'Neither place of this pair is in a source you curate' }]);
    expect(await proposal(PAIRS.plaque)).toEqual({ answer: null, part_id: null, merge_id: null });
    const folded = await pool.query('SELECT id FROM experiences WHERE id = $1 AND merged_into_id IS NOT NULL', [PLAQUE]);
    expect(folded.rows).toEqual([]);
  });

  it('opens the pair again when the merge it ran is undone, so the two are a question once more', async () => {
    const outcome = await answerMergeProposalsOneByOne(SITE, curatorId, null, [{ proposalId: PAIRS.plaque, answer: 'one' }], ALL_SOURCES);
    const { mergeId } = outcome.merged[0];
    expect(await openPairs(SITE, 'all')).toEqual([PAIRS.cathedral]);
    const undone = await undoMerge(mergeId, curatorId, null);
    expect(undone.refusal).toBeUndefined();
    expect(await proposal(PAIRS.plaque)).toEqual({ answer: null, part_id: null, merge_id: null });
    expect(await openPairs(SITE, 'all')).toEqual([PAIRS.cathedral, PAIRS.plaque]);
  });
});

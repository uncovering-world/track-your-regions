import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerMergeProposalsOneByOne, mergeProposalSourceIds, openPairs } from './mergeProposalController.js';
import { queryMergeProposals } from './reviewQueueMergeProposals.js';
import type { MergePair } from '../../api/responses/reviewQueue.js';

/**
 * A serial site's part and another kind's row near and alike, proposed as one
 * place like any two places (#1250), against PostgreSQL. The fixture is
 * Mtskheta as the World Heritage run parts it: the site, its part
 * Svetitskhoveli Cathedral (no kind of its own, its item on its record in
 * World Heritage components) and the Places of worship row of the same name
 * 62 m off. The cathedral row has the lower id, so its card asks the pair.
 * Ids are the fixture's own, deleted before and after.
 */

const CATHEDRAL = 9750;
const SITE = 9751;
const PART = 9752;
const PLACES = [CATHEDRAL, SITE, PART];
const CURATOR = '00000000-0000-4000-8000-000000009750';
const ITEM = 'Q1152972';
let curatorId = 0;
let proposalId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merge_proposals WHERE place_a = ANY($1) OR place_b = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experience_parts WHERE whole_id = ANY($1) OR part_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [PLACES]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function place(id: number, name: string, source: string | null, lon: number): Promise<number | null> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, 41.8421), 4326)
       FROM experience_sources s WHERE s.name = COALESCE($5, 'UNESCO World Heritage Sites')`,
    [id, `fixture-${id}`, name, lon, source],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, 41.8421), 4326), 'auto') RETURNING id`,
    [id, name, `fixture-${id}`, lon],
  );
  if (source === null) return null;
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, `fixture-${id}`, source],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point.rows[0].id, membership.rows[0].id],
  );
  return membership.rows[0].id;
}

beforeEach(async () => {
  await clear();
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await place(CATHEDRAL, 'Svetitskhoveli Cathedral', 'Places of worship', 44.7208);
  const site = await place(SITE, 'Historical Monuments of Mtskheta (fixture)', 'UNESCO World Heritage Sites', 44.7200);
  await place(PART, 'Svetitskhoveli Cathedral', null, 44.72155);
  // The relation's trigger writes the part's record; the run then records the component's item on it.
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref) VALUES ($1, $2, 'component', $3, '108bis-003')`,
    [SITE, PART, site],
  );
  await pool.query('UPDATE experience_kind_memberships SET wikidata_items = ARRAY[$2] WHERE experience_id = $1 AND kind_id = 10', [PART, ITEM]);
  proposalId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_merge_proposals (place_a, place_b, distance_m, name_similarity, exact, reach_m)
     VALUES ($1, $2, 62, 1, false, 300) RETURNING id`,
    [CATHEDRAL, PART],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a serial site's part proposed as one place with another kind's row (#1250)", () => {
  it('is open, and scoped by the part\'s site as well as by the other place', async () => {
    expect(await openPairs(CATHEDRAL, 'all')).toEqual([proposalId]);
    // Places of worship (4) for the cathedral row, World Heritage (1) for the part, through its site.
    expect((await mergeProposalSourceIds(CATHEDRAL))?.sort()).toEqual([1, 4]);
  });

  it("names the part's site on the card, with the component's item", async () => {
    const result = await queryMergeProposals([CATHEDRAL]);
    const [pair] = result.rows[0].merge_pairs as MergePair[];
    expect(pair).toMatchObject({
      otherId: PART, otherKinds: [], otherPartOf: 'Historical Monuments of Mtskheta (fixture)', otherWikidataItem: ITEM,
      anchorPartOf: null, anchorKinds: ['Places of worship'],
    });
  });

  it('makes one place of the two, the part relation moving onto the row that stays', async () => {
    const outcome = await answerMergeProposalsOneByOne(CATHEDRAL, curatorId, null, [{ proposalId, answer: 'one' }], [4]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.merged).toHaveLength(1);
    const relation = await pool.query<{ part_id: number }>('SELECT part_id FROM experience_parts WHERE whole_id = $1', [SITE]);
    expect(relation.rows).toEqual([{ part_id: CATHEDRAL }]);
  });
});

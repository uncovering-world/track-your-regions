import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { takeBackMergeProposalAnswer } from './mergeProposalTakeBackController.js';
import { drainPairing } from '../../services/sync/mergeProposalFinder.js';

/**
 * The pass answering a near pair "part of" off Wikidata (#1991, ADR-0150),
 * executed against PostgreSQL, and a curator taking that answer back.
 *
 * The fixture is Matera's shape on an island nobody surveys (2 S, 171 W): a
 * World Heritage site and the district inside it, whose item states P361 "part
 * of" the site's item, as the Sassi di Matera's (Q2350404) states of the
 * site's (Q55739617). Beside it, three pairs the pass leaves to a curator: one
 * whose items are tied only by P276 "location", one whose items say nothing of
 * each other, and one whose items each claim to be part of the other. The
 * items are the fixture's own, never real ones; ids are the fixture's, and
 * every row is deleted before and after.
 */

const ISLAND = { lat: -2.0, lon: -171.0 };
const P = {
  site: 9750, district: 9751, square: 9752, squareTwin: 9753, abbey: 9754, abbeyTwin: 9755, fort: 9756, fortTwin: 9757,
} as const;
const ALL = Object.values(P);
const ITEM: Record<number, string> = {
  [P.site]: 'Q999975000', [P.district]: 'Q999975001', [P.square]: 'Q999975002', [P.squareTwin]: 'Q999975003',
  [P.abbey]: 'Q999975004', [P.abbeyTwin]: 'Q999975005', [P.fort]: 'Q999975006', [P.fortTwin]: 'Q999975007',
};
const ITEMS = Object.values(ITEM);
const ADMIN = '00000000-0000-4000-8000-000000009750';
let adminId = 0;

/** Metres east of the island's centre as degrees of longitude, near the equator. */
const east = (metres: number) => ISLAND.lon + metres / 111_320;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merge_proposals WHERE place_a = ANY($1) OR place_b = ANY($1)', [ALL]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [ALL]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [ALL]);
  await pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1)', [ITEMS]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

/** A published place whose membership knows it by its item, so the item claims its identity. */
async function place(id: number, name: string, source: 'Places of worship' | 'Archaeology', lon: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326) FROM experience_sources s WHERE s.name = $6`,
    [id, ITEM[id], name, lon, ISLAND.lat, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, ITEM[id], source],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'auto') RETURNING id`,
    [id, name, `fixture-${id}`, lon, ISLAND.lat],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point.rows[0].id, membership.rows[0].id],
  );
}

async function statement(subject: number, property: string, value: number): Promise<void> {
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item)
     VALUES ($1, $2, $1 || '$fixture-' || $2, 0, $3)`,
    [ITEM[subject], property, ITEM[value]],
  );
}

interface PairRow {
  id: number;
  place_a: number;
  answer: string | null;
  part_id: number | null;
  answered_by: number | null;
  answered_by_catalogue: boolean;
  answer_statement: Record<string, string> | null;
  taken_back_at: Date | null;
}

const pairOf = async (a: number) => (await pool.query<PairRow>(
  `SELECT id, place_a, answer, part_id, answered_by, answered_by_catalogue, answer_statement, taken_back_at
     FROM experience_merge_proposals WHERE place_a = $1`,
  [a],
)).rows[0];

const logOf = async (id: number) => (await pool.query<{ action: string; curator_id: number | null; details: Record<string, unknown> }>(
  'SELECT action, curator_id, details FROM experience_curation_log WHERE experience_id = $1 ORDER BY id', [id],
)).rows;

beforeAll(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  await place(P.site, 'Fixture Sassi and Rock Churches', 'Archaeology', east(0));
  await place(P.district, 'Fixture Sassi', 'Places of worship', east(200));
  await statement(P.district, 'P361', P.site);
  await place(P.square, 'Fixture Square', 'Archaeology', east(10000));
  await place(P.squareTwin, 'Fixture Square', 'Places of worship', east(10020));
  await statement(P.squareTwin, 'P276', P.square);
  await place(P.abbey, 'Fixture Abbey', 'Archaeology', east(20000));
  await place(P.abbeyTwin, 'Fixture Abbey', 'Places of worship', east(20020));
  await place(P.fort, 'Fixture Fort', 'Archaeology', east(30000));
  await place(P.fortTwin, 'Fixture Fort', 'Places of worship', east(30020));
  await statement(P.fort, 'P361', P.fortTwin);
  await statement(P.fortTwin, 'P361', P.fort);
  await drainPairing();
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a near pair Wikidata answers part of (#1991)', () => {
  it('is answered by the pass with the part the statement names, the statement and a history row naming no curator', async () => {
    const pair = await pairOf(P.site);
    expect(pair).toMatchObject({
      answer: 'part_of', part_id: P.district, answered_by: null, answered_by_catalogue: true,
      answer_statement: { property: 'P361', subject: ITEM[P.district], value: ITEM[P.site] },
    });
    expect(await logOf(P.site)).toEqual([{
      action: 'merge_proposal_answered', curator_id: null,
      details: {
        proposalId: pair.id, otherId: P.district, otherName: 'Fixture Sassi', answer: 'part_of', partId: P.district,
        catalogue: 'wikidata', statement: { property: 'P361', subject: ITEM[P.district], value: ITEM[P.site] },
      },
    }]);
  });

  it('is asked where the items are tied only by location, say nothing of each other, or each claim to be the part', async () => {
    for (const a of [P.square, P.abbey, P.fort]) {
      expect(await pairOf(a)).toMatchObject({ answer: null, answered_by_catalogue: false });
      expect(await logOf(a)).toEqual([]);
    }
  });

  it('leaves a curator\'s answer as the curator gave it', async () => {
    await statement(P.abbey, 'P527', P.abbeyTwin);
    await pool.query(
      `UPDATE experience_merge_proposals SET answer = 'two', answered_by = $2, answered_at = NOW() WHERE place_a = $1`,
      [P.abbey, adminId],
    );
    await pool.query('INSERT INTO experience_pairing_due (experience_id) VALUES ($1) ON CONFLICT DO NOTHING', [P.abbey]);
    await drainPairing();
    expect(await pairOf(P.abbey)).toMatchObject({ answer: 'two', answered_by: adminId, answered_by_catalogue: false });
  });
});

describe('taking a part of back (#1991)', () => {
  it('opens the pair again, records the take-back, and the pass never answers it from Wikidata again', async () => {
    const pair = await pairOf(P.site);
    const caller = { id: adminId, role: 'admin' } as Express.User;
    expect(await takeBackMergeProposalAnswer({ params: { id: P.site, proposalId: pair.id }, caller }))
      .toEqual({ proposalId: pair.id, answer: 'part_of', partId: P.district, catalogue: true });

    const open = await pairOf(P.site);
    expect(open).toMatchObject({ answer: null, part_id: null, answered_by_catalogue: false, answer_statement: null });
    expect(open.taken_back_at).not.toBeNull();
    expect((await logOf(P.site)).at(-1)).toEqual({
      action: 'merge_proposal_taken_back', curator_id: adminId,
      details: { proposalId: pair.id, otherId: P.district, otherName: 'Fixture Sassi', answer: 'part_of', partId: P.district, catalogue: 'wikidata' },
    });

    await pool.query('INSERT INTO experience_pairing_due (experience_id) VALUES ($1) ON CONFLICT DO NOTHING', [P.site]);
    await drainPairing();
    expect(await pairOf(P.site)).toMatchObject({ answer: null, answered_by_catalogue: false });

    // Nothing left to take back: refused, and nothing written.
    await expect(takeBackMergeProposalAnswer({ params: { id: P.site, proposalId: pair.id }, caller }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('takes a curator\'s two places back the same way', async () => {
    const pair = await pairOf(P.abbey);
    const caller = { id: adminId, role: 'admin' } as Express.User;
    expect(await takeBackMergeProposalAnswer({ params: { id: P.abbey, proposalId: pair.id }, caller }))
      .toEqual({ proposalId: pair.id, answer: 'two', partId: null, catalogue: false });
    expect(await pairOf(P.abbey)).toMatchObject({ answer: null, answered_by: null });
  });
});

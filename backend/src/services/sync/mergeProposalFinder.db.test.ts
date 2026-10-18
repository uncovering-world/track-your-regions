import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { findMergeProposals } from './mergeProposalFinder.js';

/**
 * The pass over near places with similar names (#1249, ADR-0046 decisions 2
 * to 4), executed against PostgreSQL.
 *
 * The fixture stands on an island nobody surveys (1 S, 170 W): a place of
 * worship and an archaeological site forty metres apart under one name; a
 * second site named like the first a kilometre off, within no reach; two
 * churches in one kind twenty metres apart under one name; a World Heritage
 * property of 700 hectares (a reach of 1.5 km) with a differently cased
 * archaeological twin 900 m away; a part place and its whole; and a place
 * nobody has published yet. Ids are the fixture's own, deleted before and
 * after.
 */

const ISLAND = { lat: -1.0, lon: -170.0 };
const P = {
  church: 9720, site: 9721, farSite: 9722, chapelA: 9723, chapelB: 9724,
  property: 9725, propertyTwin: 9726, whole: 9727, part: 9728, partTwin: 9729, pending: 9730,
  westOfTheLine: 9731, eastOfTheLine: 9732, monastery: 9733, monasteryTwin: 9734, oldTown: 9735, townMuseum: 9736,
} as const;
const ALL = Object.values(P);

/** Metres east of the island's centre as degrees of longitude, on the equator. */
const east = (metres: number) => ISLAND.lon + metres / 111_320;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merge_proposals WHERE place_a = ANY($1) OR place_b = ANY($1)', [ALL]);
  await pool.query('DELETE FROM experience_parts WHERE whole_id = ANY($1) OR part_id = ANY($1)', [ALL]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [ALL]);
}

interface Place {
  id: number;
  name: string;
  source: 'Places of worship' | 'Archaeology' | 'UNESCO World Heritage Sites';
  lon: number;
  state?: 'auto' | 'pending';
  metadata?: Record<string, unknown>;
  reportedName?: string;
}

async function place({ id, name, source, lon, state = 'auto', metadata = {}, reportedName }: Place): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, metadata)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6::jsonb
       FROM experience_sources s WHERE s.name = $7`,
    [id, `fixture-${id}`, name, lon, ISLAND.lat, JSON.stringify(metadata), source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships
            (experience_id, kind_id, source_id, external_id, curation_state, published_at, reported_name)
     SELECT $1, s.kind_id, s.id, $2, $3::text, CASE WHEN $3::text = 'auto' THEN NOW() END, $4
       FROM experience_sources s WHERE s.name = $5 RETURNING id`,
    [id, `fixture-${id}`, state, reportedName ?? null, source],
  );
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6::text) RETURNING id`,
    [id, name, `fixture-${id}`, lon, ISLAND.lat, state],
  );
  await pool.query(
    'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point.rows[0].id, membership.rows[0].id],
  );
  return membership.rows[0].id;
}

const fixturePairs = async () => {
  const rows = await pool.query<{ place_a: number; place_b: number; exact: boolean; distance_m: number; reach_m: number; answer: string | null; found_by: string }>(
    `SELECT place_a, place_b, exact, distance_m, reach_m, answer, found_by FROM experience_merge_proposals
      WHERE place_a = ANY($1) ORDER BY place_a, place_b`,
    [ALL],
  );
  return rows.rows;
};

beforeAll(async () => {
  await clear();
  await place({ id: P.church, name: 'Church of St Fixture', source: 'Places of worship', lon: east(0) });
  // Its source's view of the name is the church's own, so one folded name stands on both.
  await place({ id: P.site, name: 'Church of St. Fixture', source: 'Archaeology', lon: east(40), reportedName: 'Church of St Fixture' });
  await place({ id: P.farSite, name: 'Church of St Fixture (ruins)', source: 'Archaeology', lon: east(1000) });
  await place({ id: P.chapelA, name: 'Fixture Chapel', source: 'Places of worship', lon: east(3000) });
  await place({ id: P.chapelB, name: 'Fixture Chapel', source: 'Places of worship', lon: east(3020) });
  // 700 ha: a radius of 1 493 m, so a twin 900 m off is within reach.
  await place({ id: P.property, name: 'Fixture Mining Landscape', source: 'UNESCO World Heritage Sites', lon: east(10000), metadata: { areaHectares: 700 } });
  await place({ id: P.propertyTwin, name: 'Mining landscape of Fixture', source: 'Archaeology', lon: east(10900) });
  await place({ id: P.whole, name: 'Fixture Monuments', source: 'UNESCO World Heritage Sites', lon: east(20000) });
  await place({ id: P.part, name: 'Fixture Temple', source: 'UNESCO World Heritage Sites', lon: east(20050) });
  await place({ id: P.partTwin, name: 'Fixture Temple', source: 'Places of worship', lon: east(20060) });
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id)
     SELECT $1, $2, 'component', m.id FROM experience_kind_memberships m WHERE m.experience_id = $1`,
    [P.whole, P.part],
  );
  await place({ id: P.pending, name: 'Church of St Fixture', source: 'Archaeology', lon: east(30), state: 'pending' });
  // Astride the antimeridian: 0.0005 degrees either side of 180, 111 m apart on the equator.
  await place({ id: P.westOfTheLine, name: 'Fixture Lighthouse', source: 'Places of worship', lon: 179.9995 });
  await place({ id: P.eastOfTheLine, name: 'Fixture Lighthouse', source: 'Archaeology', lon: -179.9995 });
  // Geghard's case (#1652): a short name inside a long World Heritage title, unlike by trigrams.
  await place({ id: P.monastery, name: 'Monastery of Fixturegard and the Upper Fixture Valley', source: 'UNESCO World Heritage Sites', lon: east(40000) });
  await place({ id: P.monasteryTwin, name: 'Fixturegard', source: 'Places of worship', lon: east(40007) });
  // Two names made only of generic words share nothing the rule reads.
  await place({ id: P.oldTown, name: 'Old Town', source: 'UNESCO World Heritage Sites', lon: east(50000) });
  await place({ id: P.townMuseum, name: 'Town Museum', source: 'Archaeology', lon: east(50010) });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the pass over near places with similar names', () => {
  it('proposes the pairs within reach with names alike, exact where one name stands within fifty metres', async () => {
    const pass = await findMergeProposals();
    const pairs = await fixturePairs();
    expect(pairs.map(p => [p.place_a, p.place_b, p.exact, p.found_by])).toEqual([
      [P.church, P.site, true, 'similar'],
      [P.property, P.propertyTwin, false, 'similar'],
      [P.westOfTheLine, P.eastOfTheLine, false, 'similar'],
      // Unlike by trigrams; asked because every word of "Fixturegard" stands in the title. The
      // generic-only pair (Old Town / Town Museum) shares no word the rule reads and is not asked.
      [P.monastery, P.monasteryTwin, false, 'words'],
    ]);
    expect(pairs[0].distance_m).toBe(40);
    expect(pairs[1].reach_m).toBe(1493);
    expect(pairs[1].distance_m).toBe(900);
    // Across the antimeridian: found through the twin, measured on the geography.
    expect(pairs[2].distance_m).toBe(111);
    const open = pass.open.filter(pair => (ALL as readonly number[]).includes(pair.placeA.id));
    expect(open.map(pair => [pair.placeA.name, pair.placeB.name, pair.foundBy])).toEqual([
      ['Church of St Fixture', 'Church of St. Fixture', 'similar'],
      ['Fixture Lighthouse', 'Fixture Lighthouse', 'similar'],
      ['Fixture Mining Landscape', 'Mining landscape of Fixture', 'similar'],
      ['Monastery of Fixturegard and the Upper Fixture Valley', 'Fixturegard', 'words'],
    ]);
    expect(open[3].nameSimilarity).toBeLessThan(0.5);
    expect(pass.foundBy.words).toBeGreaterThanOrEqual(1);
    expect(open[0].placeA.kinds).toEqual(['Places of worship']);
    expect(open[0].placeB.kinds).toEqual(['Archaeology']);
  });

  it('leaves a pair in one kind apart, and reports it', async () => {
    const pass = await findMergeProposals();
    const chapels = pass.leftApart.find(pair => pair.placeA.name === 'Fixture Chapel');
    expect(chapels).toBeDefined();
    expect(chapels?.distanceM).toBe(20);
    expect((await fixturePairs()).some(p => p.place_a === P.chapelA)).toBe(false);
  });

  it('proposes nothing for a whole of parts, a part, or a place nobody has published', async () => {
    await findMergeProposals();
    const pairs = await fixturePairs();
    const involved = new Set(pairs.flatMap(p => [p.place_a, p.place_b]));
    for (const id of [P.whole, P.part, P.partTwin, P.pending, P.farSite]) expect(involved.has(id)).toBe(false);
  });

  it('keeps an answered pair as it is and never proposes it again, and forgets an open pair it no longer finds', async () => {
    await findMergeProposals();
    await pool.query(
      `UPDATE experience_merge_proposals SET answer = 'two', answered_at = NOW(), distance_m = 1
        WHERE place_a = $1 AND place_b = $2`,
      [P.church, P.site],
    );
    // The property's twin moves out of reach.
    await pool.query('UPDATE experience_locations SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE experience_id = $1', [P.propertyTwin, east(15000), ISLAND.lat]);
    await findMergeProposals();
    const pairs = await fixturePairs();
    expect(pairs.map(p => [p.place_a, p.place_b, p.answer, p.distance_m])).toEqual([
      [P.church, P.site, 'two', 1],
      [P.westOfTheLine, P.eastOfTheLine, null, 111],
      [P.monastery, P.monasteryTwin, null, 7],
    ]);
  });
});

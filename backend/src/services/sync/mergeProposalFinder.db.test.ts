import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { PAIRING_RULE_VERSION, drainPairing } from './mergeProposalFinder.js';

/**
 * The pass over near places with similar names (#1249, ADR-0046 decisions 2
 * to 4), executed against PostgreSQL: the marks the triggers leave on a place
 * whose pairing inputs change, and the drain that pairs those places again
 * (#1950).
 *
 * The fixture stands on an island nobody surveys (1 S, 170 W): a place of
 * worship and an archaeological site forty metres apart under one name; a
 * second site named like the first a kilometre off, within no reach; two
 * churches in one kind twenty metres apart under one name; a World Heritage
 * property of 700 hectares (a reach of 1.5 km) with a differently cased
 * archaeological twin 900 m away; a part place and its whole, and a part of
 * the same whole with no kind of its own beside a church of its name (#1250);
 * and a place nobody has published yet. Ids are the fixture's own, deleted
 * before and after.
 */

const ISLAND = { lat: -1.0, lon: -170.0 };
const P = {
  church: 9720, site: 9721, farSite: 9722, chapelA: 9723, chapelB: 9724,
  property: 9725, propertyTwin: 9726, whole: 9727, part: 9728, partTwin: 9729, pending: 9730,
  westOfTheLine: 9731, eastOfTheLine: 9732, monastery: 9733, monasteryTwin: 9734, oldTown: 9735, townMuseum: 9736,
  fort: 9737, fortTwin: 9738, windmill: 9739, windmillArrival: 9740, well: 9741, wellRefused: 9742,
  gate: 9743, gateTwin: 9744, signalTower: 9745, signalTowerTwin: 9746, belfry: 9747, belfryTwin: 9748,
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
  admission?: 'admitted' | 'refused';
  /** The kind's own facts, on its membership: a World Heritage Site's inscribed area (#2068). */
  facts?: Record<string, unknown>;
  reportedName?: string;
}

async function place({ id, name, source, lon, state = 'auto', admission = 'admitted', facts = {}, reportedName }: Place): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)
       FROM experience_sources s WHERE s.name = $6`,
    [id, `fixture-${id}`, name, lon, ISLAND.lat, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships
            (experience_id, kind_id, source_id, external_id, curation_state, published_at, reported_name, admission, facts)
     SELECT $1, s.kind_id, s.id, $2, $3::text, CASE WHEN $3::text = 'auto' THEN NOW() END, $4, $6, $7::jsonb
       FROM experience_sources s WHERE s.name = $5 RETURNING id`,
    [id, `fixture-${id}`, state, reportedName ?? null, source, admission, JSON.stringify(facts)],
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
  const rows = await pool.query<{
    place_a: number; place_b: number; exact: boolean; distance_m: number; reach_m: number; answer: string | null; found_by: string;
    matched_words: string[] | null;
  }>(
    `SELECT place_a, place_b, exact, distance_m, reach_m, answer, found_by, matched_words FROM experience_merge_proposals
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
  await place({ id: P.property, name: 'Fixture Mining Landscape', source: 'UNESCO World Heritage Sites', lon: east(10000), facts: { areaHectares: 700 } });
  await place({ id: P.propertyTwin, name: 'Mining landscape of Fixture', source: 'Archaeology', lon: east(10900) });
  await place({ id: P.whole, name: 'Fixture Monuments', source: 'UNESCO World Heritage Sites', lon: east(20000) });
  await place({ id: P.part, name: 'Fixture Temple', source: 'UNESCO World Heritage Sites', lon: east(20050) });
  await place({ id: P.partTwin, name: 'Fixture Temple', source: 'Places of worship', lon: east(20060) });
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id)
     SELECT $1, $2, 'component', m.id FROM experience_kind_memberships m WHERE m.experience_id = $1`,
    [P.whole, P.part],
  );
  // A part as the World Heritage run parts a component: no kind of its own, offered through its whole.
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Fixture Belfry', ST_SetSRID(ST_MakePoint($3, $4), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [P.belfry, `part:fixture-${P.belfry}`, east(20500), ISLAND.lat],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
     VALUES ($1, 'Fixture Belfry', 'fixture-whole-002', ST_SetSRID(ST_MakePoint($2, $3), 4326), 'auto')`,
    [P.belfry, east(20500), ISLAND.lat],
  );
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
     SELECT $1, $2, 'component', m.id, 'fixture-whole-002' FROM experience_kind_memberships m WHERE m.experience_id = $1`,
    [P.whole, P.belfry],
  );
  await place({ id: P.belfryTwin, name: 'Fixture Belfry', source: 'Places of worship', lon: east(20520) });
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

const marked = async (ids: readonly number[]) => (await pool.query<{ experience_id: number }>(
  'SELECT experience_id FROM experience_pairing_due WHERE experience_id = ANY($1) ORDER BY experience_id', [ids],
)).rows.map(row => row.experience_id);

const pairOf = async (a: number) => (await fixturePairs()).find(p => p.place_a === a);

describe('the pass over near places with similar names', () => {
  it('proposes the pairs within reach with names alike, exact where one name stands within fifty metres', async () => {
    // Every fixture place was marked as it was written, and the drain pairs them.
    expect(await marked(ALL)).not.toHaveLength(0);
    expect(await drainPairing()).not.toBeNull();
    expect(await marked(ALL)).toEqual([]);
    const pairs = await fixturePairs();
    expect(pairs.map(p => [p.place_a, p.place_b, p.exact, p.found_by])).toEqual([
      [P.church, P.site, true, 'similar'],
      [P.property, P.propertyTwin, false, 'similar'],
      // A serial site's part is paired like any place (#1250): one holding a kind, one offered through its whole.
      [P.part, P.partTwin, true, 'similar'],
      [P.westOfTheLine, P.eastOfTheLine, false, 'similar'],
      // Unlike by trigrams; asked because every word of "Fixturegard" stands in the title. The
      // generic-only pair (Old Town / Town Museum) shares no word the rule reads and is not asked.
      [P.monastery, P.monasteryTwin, false, 'words'],
      [P.belfry, P.belfryTwin, true, 'similar'],
    ]);
    expect(pairs[0].distance_m).toBe(40);
    // The words the containment stood on, and none on a pair found by similarity (#2194).
    expect(pairs[4].matched_words).toEqual(['fixturegard']);
    expect(pairs[0].matched_words).toBeNull();
    expect(pairs[1].reach_m).toBe(1493);
    expect(pairs[1].distance_m).toBe(900);
    // Across the antimeridian: found through the twin, measured on the geography.
    expect(pairs[3].distance_m).toBe(111);
  });

  it('leaves a pair in one kind apart, and proposes nothing for a whole of parts or a place nobody has published', async () => {
    await drainPairing();
    const pairs = await fixturePairs();
    const involved = new Set(pairs.flatMap(p => [p.place_a, p.place_b]));
    for (const id of [P.chapelA, P.chapelB, P.whole, P.pending, P.farSite]) {
      expect(involved.has(id)).toBe(false);
    }
  });

  it('keeps an answered pair as it is, and forgets an open pair a moved point takes out of reach', async () => {
    await drainPairing();
    await pool.query(
      `UPDATE experience_merge_proposals SET answer = 'two', answered_at = NOW(), distance_m = 1
        WHERE place_a = $1 AND place_b = $2`,
      [P.church, P.site],
    );
    // The property's twin moves out of reach: the move marks it, and the drain forgets the pair.
    await pool.query('UPDATE experience_locations SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE experience_id = $1', [P.propertyTwin, east(15000), ISLAND.lat]);
    expect(await marked([P.propertyTwin])).toEqual([P.propertyTwin]);
    // The church is renamed alike: marked, paired again, and its answered pair stands.
    await pool.query(`UPDATE experiences SET name = 'Church of Saint Fixture' WHERE id = $1`, [P.church]);
    await drainPairing();
    const pairs = await fixturePairs();
    expect(pairs.map(p => [p.place_a, p.place_b, p.answer, p.distance_m])).toEqual([
      [P.church, P.site, 'two', 1],
      [P.part, P.partTwin, null, 10],
      [P.westOfTheLine, P.eastOfTheLine, null, 111],
      [P.monastery, P.monasteryTwin, null, 7],
      [P.belfry, P.belfryTwin, null, 20],
    ]);
  });

  it('marks nothing for a write that changes none of what the rule reads', async () => {
    await drainPairing();
    await pool.query(`UPDATE experiences SET description = 'A fixture' WHERE id = $1`, [P.oldTown]);
    await pool.query(`UPDATE experience_locations SET name = 'Fixture point' WHERE experience_id = $1`, [P.oldTown]);
    expect(await marked([P.oldTown])).toEqual([]);
  });
});

describe('pairing a place again when what the rule reads changes (#1950)', () => {
  it('pairs a renamed place with the near place whose name it now carries', async () => {
    await place({ id: P.fort, name: 'Fixture Harbour Fort', source: 'Places of worship', lon: east(60000) });
    await place({ id: P.fortTwin, name: 'Fixture Lookout', source: 'Archaeology', lon: east(60020) });
    await drainPairing();
    expect(await pairOf(P.fort)).toBeUndefined();

    await pool.query(`UPDATE experiences SET name = 'Fixture Harbour Fort' WHERE id = $1`, [P.fortTwin]);
    expect(await marked([P.fortTwin])).toEqual([P.fortTwin]);
    await drainPairing();

    expect(await pairOf(P.fort)).toMatchObject({ place_b: P.fortTwin, exact: true, found_by: 'similar', answer: null });
  });

  it('pairs an arrival once it is published, and not while no reader sees it', async () => {
    await place({ id: P.windmill, name: 'Fixture Windmill', source: 'Places of worship', lon: east(70000) });
    await place({ id: P.windmillArrival, name: 'Fixture Windmill', source: 'Archaeology', lon: east(70030), state: 'pending' });
    await drainPairing();
    expect(await pairOf(P.windmill)).toBeUndefined();

    // What publishing the arrival does to it: the membership and its point become a reader's.
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`,
      [P.windmillArrival],
    );
    await pool.query(`UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1`, [P.windmillArrival]);
    await drainPairing();

    expect(await pairOf(P.windmill)).toMatchObject({ place_b: P.windmillArrival, found_by: 'similar' });
  });

  it('pairs a place whose refusal is taken back', async () => {
    await place({ id: P.well, name: 'Fixture Holy Well', source: 'Places of worship', lon: east(80000) });
    await place({ id: P.wellRefused, name: 'Fixture Holy Well', source: 'Archaeology', lon: east(80010), admission: 'refused' });
    await drainPairing();
    expect(await pairOf(P.well)).toBeUndefined();

    await pool.query(`UPDATE experience_kind_memberships SET admission = 'admitted' WHERE experience_id = $1`, [P.wellRefused]);
    await drainPairing();

    expect(await pairOf(P.well)).toMatchObject({ place_b: P.wellRefused, exact: true });
  });

  it("pairs a site's parts again when the site's own standing changes, which marks only the site (#1250)", async () => {
    await drainPairing();
    expect(await pairOf(P.belfry)).toMatchObject({ place_b: P.belfryTwin });

    // The site refused: its part is no longer offered, and its pair is forgotten.
    await pool.query(`UPDATE experience_kind_memberships SET admission = 'refused' WHERE experience_id = $1`, [P.whole]);
    expect(await marked([P.belfry])).toEqual([]);
    await drainPairing();
    expect(await pairOf(P.belfry)).toBeUndefined();

    // The refusal taken back: the part is paired again.
    await pool.query(`UPDATE experience_kind_memberships SET admission = 'admitted' WHERE experience_id = $1`, [P.whole]);
    await drainPairing();
    expect(await pairOf(P.belfry)).toMatchObject({ place_b: P.belfryTwin });
  });

  it('leaves a mark an uncommitted writer holds to the next drain, which pairs the place as the writer left it', async () => {
    await place({ id: P.gate, name: 'Fixture Water Gate', source: 'Places of worship', lon: east(90000) });
    await place({ id: P.gateTwin, name: 'Fixture Lantern', source: 'Archaeology', lon: east(90015) });
    await drainPairing();
    expect(await pairOf(P.gate)).toBeUndefined();
    // A mark already there, committed, which the writer's own mark then locks.
    await pool.query('INSERT INTO experience_pairing_due (experience_id) VALUES ($1)', [P.gateTwin]);

    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`UPDATE experiences SET name = 'Fixture Water Gate' WHERE id = $1`, [P.gateTwin]);
      // The drain meanwhile neither waits on the writer nor takes its mark, which
      // it would otherwise pair as the place stood before the rename.
      await drainPairing();
      await writer.query('COMMIT');
    } finally {
      writer.release();
    }
    expect(await pairOf(P.gate)).toBeUndefined();
    expect(await marked([P.gateTwin])).toEqual([P.gateTwin]);

    await drainPairing();
    expect(await pairOf(P.gate)).toMatchObject({ place_b: P.gateTwin, exact: true });
  });

  it('forgets the open pair of two places a merge makes one, and proposes it again once the merge is undone (#1933)', async () => {
    await place({ id: P.signalTower, name: 'Fixture Signal Tower', source: 'Places of worship', lon: east(100000) });
    await place({ id: P.signalTowerTwin, name: 'Fixture Signal Tower', source: 'Archaeology', lon: east(100015) });
    await drainPairing();
    expect(await pairOf(P.signalTower)).toMatchObject({ place_b: P.signalTowerTwin, answer: null });

    // What a merge does to the folded place: both places are marked, and the pair asks nothing any more,
    // so the check never lists a question the review queue does not ask.
    await pool.query('UPDATE experiences SET merged_into_id = $2 WHERE id = $1', [P.signalTowerTwin, P.signalTower]);
    expect(await marked([P.signalTower, P.signalTowerTwin])).toEqual([P.signalTower, P.signalTowerTwin]);
    await drainPairing();
    expect(await pairOf(P.signalTower)).toBeUndefined();

    // What the undo does to it: the two stand apart again and are asked about again.
    await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = $1', [P.signalTowerTwin]);
    await drainPairing();
    expect(await pairOf(P.signalTower)).toMatchObject({ place_b: P.signalTowerTwin, answer: null });
  });

  it('pairs the whole catalogue once when the stored rule version is not the rule\'s', async () => {
    await drainPairing();
    // Pairs no drain was asked about: forgotten without a mark, as if an older rule had never found them.
    await pool.query('DELETE FROM experience_merge_proposals WHERE answer IS NULL AND (place_a = ANY($1) OR place_b = ANY($1))', [ALL]);
    await pool.query('UPDATE experience_pairing_rule SET rule_version = $1', [PAIRING_RULE_VERSION - 1]);

    const drain = await drainPairing();

    expect(drain?.wholeCatalogue).toBe(true);
    expect((await fixturePairs()).filter(p => p.answer === null).map(p => p.place_a)).toEqual(
      expect.arrayContaining([P.westOfTheLine, P.monastery, P.fort, P.windmill, P.well, P.gate]),
    );
    expect((await pool.query('SELECT rule_version FROM experience_pairing_rule')).rows[0].rule_version).toBe(PAIRING_RULE_VERSION);
    expect((await drainPairing())?.wholeCatalogue).toBe(false);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from '../../services/sync/locationWriter.js';
import { mergePlaces } from './placeMerge.js';

/**
 * The source of a merged place's folded point, run again (#1662), against
 * PostgreSQL. The fixture is the Mogao Caves as the catalogue held them before
 * the merge: a World Heritage row known by UNESCO's number and an Archaeology
 * row known by the Wikidata item, each with one point. The merge folds the
 * Archaeology point into the World Heritage one (ADR-0088 decision 3).
 */

const HERITAGE = 9990;
const DIG = 9991;
/** A place of worship on the same caves, for a chain of two merges. */
const SHRINE = 9992;
const ITEM = 'Q99990-fixture';
const MOGAO = { lon: 94.8089, lat: 40.0375 };

let archaeology = 0;
let heritagePoint = 0;
let digPoint = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1) OR folded_id = ANY($1)', [[HERITAGE, DIG, SHRINE]]);
  await pool.query('UPDATE experience_locations SET merged_into_id = NULL WHERE experience_id = ANY($1)', [[HERITAGE, DIG, SHRINE]]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1)', [[HERITAGE, DIG, SHRINE]]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [[HERITAGE, DIG, SHRINE]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [[HERITAGE, DIG, SHRINE]]);
}

/** A place of one point, placed by its source's membership. */
async function place(id: number, source: string, ref: string, lon: number): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Mogao Caves (fold fixture)', ST_SetSRID(ST_MakePoint($3, $4), 4326)
       FROM experience_sources s WHERE s.name = $5`,
    [id, ref, lon, MOGAO.lat, source],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, 'auto', NOW() FROM experience_sources s WHERE s.name = $3 RETURNING id`,
    [id, ref, source],
  );
  const point = (await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location)
     VALUES ($1, 'Mogao Caves', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)) RETURNING id`,
    [id, ref, lon, MOGAO.lat],
  )).rows[0].id;
  await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
    [point, membership.rows[0].id]);
  return point;
}

beforeEach(async () => {
  await clear();
  archaeology = (await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Archaeology'`)).rows[0].id;
  heritagePoint = await place(HERITAGE, 'UNESCO World Heritage Sites', '440-fixture', MOGAO.lon);
  // The item's coordinate is 10.7 km east of UNESCO's, as on the development catalogue.
  digPoint = await place(DIG, 'Archaeology', ITEM, MOGAO.lon + 0.126);
});

/** The merge of the Archaeology row into the World Heritage one. */
async function merge(survivorId = HERITAGE, foldedId = DIG): Promise<void> {
  const merged = await mergePlaces({ survivorId, foldedId, mergedBy: null, reason: 'equal_wikidata_item' });
  expect(merged.refusal).toBeUndefined();
}

afterAll(async () => {
  await clear();
  await pool.end();
});

/** The points of the place, standing or folded. */
const points = async () => (await pool.query<{ id: number; merged_into_id: number | null; lon: number }>(
  `SELECT id, merged_into_id, ST_X(location) AS lon FROM experience_locations
    WHERE experience_id = ANY($1) AND missing_since IS NULL ORDER BY id`, [[HERITAGE, DIG, SHRINE]],
)).rows;

const run = (lon: number) => writeExperienceLocations(
  HERITAGE, [{ name: 'Mogao Caves', externalRef: ITEM, lon, lat: MOGAO.lat }], { syncLogId: null, sourceId: archaeology },
);

describe('the source of a folded point, run again (#1662)', () => {
  it('pairs its point with the folded one and adds nothing', async () => {
    await merge();
    const result = await run(MOGAO.lon + 0.126);
    expect(result.delta.added).toEqual([]);
    expect(result.delta.withdrawn).toEqual([]);
    expect((await points()).map(p => [p.id, p.merged_into_id])).toEqual([[heritagePoint, null], [digPoint, heritagePoint]]);
  });

  it('lets the folded point follow the source quietly when it moves, and asks nothing', async () => {
    await merge();
    const result = await run(MOGAO.lon + 0.15);
    expect(result.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    const [kept, folded] = await points();
    expect(kept.lon).toBeCloseTo(MOGAO.lon, 6);
    expect(folded).toMatchObject({ id: digPoint, merged_into_id: heritagePoint });
    expect(folded.lon).toBeCloseTo(MOGAO.lon + 0.15, 6);
  });

  it('keeps the run\'s placement on the point a reader sees, and changes nothing on the next run', async () => {
    await merge();
    await run(MOGAO.lon + 0.15);
    const again = await run(MOGAO.lon + 0.15);
    expect(again.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    expect(again.needsAssignment).toEqual([]);
    const placedBy = await pool.query<{ source: string }>(
      `SELECT s.name AS source FROM experience_location_placements p
         JOIN experience_kind_memberships m ON m.id = p.membership_id JOIN experience_sources s ON s.id = m.source_id
        WHERE p.location_id = $1 ORDER BY s.name`, [heritagePoint],
    );
    expect(placedBy.rows.map(row => row.source)).toEqual(['Archaeology', 'UNESCO World Heritage Sites']);
    expect(await points()).toHaveLength(2);
  });

  it('finds its point down a chain of merges', async () => {
    // The Archaeology row first merged into a place of worship, which a later merge folded into the site.
    await place(SHRINE, 'Places of worship', 'Q99992-fixture', MOGAO.lon + 0.002);
    await merge(SHRINE, DIG);
    await merge(HERITAGE, SHRINE);
    const result = await run(MOGAO.lon + 0.126);
    expect(result.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    const standing = await pool.query(
      'SELECT id FROM experience_locations WHERE experience_id = $1 AND merged_into_id IS NULL AND missing_since IS NULL',
      [HERITAGE],
    );
    expect(standing.rows).toEqual([{ id: heritagePoint }]);
  });

  it('leaves alone a point added again before the fix, once the repair has folded it', async () => {
    await merge();
    // What the run did before #1662, and what migration 123 makes of it.
    const again = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, merged_into_id)
       VALUES ($1, 'Mogao Caves', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5) RETURNING id`,
      [HERITAGE, ITEM, MOGAO.lon + 0.126, MOGAO.lat, heritagePoint],
    )).rows[0].id;
    const first = await run(MOGAO.lon + 0.126);
    expect(first.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    const second = await run(MOGAO.lon + 0.126);
    expect(second.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    // Untouched by the runs, and no withdrawal for a curator to answer.
    const row = await pool.query('SELECT merged_into_id, missing_since FROM experience_locations WHERE id = $1', [again]);
    expect(row.rows[0]).toEqual({ merged_into_id: heritagePoint, missing_since: null });
  });

  it('pairs only its own folded point where two sources\' points were folded under one reference', async () => {
    // The place of worship reads the same item as Archaeology; both rows fold into the site.
    await place(SHRINE, 'Places of worship', ITEM, MOGAO.lon + 0.126);
    await merge();
    await merge(HERITAGE, SHRINE);
    const shrinePoint = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_locations WHERE experience_id = $1', [SHRINE],
    )).rows[0].id;
    const first = await run(MOGAO.lon + 0.13);
    expect(first.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    const moved = await pool.query<{ id: number; lon: number }>(
      'SELECT id, ST_X(location) AS lon FROM experience_locations WHERE id = ANY($1) ORDER BY id', [[digPoint, shrinePoint]],
    );
    // Archaeology's folded point followed its source; the shrine's stayed as its own source left it.
    expect(moved.rows.find(row => row.id === digPoint)!.lon).toBeCloseTo(MOGAO.lon + 0.13, 6);
    expect(moved.rows.find(row => row.id === shrinePoint)!.lon).toBeCloseTo(MOGAO.lon + 0.126, 6);
  });

  it('pairs only its own point down a chain whose points share one reference', async () => {
    // The place of worship reads the same item; the dig folds into it by reference, then it into the site.
    await place(SHRINE, 'Places of worship', ITEM, MOGAO.lon + 0.126);
    await merge(SHRINE, DIG);
    await merge(HERITAGE, SHRINE);
    const shrinePoint = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_locations WHERE experience_id = $1', [SHRINE],
    )).rows[0].id;
    const first = await run(MOGAO.lon + 0.13);
    expect(first.delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
    const lon = async (id: number) => (await pool.query<{ lon: number }>(
      'SELECT ST_X(location) AS lon FROM experience_locations WHERE id = $1', [id],
    )).rows[0].lon;
    expect(await lon(digPoint)).toBeCloseTo(MOGAO.lon + 0.13, 6);
    expect(await lon(shrinePoint)).toBeCloseTo(MOGAO.lon + 0.126, 6);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { namedRuinsNear } from './namedRuinsNear.js';

/**
 * The ruin mapped near a place under its name (ADR-0188), against PostgreSQL.
 * Fixture rows on real places: Abellinum (Q318664) at Atripalda, which the
 * layer maps as *Area archeologica dell'antica Abellinum* with no item, an
 * unnamed ruin 150 m off it, and a ruin named for a temple; the İsa Bey Mosque
 * (Q1673689) at Selçuk, with only an unnamed ruin beside it. The spec's own
 * rows are the objects numbered from 9_100_000_000 and its layer build.
 */

const ABELLINUM = 'Q318664';
const ISA_BEY = 'Q1673689';
const IDS = [9_100_000_001, 9_100_000_002, 9_100_000_003, 9_100_000_004, 9_100_000_005, 9_100_000_006];
let build = 0;

const object = (id: number, tags: Record<string, string>, wkt: string) => pool.query(
  "INSERT INTO osm_objects VALUES ('W', $1, $2, NULL, NULL, ST_GeomFromText($3, 4326))", [id, tags, wkt],
);

async function wipe(): Promise<void> {
  await pool.query("DELETE FROM osm_objects WHERE osm_type = 'W' AND osm_id = ANY($1::bigint[])", [IDS]);
  await pool.query('DELETE FROM wikidata_labels WHERE id = ANY($1::text[])', [[ABELLINUM, ISA_BEY]]);
  if (build) {
    await pool.query('DELETE FROM osm_layer_builds WHERE build_id = $1', [build]);
    await pool.query('DELETE FROM dump_builds WHERE id = $1', [build]);
  }
}

beforeAll(async () => {
  await wipe();
  await pool.query("INSERT INTO wikidata_labels (id, language, label) VALUES ($1, 'en', 'Abellinum'), ($1, 'it', 'Abellinum'), ($2, 'en', 'İsa Bey Mosque')",
    [ABELLINUM, ISA_BEY]);
  await object(IDS[0], { historic: 'archaeological_site', name: "Area archeologica dell'antica Abellinum" }, 'POINT(14.83123 40.92212)');
  // 150 m east of it, unnamed.
  await object(IDS[1], { historic: 'ruins' }, 'POINT(14.83301 40.92212)');
  // A temple's ruin 1 km off, named for something else.
  await object(IDS[2], { historic: 'ruins', name: 'Tempio di Giove' }, 'POINT(14.84300 40.92212)');
  // Beside the mosque, unnamed; and a named excavation 3 km off.
  await object(IDS[3], { historic: 'archaeological_site' }, 'POINT(27.36780 37.95100)');
  await object(IDS[4], { historic: 'archaeological_site', name: 'Isa Bey hamam excavation' }, 'POINT(27.40200 37.95100)');
  // 500 m off, sharing only the generic word "mosque" with the mosque's label.
  await object(IDS[5], { historic: 'ruins', name: 'Mosque ruins' }, 'POINT(27.37350 37.95100)');
  build = (await pool.query<{ id: number }>("INSERT INTO dump_builds (dump, mode, status) VALUES ('osm-planet', 'local', 'success') RETURNING id")).rows[0].id;
  await pool.query(
    "INSERT INTO osm_layer_builds (build_id, planet_file, dump_date, replicated_at, objects, pinned, drawn) VALUES ($1, 'planet-261102.osm.pbf', now()::date, now(), 5, 0, NULL)",
    [build],
  );
});

afterAll(async () => {
  await wipe();
  await pool.end();
});

describe('the ruin mapped near a place under its name (ADR-0188)', () => {
  it('finds the ruin named with a word of the place\'s labels, and none unnamed or named for something else', async () => {
    const found = await namedRuinsNear([
      { qid: ABELLINUM, lat: 40.92212, lon: 14.83123 },
      { qid: ISA_BEY, lat: 37.95100, lon: 27.36780 },
    ], 2_000);
    expect(found).toEqual(new Map([[ABELLINUM, { ref: `way/${IDS[0]}`, name: "Area archeologica dell'antica Abellinum" }]]));
  });

  it('reads the radius: asked from 3 km off, Abellinum\'s excavation is not near at 2 km, and is at 5 km', async () => {
    const off = [{ qid: ABELLINUM, lat: 40.92212, lon: 14.86680 }];
    expect((await namedRuinsNear(off, 2_000))!.size).toBe(0);
    expect((await namedRuinsNear(off, 5_000))!.get(ABELLINUM)?.ref).toBe(`way/${IDS[0]}`);
  });

  it('reads no word under four letters and no generic one: the İsa Bey Mosque names nothing at any radius', async () => {
    // "Mosque ruins" 500 m off shares "mosque" alone, a word every mosque's name carries.
    expect((await namedRuinsNear([{ qid: ISA_BEY, lat: 37.95100, lon: 27.36780 }], 5_000))!.size).toBe(0);
  });

  it('reads a word whole: Abellinum is no word of "Abellinumville"', async () => {
    await object(9_100_000_007, { historic: 'ruins', name: 'Abellinumville' }, 'POINT(14.83123 40.95000)');
    try {
      expect((await namedRuinsNear([{ qid: ABELLINUM, lat: 40.95000, lon: 14.83123 }], 1_000))!.size).toBe(0);
    } finally {
      await pool.query("DELETE FROM osm_objects WHERE osm_type = 'W' AND osm_id = 9100000007");
    }
  });

  it('asks nothing of no places', async () => {
    expect(await namedRuinsNear([], 2_000)).toEqual(new Map());
  });
});

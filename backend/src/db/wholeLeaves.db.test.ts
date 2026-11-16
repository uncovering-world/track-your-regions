import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inTransaction, pool } from './index.js';
import { unplacedAssertions } from '../controllers/admin/dataAssertions/unplacedAssertions.js';

/**
 * A whole knows its leaves (ADR-0206), against PostgreSQL: the rows
 * `refresh_whole_leaves()` writes into `whole_leaves` from the triggers on a
 * part relation and on a point, at any depth.
 *
 * The fixture's wholes are shaped on real sites. A flat arc of 34 stations
 * (921000), as the Struve Geodetic Arc is. A mountain (921100) of 17 places
 * and a spring group (921101) of 8 ponds inside it, one pond also named a
 * part of the mountain directly, as Fujisan holds Oshino Hakkai once a
 * curator nests it. A mountain range (921200) whose three temples all wait for
 * a curator, as Wudang's do. Two places each named a part of the other
 * (921300, 921301) over one temple (921302), the loop a source's records can
 * make. And a site of 758 shelters (922000), the size of the Rock Art of the
 * Mediterranean Basin. Everything is deleted before and after; the dependants
 * cascade.
 */

const ARC = 921000;
const STATIONS = range(921001, 34);
const MOUNTAIN = 921100;
const SPRINGS = 921101;
const PONDS = range(921102, 8);
const SLOPES = range(921110, 17);
const RANGE = 921200;
const TEMPLES = range(921201, 3);
const LOOP_A = 921300;
const LOOP_B = 921301;
const LOOP_TEMPLE = 921302;
const ROCK_ART = 922000;
const SHELTERS = range(922001, 758);

function range(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id BETWEEN 921000 AND 922999');
}

/** Places of no kind, each standing where its point will. */
async function places(ids: number[]): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT g, s.id, 'Q' || g || '001', 'Whole leaves fixture ' || g, ST_SetSRID(ST_MakePoint(10, 50), 4326)
       FROM unnest($1::int[]) AS g, experience_sources s WHERE s.name = 'Art Museums'`,
    [ids],
  );
}

/** One point on each place, read (auto) or waiting for a curator (pending). */
async function points(ids: number[], state: 'auto' | 'pending'): Promise<void> {
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     SELECT g, 'fixture point', 1, ST_SetSRID(ST_MakePoint(10, 50), 4326), $2
       FROM unnest($1::int[]) AS g`,
    [ids, state],
  );
}

/** The part relations, in one statement. */
async function parts(whole: number, ids: number[]): Promise<void> {
  await pool.query(
    `INSERT INTO experience_parts (whole_id, part_id, reason) SELECT $1, g, 'curator' FROM unnest($2::int[]) AS g`,
    [whole, ids],
  );
}

/** A whole's leaves as held, and how many of them a reader is shown. */
async function leaves(whole: number): Promise<{ ids: number[]; offered: number }> {
  const result = await pool.query<{ leaf_id: number; offered: boolean }>(
    'SELECT leaf_id, offered FROM whole_leaves WHERE whole_id = $1 ORDER BY leaf_id', [whole],
  );
  return { ids: result.rows.map(row => row.leaf_id), offered: result.rows.filter(row => row.offered).length };
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a whole's leaves (ADR-0206)", () => {
  it('counts a flat whole by its parts, once each, and never by its own point', async () => {
    await places([ARC, ...STATIONS]);
    await points(STATIONS, 'auto');
    await parts(ARC, STATIONS);
    expect(await leaves(ARC)).toEqual({ ids: STATIONS, offered: 34 });

    // A station holding two points is one place; the arc's own point is no station.
    await points([STATIONS[0], ARC], 'auto');
    expect(await leaves(ARC)).toEqual({ ids: STATIONS, offered: 34 });
  });

  it('gives a nested whole its own count, and its leaves to the whole above it, a pond named twice once', async () => {
    await places([MOUNTAIN, SPRINGS, ...PONDS, ...SLOPES]);
    await points([...PONDS, ...SLOPES], 'auto');
    await parts(SPRINGS, PONDS);
    await parts(MOUNTAIN, [SPRINGS, ...SLOPES, PONDS[0]]);

    expect(await leaves(SPRINGS)).toEqual({ ids: PONDS, offered: 8 });
    const mountain = await leaves(MOUNTAIN);
    expect(mountain).toEqual({ ids: sorted([...PONDS, ...SLOPES]), offered: 25 });
    expect(mountain.ids).not.toContain(SPRINGS);
  });

  it('takes a leaf out of every whole above it when its part relation goes', async () => {
    await places([MOUNTAIN, SPRINGS, ...PONDS, ...SLOPES]);
    await points([...PONDS, ...SLOPES], 'auto');
    await parts(SPRINGS, PONDS);
    await parts(MOUNTAIN, [SPRINGS, ...SLOPES]);
    expect((await leaves(MOUNTAIN)).ids).toHaveLength(25);

    await pool.query('DELETE FROM experience_parts WHERE whole_id = $1 AND part_id = $2', [SPRINGS, PONDS[1]]);
    expect((await leaves(SPRINGS)).ids).not.toContain(PONDS[1]);
    expect((await leaves(SPRINGS)).ids).toHaveLength(7);
    expect((await leaves(MOUNTAIN)).ids).not.toContain(PONDS[1]);
    expect((await leaves(MOUNTAIN)).ids).toHaveLength(24);

    // The spring group itself taken out: the mountain keeps its slopes alone.
    await pool.query('DELETE FROM experience_parts WHERE whole_id = $1 AND part_id = $2', [MOUNTAIN, SPRINGS]);
    expect(await leaves(MOUNTAIN)).toEqual({ ids: SLOPES, offered: 17 });
    expect((await leaves(SPRINGS)).ids).toHaveLength(7);
  });

  it('holds a whole whose parts all wait for a curator with no offered leaf', async () => {
    await places([RANGE, ...TEMPLES]);
    await points(TEMPLES, 'pending');
    await parts(RANGE, TEMPLES);

    expect(await leaves(RANGE)).toEqual({ ids: TEMPLES, offered: 0 });
  });

  it("turns a leaf offered when a curator publishes its point, in the curator's own transaction", async () => {
    await places([RANGE, ...TEMPLES]);
    await points(TEMPLES, 'pending');
    await parts(RANGE, TEMPLES);

    await inTransaction(async client => {
      await client.query(
        `UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1`, [TEMPLES[0]],
      );
      const inside = await client.query<{ offered: boolean }>(
        'SELECT offered FROM whole_leaves WHERE whole_id = $1 AND leaf_id = $2', [RANGE, TEMPLES[0]],
      );
      expect(inside.rows).toEqual([{ offered: true }]);
    });
    expect(await leaves(RANGE)).toEqual({ ids: TEMPLES, offered: 1 });

    // Turned down by a curator, it is no longer shown.
    await pool.query('UPDATE experience_locations SET refused_at = NOW() WHERE experience_id = $1', [TEMPLES[0]]);
    expect(await leaves(RANGE)).toEqual({ ids: TEMPLES, offered: 0 });
  });

  it('walks a loop of part relations to an end, and counts what lies under it', async () => {
    await places([LOOP_A, LOOP_B, LOOP_TEMPLE]);
    await points([LOOP_TEMPLE], 'auto');
    await parts(LOOP_A, [LOOP_B]);
    await parts(LOOP_B, [LOOP_A, LOOP_TEMPLE]);

    expect(await leaves(LOOP_A)).toEqual({ ids: [LOOP_TEMPLE], offered: 1 });
    expect(await leaves(LOOP_B)).toEqual({ ids: [LOOP_TEMPLE], offered: 1 });
    const above = await pool.query<{ id: number }>(
      'SELECT place_ancestors AS id FROM place_ancestors(ARRAY[$1::int]) ORDER BY 1', [LOOP_TEMPLE],
    );
    expect(above.rows.map(row => row.id)).toEqual([LOOP_A, LOOP_B]);
  });

  it('refreshes and shapes a whole of 758 parts once for the statement that writes them all', async () => {
    await places([ROCK_ART, ...SHELTERS]);
    await points(SHELTERS, 'auto');

    await inTransaction(async client => {
      // 'all' counts the SQL function whole_shape_of as well as the PL/pgSQL one.
      await client.query("SET LOCAL track_functions = 'all'");
      await client.query(
        `INSERT INTO experience_parts (whole_id, part_id, reason)
         SELECT $1, g, 'component' FROM unnest($2::int[]) AS g`,
        [ROCK_ART, SHELTERS],
      );
      const calls = await client.query<{ funcname: string; calls: string }>(
        `SELECT funcname, calls FROM pg_stat_xact_user_functions
          WHERE funcname IN ('refresh_whole_leaves', 'whole_shape_of') ORDER BY funcname`,
      );
      expect(calls.rows).toEqual([
        { funcname: 'refresh_whole_leaves', calls: '1' },
        { funcname: 'whole_shape_of', calls: '1' },
      ]);
    });
    expect(await leaves(ROCK_ART)).toEqual({ ids: SHELTERS, offered: 758 });
    // Every trigger on 759 places, 758 points and 758 parts runs inside it: 3x
    // its slowest passing CI run (43798085175).
  }, 7_000);

  it('is nothing the out-of-step check reports, until a row is changed by hand', async () => {
    await places([ARC, ...STATIONS]);
    await points(STATIONS, 'auto');
    await parts(ARC, STATIONS);
    const check = unplacedAssertions.find(a => a.id === 'whole-leaves-out-of-step');
    expect(check).toBeDefined();
    const fixtureRows = async () => (await pool.query(check!.sql)).rows
      .filter(row => Number(row.whole_id) === ARC);

    expect(await fixtureRows()).toEqual([]);

    await pool.query('UPDATE whole_leaves SET offered = false WHERE whole_id = $1 AND leaf_id = $2', [ARC, STATIONS[0]]);
    await pool.query('DELETE FROM whole_leaves WHERE whole_id = $1 AND leaf_id = $2', [ARC, STATIONS[1]]);
    expect(await fixtureRows()).toEqual([
      expect.objectContaining({ leaf_id: STATIONS[0], expected_offered: true, held_offered: false }),
      expect.objectContaining({ leaf_id: STATIONS[1], expected_offered: true, held_offered: null }),
    ]);

    // The refresh brings both back, and writes nothing a second time.
    const first = await pool.query<{ written: number }>('SELECT refresh_whole_leaves(ARRAY[$1::int]) AS written', [ARC]);
    expect(first.rows[0].written).toBe(2);
    const second = await pool.query<{ written: number }>('SELECT refresh_whole_leaves(ARRAY[$1::int]) AS written', [ARC]);
    expect(second.rows[0].written).toBe(0);
    expect(await fixtureRows()).toEqual([]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { assignExperiencesToRegions, getAssignmentStatus } from './regionAssignmentService.js';

/**
 * A world view's full rebuild clears and re-inserts its automatic assignments
 * in one transaction (#1152), executed against PostgreSQL: what is asserted
 * is what a failure between the clear and the inserts leaves in the tables,
 * which only a real transaction can say.
 *
 * The fixture is a world view of its own: an ocean (9762) with two leaves, a
 * one-degree square of the South Pacific (9761) holding the one point of an
 * experience (9764, its point 9765), and a leaf with no outline (9763) that
 * still carries a stale automatic row for that point and its experience, as
 * a placement before its boundary moved would have left. The world view and
 * the experience are deleted before and after; their dependants cascade.
 */

const WORLD_VIEW_ID = 9760;
const SQUARE_ID = 9761;
const OCEAN_ID = 9762;
const STALE_ID = 9763;
const EXPERIENCE_ID = 9764;
const LOCATION_ID = 9765;
const EARLIER = '2026-09-01T10:00:00Z';
const TRIGGER_FN = 'fixture_9760_refuse_square';

async function clear(): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${TRIGGER_FN} ON experience_location_regions`);
  await pool.query(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
  await pool.query('DELETE FROM experiences WHERE id = $1', [EXPERIENCE_ID]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
}

/** Every region the point is in, at the point's level and the experience's. */
async function placed(): Promise<{ points: number[]; experiences: number[] }> {
  const points = await pool.query<{ region_id: number }>(
    'SELECT region_id FROM experience_location_regions WHERE location_id = $1 ORDER BY region_id',
    [LOCATION_ID],
  );
  const experiences = await pool.query<{ region_id: number }>(
    'SELECT region_id FROM experience_regions WHERE experience_id = $1 ORDER BY region_id',
    [EXPERIENCE_ID],
  );
  return {
    points: points.rows.map(row => row.region_id),
    experiences: experiences.rows.map(row => row.region_id),
  };
}

async function lastAssignmentAt(): Promise<string | null> {
  const { rows } = await pool.query<{ last_assignment_at: Date | null }>(
    'SELECT last_assignment_at FROM world_views WHERE id = $1', [WORLD_VIEW_ID],
  );
  return rows[0].last_assignment_at?.toISOString() ?? null;
}

beforeEach(async () => {
  await clear();
  // Looked up by name: 01-schema.sql inserts the sources ON CONFLICT (name)
  // DO NOTHING, so the id is only an accident of a fresh init.
  const source = await pool.query<{ id: number }>(
    `SELECT id FROM experience_sources WHERE name = 'Art Museums'`,
  );
  expect(source.rowCount).toBe(1);

  await pool.query(
    `INSERT INTO world_views (id, name, is_default, last_assignment_at)
     VALUES ($1, 'Rebuild fixture', false, $2)`,
    [WORLD_VIEW_ID, EARLIER],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf, geom) VALUES
       ($1, $4, 'Ocean', NULL, false, NULL),
       ($2, $4, 'Square', $1, true,
        ST_Multi(ST_MakeEnvelope(-140.5, -40.5, -139.5, -39.5, 4326))),
       ($3, $4, 'Stale', $1, true, NULL)`,
    [OCEAN_ID, SQUARE_ID, STALE_ID, WORLD_VIEW_ID],
  );
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, 'rebuild-9764', 'Rebuild buoy', ST_SetSRID(ST_MakePoint(-140, -40), 4326))`,
    [EXPERIENCE_ID, source.rows[0].id],
  );
  await pool.query(
    `INSERT INTO experience_locations (id, experience_id, name, external_ref, ordinal, location)
     VALUES ($1, $2, 'Buoy', 'B', 0, ST_SetSRID(ST_MakePoint(-140, -40), 4326))`,
    [LOCATION_ID, EXPERIENCE_ID],
  );
  await pool.query(
    `INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
     VALUES ($1, $2, 'auto')`,
    [LOCATION_ID, STALE_ID],
  );
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type)
     VALUES ($1, $2, 'auto')`,
    [EXPERIENCE_ID, STALE_ID],
  );

  // The step's own check, so a scenario that starts wrong says so here.
  expect(await placed()).toEqual({ points: [STALE_ID], experiences: [STALE_ID] });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a full rebuild of a world view', () => {
  it('replaces the stale rows with the regions that hold the point, and stamps the world view', async () => {
    const progress = await assignExperiencesToRegions(WORLD_VIEW_ID);

    expect(progress.status).toBe('complete');
    expect(await placed()).toEqual({
      points: [SQUARE_ID, OCEAN_ID],
      experiences: [SQUARE_ID, OCEAN_ID],
    });
    expect(await lastAssignmentAt()).not.toBe(new Date(EARLIER).toISOString());
  });

  it('leaves the rows from before standing when an insert fails after the clear', async () => {
    // Refuses the square's row: the clear has run by then, in the same
    // transaction, so what stands afterwards is what the rollback kept.
    await pool.query(
      `CREATE FUNCTION ${TRIGGER_FN}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'fixture refuses region %', NEW.region_id; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${TRIGGER_FN} BEFORE INSERT ON experience_location_regions
       FOR EACH ROW WHEN (NEW.region_id = ${SQUARE_ID}) EXECUTE FUNCTION ${TRIGGER_FN}()`,
    );
    try {
      await expect(assignExperiencesToRegions(WORLD_VIEW_ID)).rejects.toThrow(/fixture refuses region/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${TRIGGER_FN} ON experience_location_regions`);
      await pool.query(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
    }

    expect(await placed()).toEqual({ points: [STALE_ID], experiences: [STALE_ID] });
    expect(await lastAssignmentAt()).toBe(new Date(EARLIER).toISOString());
    expect(getAssignmentStatus(WORLD_VIEW_ID)?.status).toBe('failed');
  });
});

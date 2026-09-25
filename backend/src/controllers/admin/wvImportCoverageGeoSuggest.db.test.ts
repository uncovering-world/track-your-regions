import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { geoSuggestGap } from './wvImportCoverageController.js';

/**
 * A coverage gap over the dateline is placed where it is (#1029), executed
 * against PostgreSQL: the point comes from the focus trigger and the distance
 * from PostGIS, which no mocked pool can say.
 *
 * The fixture is its own world view with two assigned regions: a Far East
 * holding a Magadan-like division at 150-165°E, and a Norway holding one that
 * straddles the prime meridian. The gap is a Chukotka-like division in two
 * parts, 170°E to the dateline and the dateline to 172°W. The centre of its
 * envelope is longitude 0, inside the Norway fixture; its anchor point is
 * east of 170°E. Deleted before and after.
 */

const WORLD_VIEW_ID = 9700;
const FAR_EAST = 9701;
const NORWAY = 9702;
const CHUKOT_DIV = 99701;
const MAGADAN_DIV = 99702;
const NORWAY_DIV = 99703;
const ALASKA = 9703;
const SIBERIA = 9704;
const ALASKA_DIV = 99704;
/** Fourteen small divisions along 67°N, 100-152°E: nearer than Alaska in plain degrees, farther on the globe. */
const SIBERIA_DIVS = Array.from({ length: 14 }, (_, i) => 99710 + i);

const CHUKOT = 'MULTIPOLYGON(((170 65, 180 65, 180 70, 170 70, 170 65)), ((-180 65, -172 65, -172 70, -180 70, -180 65)))';
const MAGADAN = 'MULTIPOLYGON(((150 60, 165 60, 165 65, 150 65, 150 60)))';
const NORWAY_GEOM = 'MULTIPOLYGON(((-5 64, 5 64, 5 71, -5 71, -5 64)))';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query(
    'DELETE FROM administrative_divisions WHERE id = ANY($1::int[])',
    [[CHUKOT_DIV, MAGADAN_DIV, NORWAY_DIV, ALASKA_DIV, ...SIBERIA_DIVS]],
  );
}

function answer(): Response & { body?: unknown } {
  const res = {
    status() { return res; },
    json(body: unknown) { res.body = body; return res; },
  } as unknown as Response & { body?: unknown };
  return res;
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, geom) VALUES
       ($1, 'Chukot', ST_GeomFromText($4, 4326)),
       ($2, 'Magadan', ST_GeomFromText($5, 4326)),
       ($3, 'Norway', ST_GeomFromText($6, 4326))`,
    [CHUKOT_DIV, MAGADAN_DIV, NORWAY_DIV, CHUKOT, MAGADAN, NORWAY_GEOM],
  );
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Dateline gap fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name) VALUES ($1, $3, 'Far East'), ($2, $3, 'Norway')`,
    [FAR_EAST, NORWAY, WORLD_VIEW_ID],
  );
  await pool.query(
    'INSERT INTO region_members (region_id, division_id) VALUES ($1, $3), ($2, $4)',
    [FAR_EAST, NORWAY, MAGADAN_DIV, NORWAY_DIV],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('geo-suggest for a gap over the dateline (#1029)', () => {
  it('places the gap at its anchor point and suggests the region beside it, not one on the far side of the world', async () => {
    const res = answer();
    await geoSuggestGap(
      { params: { worldViewId: String(WORLD_VIEW_ID) }, body: { divisionId: CHUKOT_DIV } } as unknown as AuthenticatedRequest,
      res,
    );
    const body = res.body as { suggestion: { targetRegionId: number }; gapCenter: [number, number]; distanceKm: number };

    expect(body.suggestion.targetRegionId).toBe(FAR_EAST);
    // East of 170°E or west of 172°W: on the gap, never near longitude 0.
    expect(Math.abs(body.gapCenter[0])).toBeGreaterThan(170);
    // Chukot's anchor to Magadan's edge is some hundreds of kilometres; from
    // longitude 0 it would have been Norway, at a distance of nothing.
    expect(body.distanceKm).toBeGreaterThan(100);
    expect(body.distanceKm).toBeLessThan(2000);
  });

  it('finds the region just across the dateline, which plain degrees put on the far side of the world', async () => {
    // Alaska at 172-165°W is about 380 km from Chukot's anchor at 179°E, and
    // some 345 degrees from it on a flat map; Magadan and fourteen Siberian
    // divisions are nearer on the flat map and farther on the globe, and fill
    // every candidate slot a single pass has.
    await pool.query(
      `INSERT INTO administrative_divisions (id, name, geom)
       SELECT $1::int, 'Alaska', ST_GeomFromText('MULTIPOLYGON(((-172 64, -165 64, -165 68, -172 68, -172 64)))', 4326)
       UNION ALL
       SELECT id, 'Siberia ' || id, ST_MakeEnvelope(100 + (id - $2::int) * 4, 66.5, 101 + (id - $2::int) * 4, 67.5, 4326)
       FROM unnest($3::int[]) AS id`,
      [ALASKA_DIV, SIBERIA_DIVS[0], SIBERIA_DIVS],
    );
    await pool.query(
      `INSERT INTO regions (id, world_view_id, name) VALUES ($1, $3, 'Alaska'), ($2, $3, 'Siberia')`,
      [ALASKA, SIBERIA, WORLD_VIEW_ID],
    );
    await pool.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1::int, $2::int UNION ALL SELECT $3::int, unnest($4::int[])`,
      [ALASKA, ALASKA_DIV, SIBERIA, SIBERIA_DIVS],
    );

    const res = answer();
    await geoSuggestGap(
      { params: { worldViewId: String(WORLD_VIEW_ID) }, body: { divisionId: CHUKOT_DIV } } as unknown as AuthenticatedRequest,
      res,
    );
    const body = res.body as { suggestion: { targetRegionId: number }; distanceKm: number };

    expect(body.suggestion.targetRegionId).toBe(ALASKA);
    expect(body.distanceKm).toBeLessThan(500);
  });
});

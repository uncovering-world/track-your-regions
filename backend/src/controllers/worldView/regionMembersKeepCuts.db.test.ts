import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { expandToSubregions, flattenSubregion } from './regionMemberOperations.js';
import { mergeChildIntoParent, removeRegionFromImport } from '../admin/wvImportTreeOpsController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { deleteRegion } from './regionCrud.js';

/**
 * A member row that is a cut part of a division stays that part through a
 * hierarchy edit (#1004, #384), executed against PostgreSQL: what is asserted
 * is which rows hold which geometry afterwards, which a mocked pool cannot say.
 *
 * The fixture is its own world view: Europe, with Eastern Europe under it.
 * Eastern Europe holds Russia as two cut parts — west of the Urals and the
 * Urals strip, each with its own name — and Belarus whole. Russia and Belarus
 * are two made-up divisions of this fixture, deleted before and after.
 */

const WORLD_VIEW_ID = 9300;
const EUROPE_ID = 9301;
const EASTERN_ID = 9302;
const SIBERIA_ID = 9303;
const RUSSIA_DIV = 99301;
const BELARUS_DIV = 99302;

const RUSSIA = 'MULTIPOLYGON(((30 50, 60 50, 60 70, 30 70, 30 50)))';
const WEST = 'MULTIPOLYGON(((30 50, 55 50, 55 70, 30 70, 30 50)))';
const URALS = 'MULTIPOLYGON(((55 50, 60 50, 60 70, 55 70, 55 50)))';
const BELARUS = 'MULTIPOLYGON(((23 51, 32 51, 32 56, 23 56, 23 51)))';

interface MemberRow { region_id: number; division_id: number; custom_name: string | null; part: string | null }

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[RUSSIA_DIV, BELARUS_DIV]]);
}

/** Every member row of the fixture's world view, the cut given as the part it is. */
async function members(): Promise<MemberRow[]> {
  const result = await pool.query<MemberRow>(
    `SELECT rm.region_id, rm.division_id, rm.custom_name,
            CASE WHEN rm.custom_geom IS NULL THEN NULL
                 WHEN ST_Equals(rm.custom_geom, ST_GeomFromText($2, 4326)) THEN 'west'
                 WHEN ST_Equals(rm.custom_geom, ST_GeomFromText($3, 4326)) THEN 'urals'
                 ELSE 'other' END AS part
       FROM region_members rm JOIN regions r ON r.id = rm.region_id
      WHERE r.world_view_id = $1
      ORDER BY rm.region_id, rm.division_id, part`,
    [WORLD_VIEW_ID, WEST, URALS],
  );
  return result.rows;
}

/** One order for the rows and the expectation alike. */
function sorted(rows: MemberRow[]): MemberRow[] {
  return [...rows].sort((a, b) => a.region_id - b.region_id || a.division_id - b.division_id
    || String(a.part).localeCompare(String(b.part)));
}

function answer(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
    send() { return res; },
  } as unknown as Response & { statusCode?: number; body?: unknown };
  return res;
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO administrative_divisions (id, name, geom) VALUES
       ($1, 'Russia', ST_GeomFromText($3, 4326)),
       ($2, 'Belarus', ST_GeomFromText($4, 4326))`,
    [RUSSIA_DIV, BELARUS_DIV, RUSSIA, BELARUS],
  );
  await pool.query(
    `INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Cuts fixture', false)`,
    [WORLD_VIEW_ID],
  );
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $3, 'Europe', NULL, false),
       ($2, $3, 'Eastern Europe', $1, true)`,
    [EUROPE_ID, EASTERN_ID, WORLD_VIEW_ID],
  );
  await pool.query(
    `INSERT INTO region_members (region_id, division_id, custom_geom, custom_name) VALUES
       ($1, $2, ST_GeomFromText($4, 4326), 'Russia west of the Urals'),
       ($1, $2, ST_GeomFromText($5, 4326), 'The Urals'),
       ($1, $3, NULL, NULL)`,
    [EASTERN_ID, RUSSIA_DIV, BELARUS_DIV, WEST, URALS],
  );
});

afterEach(clear);
afterAll(() => pool.end());

describe('expanding a region into subregions (#1004)', () => {
  it('makes one subregion per member row, holding what that row held, under its own name', async () => {
    const req = { params: { regionId: String(EASTERN_ID) }, body: {} } as unknown as Request;
    const res = answer();
    await expandToSubregions(req, res);

    const subregions = await pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM regions WHERE parent_region_id = $1 ORDER BY name',
      [EASTERN_ID],
    );
    expect(subregions.rows.map((r) => r.name)).toEqual(['Belarus', 'Russia west of the Urals', 'The Urals']);

    const byName = new Map(subregions.rows.map((r) => [r.name, r.id]));
    expect(sorted(await members())).toEqual(sorted([
      { region_id: byName.get('Russia west of the Urals')!, division_id: RUSSIA_DIV, custom_name: 'Russia west of the Urals', part: 'west' },
      { region_id: byName.get('The Urals')!, division_id: RUSSIA_DIV, custom_name: 'The Urals', part: 'urals' },
      { region_id: byName.get('Belarus')!, division_id: BELARUS_DIV, custom_name: null, part: null },
    ]));
  });
});

describe('deleting a region and moving its members to the parent (#384)', () => {
  it('moves each cut part as the part it is, not as the whole division', async () => {
    const req = {
      params: { regionId: String(EASTERN_ID) },
      query: { moveChildrenToParent: 'true' },
    } as unknown as Request;
    await deleteRegion(req, answer());

    expect(sorted(await members())).toEqual(sorted([
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'Russia west of the Urals', part: 'west' },
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'The Urals', part: 'urals' },
      { region_id: EUROPE_ID, division_id: BELARUS_DIV, custom_name: null, part: null },
    ]));
  });

  it('drops a whole division the parent already holds whole, rather than refusing the move', async () => {
    await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [EUROPE_ID, BELARUS_DIV]);
    const req = {
      params: { regionId: String(EASTERN_ID) },
      query: { moveChildrenToParent: 'true' },
    } as unknown as Request;
    const res = answer();
    await deleteRegion(req, res);

    expect(res.statusCode).toBe(204);
    const belarus = (await members()).filter((m) => m.division_id === BELARUS_DIV);
    expect(belarus).toEqual([{ region_id: EUROPE_ID, division_id: BELARUS_DIV, custom_name: null, part: null }]);
  });
});

describe('flattening a subregion back into its parent (#1004)', () => {
  it('hands the parent the cut part the subregion held, not the whole division', async () => {
    await pool.query(
      `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES ($1, $2, 'Siberia', $3, true)`,
      [SIBERIA_ID, WORLD_VIEW_ID, EASTERN_ID],
    );
    await pool.query(
      `UPDATE region_members SET region_id = $1 WHERE region_id = $2 AND custom_name = 'Russia west of the Urals'`,
      [SIBERIA_ID, EASTERN_ID],
    );
    const req = {
      params: { parentRegionId: String(EASTERN_ID), subregionId: String(SIBERIA_ID) },
    } as unknown as Request;
    await flattenSubregion(req, answer());

    expect(sorted(await members())).toEqual(sorted([
      { region_id: EASTERN_ID, division_id: RUSSIA_DIV, custom_name: 'Russia west of the Urals', part: 'west' },
      { region_id: EASTERN_ID, division_id: RUSSIA_DIV, custom_name: 'The Urals', part: 'urals' },
      { region_id: EASTERN_ID, division_id: BELARUS_DIV, custom_name: null, part: null },
    ]));
  });
});

describe('the import review (#384, #1004)', () => {
  it('moves each cut part to the parent when a region is removed with its divisions kept', async () => {
    const req = {
      params: { worldViewId: String(WORLD_VIEW_ID) },
      body: { regionId: EASTERN_ID, reparentChildren: true, reparentDivisions: true },
    } as unknown as AuthenticatedRequest;
    await removeRegionFromImport(req, answer());

    expect(sorted(await members())).toEqual(sorted([
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'Russia west of the Urals', part: 'west' },
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'The Urals', part: 'urals' },
      { region_id: EUROPE_ID, division_id: BELARUS_DIV, custom_name: null, part: null },
    ]));
  });

  it('keeps the parent\'s own cut of a division when the child it absorbs holds another cut of it', async () => {
    await pool.query(
      `UPDATE region_members SET region_id = $1 WHERE region_id = $2 AND custom_name = 'The Urals'`,
      [EUROPE_ID, EASTERN_ID],
    );
    const req = {
      params: { worldViewId: String(WORLD_VIEW_ID) },
      body: { regionId: EUROPE_ID },
    } as unknown as AuthenticatedRequest;
    await mergeChildIntoParent(req, answer());

    expect(sorted(await members())).toEqual(sorted([
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'Russia west of the Urals', part: 'west' },
      { region_id: EUROPE_ID, division_id: RUSSIA_DIV, custom_name: 'The Urals', part: 'urals' },
      { region_id: EUROPE_ID, division_id: BELARUS_DIV, custom_name: null, part: null },
    ]));
  });
});

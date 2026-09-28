import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { pool } from '../../db/index.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';
import type { CoverageResult } from '../../api/responses/wvImportCoverage.js';

/** The declared route these specs answer through (ADR-0071). */
const getCoverageRoute = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/coverage', 'get');

/**
 * The coverage answer carries one level under each gap (#1030), executed
 * against PostgreSQL: which divisions are gaps is the coverage query's answer,
 * which no mocked pool can give.
 *
 * The fixture is its own world view and a small GADM of its own: Oceania
 * holding New Zealand, which a region covers, and Australia, which none does.
 * Australia holds New South Wales and the Northern Territory; New South Wales
 * holds Sydney. Deleted before and after.
 */

const WORLD_VIEW_ID = 9050;
const REGION = 9051;
const OCEANIA = 99051;
const NEW_ZEALAND = 99052;
const AUSTRALIA = 99053;
const NEW_SOUTH_WALES = 99054;
const NORTHERN_TERRITORY = 99055;
const SYDNEY = 99056;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW_ID]);
  await pool.query(
    'DELETE FROM administrative_divisions WHERE id = ANY($1::int[])',
    [[SYDNEY, NEW_SOUTH_WALES, NORTHERN_TERRITORY, AUSTRALIA, NEW_ZEALAND, OCEANIA]],
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
    `INSERT INTO administrative_divisions (id, name, parent_id, has_children) VALUES
       ($1, 'Oceania', NULL, true),
       ($2, 'New Zealand', $1, false),
       ($3, 'Australia', $1, true),
       ($4, 'New South Wales', $3, true),
       ($5, 'Northern Territory', $3, false),
       ($6, 'Sydney', $4, false)`,
    [OCEANIA, NEW_ZEALAND, AUSTRALIA, NEW_SOUTH_WALES, NORTHERN_TERRITORY, SYDNEY],
  );
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Coverage fixture', false)`, [WORLD_VIEW_ID]);
  await pool.query(`INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, 'New Zealand')`, [REGION, WORLD_VIEW_ID]);
  await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [REGION, NEW_ZEALAND]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the coverage answer', () => {
  it('carries the first level under a gap, and says which of it has more below', async () => {
    const res = answer();
    await answerRoute(getCoverageRoute, { params: { worldViewId: String(WORLD_VIEW_ID) } } as never, res);

    const australia = (res.body as CoverageResult).gaps.find((gap) => gap.id === AUSTRALIA);
    // New South Wales is sent without Sydney: the level below it is read when
    // the reviewer expands it.
    expect(australia?.children).toEqual([
      { id: NEW_SOUTH_WALES, name: 'New South Wales', hasChildren: true },
      { id: NORTHERN_TERRITORY, name: 'Northern Territory', hasChildren: false },
    ]);
  });

  it('sends no level for a gap with nothing under it', async () => {
    await pool.query('DELETE FROM region_members WHERE region_id = $1', [REGION]);
    await pool.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [REGION, AUSTRALIA]);

    const res = answer();
    await answerRoute(getCoverageRoute, { params: { worldViewId: String(WORLD_VIEW_ID) } } as never, res);

    const newZealand = (res.body as CoverageResult).gaps.find((gap) => gap.id === NEW_ZEALAND);
    expect(newZealand).toBeDefined();
    expect(newZealand?.children).toBeUndefined();
  });
});

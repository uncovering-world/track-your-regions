import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperiencesByRegion } from './experienceQueryController.js';
import { experiencesByRegionQuerySchema } from '../../types/index.js';

/**
 * A region's list says, per place, whether the caller may curate it (#613),
 * against PostgreSQL. A curator assigned to Tuscany who opens Italy sees the
 * Uffizi, inside Tuscany, as one to curate, and the Colosseum, placed on
 * Italy itself, as one to read only — and Italy as a region the curator does
 * not curate, so no region-wide action is offered there. The write would be
 * refused in both places; the list says so before the press.
 */

const WORLD_VIEW = 9613;
const ITALY = 96130;
const TUSCANY = 96131;
const UFFIZI = 96132;
const COLOSSEUM = 96133;
const ADMIN_UUID = '00000000-0000-4000-8000-000000009613';
const CURATOR_UUID = '00000000-0000-4000-8000-000000009614';

let adminId = 0;
let curatorId = 0;
let artSource = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[UFFIZI, COLOSSEUM]]);
  await pool.query(
    `DELETE FROM curator_assignments WHERE assigned_by IN (SELECT id FROM users WHERE uuid = ANY($1::text[]))`,
    [[ADMIN_UUID, CURATOR_UUID]],
  );
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN_UUID, CURATOR_UUID]]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

beforeEach(async () => {
  await clear();
  artSource = (await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Art Museums'`))
    .rows[0].id;
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin'), ($2, 'A curator', 'curator')
     RETURNING id`,
    [ADMIN_UUID, CURATOR_UUID],
  );
  [adminId, curatorId] = users.rows.map(row => row.id);
  await pool.query(`INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Can-curate fixture', false)`, [
    WORLD_VIEW,
  ]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
       ($1, $3, 'Italy', NULL, false),
       ($2, $3, 'Tuscany', $1, true)`,
    [ITALY, TUSCANY, WORLD_VIEW],
  );
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location) VALUES
       ($1, $3, 'Q9613-uffizi-fixture', 'Uffizi (can-curate fixture)', ST_SetSRID(ST_MakePoint(11.25528, 43.76778), 4326)),
       ($2, $3, 'Q9613-colosseum-fixture', 'Colosseum (can-curate fixture)', ST_SetSRID(ST_MakePoint(12.49222, 41.89028), 4326))`,
    [UFFIZI, COLOSSEUM, artSource],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
            (experience_id, kind_id, source_id, external_id, curation_state, published_at, admission)
     SELECT e.id, s.kind_id, s.id, e.external_id, 'auto', NOW(), 'admitted'
       FROM experiences e JOIN experience_sources s ON s.id = e.source_id
      WHERE e.id = ANY($1::int[])`,
    [[UFFIZI, COLOSSEUM]],
  );
  // Placed by hand, so the list's membership rule needs no geometry.
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $3, 'manual'), ($2, $4, 'manual')`,
    [UFFIZI, COLOSSEUM, TUSCANY, ITALY],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

async function assign(scope: { region?: number; source?: number }): Promise<void> {
  await pool.query(
    `INSERT INTO curator_assignments (user_id, scope_type, region_id, source_id, assigned_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [curatorId, scope.region ? 'region' : 'source', scope.region ?? null, scope.source ?? null, adminId],
  );
}

async function read(regionId: number, caller: Express.User | undefined) {
  const response = await getExperiencesByRegion({
    params: { regionId },
    query: experiencesByRegionQuerySchema.parse({ includeChildren: 'true' }),
    caller,
  });
  const rows = response.experiences.filter(row => row.id === UFFIZI || row.id === COLOSSEUM);
  return {
    curatesRegion: response.curatesRegion,
    canCurate: Object.fromEntries(rows.map(row => [row.id, row.can_curate])),
  };
}

const curator = (): Express.User => ({ id: curatorId, role: 'curator' }) as Express.User;

describe("a region's list and what the caller may curate (#613)", () => {
  it('offers a Tuscany curator the Uffizi in Italy, and neither the Colosseum nor Italy itself', async () => {
    await assign({ region: TUSCANY });
    expect(await read(ITALY, curator())).toEqual({
      curatesRegion: false,
      canCurate: { [UFFIZI]: true, [COLOSSEUM]: false },
    });
  });

  it('offers the same curator Tuscany as a region to curate', async () => {
    await assign({ region: TUSCANY });
    expect(await read(TUSCANY, curator())).toEqual({ curatesRegion: true, canCurate: { [UFFIZI]: true } });
  });

  it('offers an Italy curator the Uffizi in Tuscany, through the region above it', async () => {
    await assign({ region: ITALY });
    expect(await read(TUSCANY, curator())).toEqual({ curatesRegion: true, canCurate: { [UFFIZI]: true } });
  });

  it("offers a curator of the places' source every place, wherever it sits", async () => {
    await assign({ source: artSource });
    expect((await read(ITALY, curator())).canCurate).toEqual({ [UFFIZI]: true, [COLOSSEUM]: true });
  });

  it('offers an admin everything', async () => {
    expect(await read(ITALY, { id: adminId, role: 'admin' } as Express.User)).toEqual({
      curatesRegion: true,
      canCurate: { [UFFIZI]: true, [COLOSSEUM]: true },
    });
  });

  it('tells a reader nothing about curating', async () => {
    expect(await read(ITALY, undefined)).toEqual({
      curatesRegion: undefined,
      canCurate: { [UFFIZI]: undefined, [COLOSSEUM]: undefined },
    });
  });
});

/**
 * The smoke fixture writes rows a live database keeps, so what it must never
 * do matters as much as what it writes: never touch a database whose name does
 * not say `test`, never leave half a fixture behind. These pin the guard, the
 * one transaction on one client that every row goes through, and the order
 * the rows go in — the deletes before the inserts, the region before its
 * geometry, so the trigger and not the seed fills the derived columns.
 *
 * What each row means for the product is asserted by the smoke specs
 * themselves, against a real database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
}));
vi.mock('../../services/authService.js', () => ({
  hashPassword: vi.fn(async () => '$2a$10$hash'),
}));

import { pool, rollbackQuietly } from '../index.js';
import { E2E_CURATOR, E2E_REGION_ID, E2E_WORLD_VIEW_ID, seedE2eFixture } from './e2eFixture.js';

const mockedPoolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;

type Call = [string, unknown[] | undefined];

/** A client that answers the three reads the seed makes and swallows the rest. */
function makeClient(sources: Array<{ id: number; kind_id: number }>) {
  const client = { query: vi.fn(), release: vi.fn() };
  let nextLocationId = 100;
  client.query.mockImplementation(async (sql: string) => {
    if (/FROM experience_sources/.test(sql)) return { rows: sources };
    if (/INSERT INTO experience_locations[\s\S]*RETURNING id/.test(sql)) {
      return { rows: [{ id: nextLocationId++ }] };
    }
    if (/INSERT INTO users/.test(sql)) return { rows: [{ id: 5 }] };
    return { rows: [] };
  });
  mockedConnect.mockResolvedValue(client);
  return client;
}

const calls = (client: { query: ReturnType<typeof vi.fn> }) => client.query.mock.calls as Call[];
const indexOf = (client: { query: ReturnType<typeof vi.fn> }, pattern: RegExp) =>
  calls(client).findIndex(([sql]) => pattern.test(sql));

beforeEach(() => {
  mockedPoolQuery.mockReset();
  mockedConnect.mockReset();
  mockedRollback.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('DB_NAME', 'track_regions_test');
});

describe('seedE2eFixture', () => {
  it('refuses a database whose name does not say test, before touching the pool', async () => {
    vi.stubEnv('DB_NAME', 'track_regions');

    await expect(seedE2eFixture()).rejects.toThrow(/Refusing to seed "track_regions"/);

    expect(mockedConnect).not.toHaveBeenCalled();
    expect(mockedPoolQuery).not.toHaveBeenCalled();
  });

  it('writes every row inside one transaction on one client', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const sqls = calls(client).map(([sql]) => sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(mockedPoolQuery).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('drops its own rows first, then seeds the region before its geometry', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const deleteExperiences = indexOf(client, /^DELETE FROM experiences WHERE id = ANY\(\$1::int\[\]\)/);
    const deleteWorldView = indexOf(client, /^DELETE FROM world_views WHERE id = \$1/);
    const deleteCurator = indexOf(client, /^DELETE FROM users WHERE email = \$1/);
    const insertRegion = indexOf(client, /INSERT INTO regions \(id, world_view_id, name\)/);
    const regionGeom = indexOf(client, /UPDATE regions SET geom = ST_GeomFromText\(\$1, 4326\)/);
    const firstPlace = indexOf(client, /INSERT INTO experiences \(/);

    expect(calls(client)[deleteExperiences][1]).toEqual([[9001, 9002, 9003, 9004, 9005]]);
    expect(calls(client)[deleteWorldView][1]).toEqual([E2E_WORLD_VIEW_ID]);
    expect(calls(client)[deleteCurator][1]).toEqual([E2E_CURATOR.email]);
    expect(Math.max(deleteExperiences, deleteWorldView, deleteCurator)).toBeLessThan(insertRegion);
    expect(insertRegion).toBeLessThan(regionGeom);
    expect(regionGeom).toBeLessThan(firstPlace);
    expect(calls(client)[regionGeom][1]?.[1]).toBe(E2E_REGION_ID);
  });

  it('publishes the three visible places and holds the two arrivals for the curator', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const memberships = calls(client)
      .filter(([sql]) => /INSERT INTO experience_kind_memberships/.test(sql))
      .map(([, params]) => [params?.[0], params?.[3], params?.[4] instanceof Date]);
    expect(memberships).toEqual([
      [9001, 'auto', true],
      [9002, 'auto', true],
      [9003, 'auto', true],
      [9004, 'pending', false],
      [9005, 'pending', false],
    ]);

    // Every place is placed in the fixture region, by its row and by its point.
    const placements = calls(client).filter(([sql]) => /INSERT INTO experience_regions/.test(sql));
    expect(placements.map(([, params]) => params?.[1])).toEqual(Array(5).fill(E2E_REGION_ID));
    const pointPlacements = calls(client)
      .filter(([sql]) => /INSERT INTO experience_location_regions/.test(sql));
    expect(pointPlacements.map(([, params]) => params?.[0])).toEqual([100, 101, 102, 103, 104]);
  });

  it('seeds the refused point already marked, under the Aqueduct, with no placement', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const refused = calls(client).find(([sql]) => /refused_at/.test(sql));
    expect(refused?.[0]).toMatch(/VALUES \(\$1, \$2, 1, 'pending', NOW\(\)/);
    expect(refused?.[1]?.[0]).toBe(9003);
    // The point's own INSERT does not return an id, so nothing can place it.
    expect(refused?.[0]).not.toMatch(/RETURNING/);
  });

  it('seeds the curator verified, local, and assigned globally by themself', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const user = calls(client).find(([sql]) => /INSERT INTO users/.test(sql));
    expect(user?.[0]).toMatch(/'local', true, 'curator'/);
    expect(user?.[1]).toEqual([E2E_CURATOR.email, '$2a$10$hash']);
    const assignment = calls(client).find(([sql]) => /INSERT INTO curator_assignments/.test(sql));
    expect(assignment?.[0]).toMatch(/VALUES \(\$1, 'global', \$1, 'smoke fixture'\)/);
    expect(assignment?.[1]).toEqual([5]);
  });

  it('rewinds the three sequences the pinned ids skipped', async () => {
    const client = makeClient([{ id: 1, kind_id: 1 }]);

    await seedE2eFixture();

    const rewound = calls(client)
      .map(([sql]) => /pg_get_serial_sequence\('(\w+)', 'id'\)/.exec(sql)?.[1])
      .filter(Boolean);
    expect(rewound).toEqual(['world_views', 'regions', 'experiences']);
  });

  it('rolls back when a seeded source is missing, and hands the rollback verdict to release', async () => {
    const client = makeClient([]);
    const rollbackFailure = new Error('connection gone');
    mockedRollback.mockResolvedValueOnce(rollbackFailure);

    await expect(seedE2eFixture()).rejects.toThrow(/Source "UNESCO World Heritage Sites" missing/);

    expect(calls(client).map(([sql]) => sql)).not.toContain('COMMIT');
    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });
});

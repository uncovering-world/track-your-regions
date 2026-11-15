import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperienceVisitedStatus } from './locationVisitController.js';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());

describe('visited status of a place of several points (#2120)', () => {
  it('reads a site with one of its four parts visited as visited, point by point (ADR-0206)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [1, 2, 3, 4].map(id => ({
      location_id: id, name: `Part ${id}`, ordinal: id, longitude: id, latitude: id, visited_place: true,
      cast_points: false, visit_id: id === 1 ? id : null, marked_at: null, notes: null,
    })) } as never);

    const answer = await getExperienceVisitedStatus({ params: { id: 880 }, caller: { id: 7, role: 'user' } as Express.User });

    expect(answer).toMatchObject({ castPoints: false, totalLocations: 4, visitedLocations: 1, visitedStatus: 'visited' });
    expect(answer.locations.map(location => location.isVisited)).toEqual([true, false, false, false]);
    // The classification must be selected, rather than supplied only by the mock,
    // and the state asked of the visit read's places, the place itself by `$1`.
    const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(sql).toMatch(/e\.cast_points/);
    expect(sql).toMatch(/^\s*WITH ticked AS MATERIALIZED[\s\S]*touched AS \(/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM touched WHERE touched\.place_id = \$1\) AS visited_place/);
  });

  it("reads an edition visited from one visit, since every cast is the edition's own point (ADR-0145)", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [1, 2, 3, 4].map(id => ({
      location_id: id, name: `Cast ${id}`, ordinal: id, longitude: id, latitude: id, visited_place: true,
      cast_points: true, visit_id: 9, marked_at: null, notes: null,
    })) } as never);

    const answer = await getExperienceVisitedStatus({ params: { id: 880 }, caller: { id: 7, role: 'user' } as Express.User });

    expect(answer).toMatchObject({ castPoints: true, totalLocations: 4, visitedLocations: 4, visitedStatus: 'visited' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperienceVisitedStatus } from './locationVisitController.js';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());

describe('visited status of a place of several points (#2120)', () => {
  it('reads a site with one of its four parts visited as partly visited, point by point', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [1, 2, 3, 4].map(id => ({
      location_id: id, name: `Part ${id}`, ordinal: id, longitude: id, latitude: id, ticked: false,
      cast_points: false, visit_id: id === 1 ? id : null, visited_at: null, notes: null,
    })) } as never);

    const answer = await getExperienceVisitedStatus({ params: { id: 880 }, caller: { id: 7, role: 'user' } as Express.User });

    expect(answer).toMatchObject({ castPoints: false, totalLocations: 4, visitedLocations: 1, visitedStatus: 'partial' });
    expect(answer.locations.map(location => location.isVisited)).toEqual([true, false, false, false]);
    // The classification must be selected, rather than supplied only by the mock.
    expect(vi.mocked(pool.query).mock.calls[0][0]).toMatch(/e\.cast_points/);
  });

  it("reads an edition visited from one visit, since every cast is the edition's own point (ADR-0145)", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [1, 2, 3, 4].map(id => ({
      location_id: id, name: `Cast ${id}`, ordinal: id, longitude: id, latitude: id, ticked: true,
      cast_points: true, visit_id: 9, visited_at: null, notes: null,
    })) } as never);

    const answer = await getExperienceVisitedStatus({ params: { id: 880 }, caller: { id: 7, role: 'user' } as Express.User });

    expect(answer).toMatchObject({ castPoints: true, totalLocations: 4, visitedLocations: 4, visitedStatus: 'visited' });
  });
});

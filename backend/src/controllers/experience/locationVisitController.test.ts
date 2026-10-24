import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperienceVisitedStatus } from './locationVisitController.js';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());

describe('visited status of cast points (ADR-0145)', () => {
  it.each([true, false])('keeps the point records and interprets one visit according to the work (casts=%s)', async (castPoints) => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [1, 2, 3, 4].map(id => ({
      location_id: id, name: `Cast ${id}`, ordinal: id, longitude: id, latitude: id,
      cast_points: castPoints, visit_id: id === 1 ? id : null, visited_at: null, notes: null,
    })) } as never);

    const answer = await getExperienceVisitedStatus({ params: { id: 880 }, caller: { id: 7, role: 'user' } as Express.User });

    expect(answer).toMatchObject({
      castPoints, totalLocations: 4, visitedLocations: 1, visitedStatus: castPoints ? 'visited' : 'partial',
    });
    expect(answer.locations.map(location => location.isVisited)).toEqual([true, false, false, false]);
    // The classification must be selected, rather than supplied only by the mock.
    expect(vi.mocked(pool.query).mock.calls[0][0]).toMatch(/e\.cast_points/);
  });
});

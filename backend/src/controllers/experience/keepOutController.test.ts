import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() }, rollbackQuietly: vi.fn() }));
vi.mock('./experienceScope.js', () => ({
  resolveExperienceScope: vi.fn(async () => ({ permitted: true })),
  answeredSourceId: vi.fn(),
}));
vi.mock('./kindAddController.js', () => ({ addableKinds: vi.fn(async () => []) }));
vi.mock('./reviewQueueCrowding.js', () => ({ crowdingOf: vi.fn() }));

import { pool } from '../../db/index.js';
import { listPlaceKinds } from './keepOutController.js';
import { crowdingOf } from './reviewQueueCrowding.js';

/**
 * A place's kinds on its curation dialog say how crowded its city is in each
 * (#2282), from the review card's own count: Schloßplatz in Berlin, a square
 * of Squares & streets, and in Public art, which has no display rule.
 */

const mockedQuery = vi.mocked(pool.query);
const mockedCrowding = vi.mocked(crowdingOf);

const row = (membershipId: number, kindId: number, kindName: string) => ({
  membership_id: membershipId, kind_id: kindId, kind_name: kindName, type: null, state: 'offered',
  reason: null, added: false, answered_at: null, note: null, curator_name: null, can_answer: true,
});

beforeEach(() => {
  mockedQuery.mockReset();
  mockedCrowding.mockReset();
});

describe('listPlaceKinds (#2282)', () => {
  it("gives each kind row its city's crowding, null for a kind the rule does not reach", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as never)
      .mockResolvedValueOnce({ rows: [row(14, 9, 'Squares & streets'), row(15, 3, 'Public art')] } as never);
    const crowded = { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13 };
    mockedCrowding.mockResolvedValue(new Map([[14, crowded]]));

    const { kinds } = await listPlaceKinds({ params: { id: 1014 }, caller: { id: 7, role: 'curator' } as Express.User });

    expect(mockedCrowding).toHaveBeenCalledWith([14, 15], { userId: 7, isAdmin: false });
    expect(kinds.map(kind => [kind.kindName, kind.crowding])).toEqual([
      ['Squares & streets', crowded],
      ['Public art', null],
    ]);
  });
});

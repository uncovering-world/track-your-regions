import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceEvidenceRoutes } from '../../routes/experienceEvidenceRoutes.js';

const query = vi.mocked(pool.query);
const CURATOR = { id: 7, role: 'curator' } as Express.User;
const route = routeAt(experienceEvidenceRoutes, '/review/kind-neighbours/:membershipId');

/** The answer on the declared route, the id as the wire sends it: its status and its body. */
async function read(membershipId: unknown = '88') {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await answer(route, { params: { membershipId }, user: CURATOR }, res);
  return { status: res.status.mock.calls.at(-1)?.[0] ?? 200, body: res.json.mock.calls.at(-1)?.[0] };
}

const KEPT = { place_id: 13815, name: 'Kyaiktiyo Pagoda', image_url: null, image_credit: null };
const REFUSED = {
  place_id: 15020, name: 'Shwedagon Pagoda', image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/S.jpg', image_credit: null,
  reason: '1 Wikipedia editions, under the 2 the surroundings tier asks for',
};

/** The pool's answers in order: the asked membership, its kept neighbour, its refused one. */
function answers(asked: object | null, kept: object | null, refused: object | null) {
  query.mockReset();
  query.mockResolvedValueOnce({ rowCount: asked ? 1 : 0, rows: asked ? [asked] : [] } as never);
  query.mockResolvedValueOnce({ rows: kept ? [kept] : [] } as never);
  query.mockResolvedValueOnce({ rows: refused ? [refused] : [] } as never);
}

beforeEach(() => {
  query.mockReset();
});

describe("an arrival's answered neighbours in its kind (#2185)", () => {
  it('names one kept and one refused place of the same kind and type', async () => {
    answers({ kind_id: 7, type: 'pagoda' }, KEPT, REFUSED);
    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body).toEqual({
      kept: { placeId: 13815, name: 'Kyaiktiyo Pagoda', imageUrl: null, imageCredit: null },
      refused: {
        placeId: 15020, name: 'Shwedagon Pagoda', imageUrl: REFUSED.image_url, imageCredit: null, reason: REFUSED.reason,
      },
    });
  });

  it('keeps to the kind and type, never the place itself, and reads refusals from the log', () => {
    answers({ kind_id: 7, type: 'pagoda' }, null, null);
    return read().then(() => {
      const [, [keptSql, keptParams], [refusedSql, refusedParams]] = query.mock.calls as unknown as [unknown, [string, unknown[]], [string, unknown[]]];
      expect(keptSql).toContain('n.type IS NOT DISTINCT FROM asked.type');
      expect(keptSql).toContain("n.curation_state = 'verified'");
      expect(keptSql).toContain('n.id <> $1');
      expect(keptParams).toEqual([88]);
      expect(refusedSql).toContain("l.action IN ('arrival_refused', 'admission_confirmed')");
      expect(refusedSql).toContain('n.admission_reason AS reason');
      expect(refusedSql).toContain('n.id <> $2');
      expect(refusedParams).toEqual([7, 88, false]);
    });
  });

  it('answers none on either side where no place was answered', async () => {
    answers({ kind_id: 2, type: null }, null, null);
    expect((await read()).body).toEqual({ kept: null, refused: null });
  });

  it('answers 404 for a membership the caller may not be shown, and reads no neighbour', async () => {
    answers(null, KEPT, REFUSED);
    expect((await read()).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refuses an id that is not a row id', async () => {
    await expect(read('abc')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

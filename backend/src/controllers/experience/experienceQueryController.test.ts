import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getExperience } from './experienceQueryController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const EXPERIENCE_ROW = {
  id: 281,
  category_id: 1,
  external_id: 'ext-281',
  name: 'Seowon, Korean Neo-Confucian Academies',
  category: 'cultural',
  category_name: 'UNESCO',
};

// Mirrors the confirmed leak: experience 281 assigned to a region in hidden
// world view 5 ("Administrative") and a region in a visible world view.
const HIDDEN_WV_REGION = { id: 10, name: 'Daegu', world_view_id: 5, world_view_name: 'Administrative' };
const PUBLIC_WV_REGION = { id: 20, name: 'Gyeongju', world_view_id: 1, world_view_name: 'GADM' };

/**
 * Queues the two `pool.query` resolutions `getExperience` consumes in order:
 * the experience row, then the region rows a correctly-filtered query would
 * return. `regionRows` stands in for what Postgres would hand back for the
 * visibility predicate under test; the assertions below separately check
 * that the SQL/params sent actually encode that predicate.
 */
function queueQueries(regionRows: unknown[]) {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValueOnce({ rows: [EXPERIENCE_ROW] });
  mockedQuery.mockResolvedValueOnce({ rows: regionRows });
}

describe('getExperience visibility', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('filters the regions query by visibility, hiding a hidden world view from an anonymous caller but not blanking a public one', async () => {
    queueQueries([PUBLIC_WV_REGION]);
    const res = makeRes();

    await getExperience({ params: { id: '281' } } as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    // Same predicate shape as getWorldViews (worldViewCrud.ts): is_active is
    // unconditional, is_public is bypassed only for admins.
    expect(sql).toMatch(/AND wv\.is_active = true/);
    expect(sql).toMatch(/AND\s*\(\$2::boolean OR wv\.is_public = true\)/);
    expect(params).toEqual([281, false]);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      regions: [PUBLIC_WV_REGION],
    }));
  });

  it('shows every assignment, including a hidden world view, to an admin', async () => {
    queueQueries([HIDDEN_WV_REGION, PUBLIC_WV_REGION]);
    const res = makeRes();

    await getExperience(
      { params: { id: '281' }, user: { role: 'admin' } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([281, true]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      regions: [HIDDEN_WV_REGION, PUBLIC_WV_REGION],
    }));
  });

  it('never 404s the experience itself, even when it has no visible region assignments', async () => {
    // A curator-authenticated non-admin whose only assignment sits in a
    // hidden world view: the association is filtered away entirely, but the
    // experience — public data — must still resolve.
    queueQueries([]);
    const res = makeRes();

    await getExperience(
      { params: { id: '281' }, user: { role: 'curator' } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([281, false]);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 281,
      regions: [],
    }));
  });
});

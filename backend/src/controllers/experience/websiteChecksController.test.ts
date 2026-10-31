import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./experienceScope.js', () => ({ resolveExperienceScope: vi.fn() }));
vi.mock('../../services/websiteCheck/checkWebsite.js', async original => ({
  ...(await original<typeof import('../../services/websiteCheck/checkWebsite.js')>()),
  checkWebsite: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceCurationRoutes } from '../../routes/experienceRoutes.js';
import { checkWebsite } from '../../services/websiteCheck/checkWebsite.js';
import { resolveExperienceScope } from './experienceScope.js';

const route = routeAt(experienceCurationRoutes, '/:id/website-checks', 'get');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;
const mockedCheck = checkWebsite as unknown as ReturnType<typeof vi.fn>;

const CURATOR = { id: 7, role: 'curator' };
/** Villa d'Este on dev, 2026-10-30: the held proposal brings a domain that no longer resolves. */
const VILLA_D_ESTE = 205;

function call(id = VILLA_D_ESTE, user = CURATOR) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return { res, done: answer(route, { params: { id: String(id) }, user } as never, res as never) };
}

describe('the website check of a review card (#2165)', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedScope.mockReset();
    mockedCheck.mockReset();
  });

  it("checks the websites the catalogue holds for the place, and answers each outcome", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://www.villadestetivoli.info/' }, { url: 'http://www.villadestetivoli.info/' }] });
    mockedScope.mockResolvedValue({ permitted: true, logRegionId: null });
    mockedCheck.mockImplementation(async (url: string) => (url.startsWith('https')
      ? { outcome: 'answers', reason: 'answered', status: 200, checkedAt: '2026-10-31T08:00:00.000Z' }
      : { outcome: 'dead', reason: 'domain-not-found', status: null, checkedAt: '2026-10-31T08:00:00.000Z' }));

    const { res, done } = call();
    await done;

    expect(res.json).toHaveBeenCalledWith({ checks: [
      { url: 'https://www.villadestetivoli.info/', outcome: 'answers', reason: 'answered', status: 200, checkedAt: '2026-10-31T08:00:00.000Z' },
      { url: 'http://www.villadestetivoli.info/', outcome: 'dead', reason: 'domain-not-found', status: null, checkedAt: '2026-10-31T08:00:00.000Z' },
    ] });
    // The addresses come from the place's rows, named by its id alone, and the
    // place's website and its proposals' are both read.
    const [sql, params] = mockedQuery.mock.calls[1];
    expect(params).toEqual([VILLA_D_ESTE]);
    expect(sql).toContain("e.metadata->>'website'");
    expect(sql).toContain("f->>'field' = 'metadata.website'");
    expect(sql).toContain('pending_change_sync_log_id');
  });

  it('takes no address from the request: a query naming one is refused before anything runs', async () => {
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await expect(answer(route, { params: { id: String(VILLA_D_ESTE) }, user: CURATOR, query: { url: 'http://169.254.169.254/' } } as never, res as never))
      .rejects.toThrow(/Unrecognized key/);
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('checks nothing for a curator outside the place\'s scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    mockedScope.mockResolvedValue({ permitted: false, logRegionId: null });

    const { res, done } = call();
    await done;

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedCheck).not.toHaveBeenCalled();
    expect(mockedScope).toHaveBeenCalledWith(CURATOR.id, CURATOR.role, VILLA_D_ESTE, 'place');
  });

  it('answers 404 for a place that does not exist, before any scope or fetch', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const { res, done } = call(999_999);
    await done;

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedScope).not.toHaveBeenCalled();
    expect(mockedCheck).not.toHaveBeenCalled();
  });
});

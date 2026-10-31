import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./experienceScope.js', () => ({ resolveExperienceScope: vi.fn() }));
vi.mock('../../services/pictureClass/pictureClasses.js', async original => ({
  ...(await original<typeof import('../../services/pictureClass/pictureClasses.js')>()),
  classifyPictures: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceCurationRoutes } from '../../routes/experienceRoutes.js';
import { classifyPictures } from '../../services/pictureClass/pictureClasses.js';
import { resolveExperienceScope } from './experienceScope.js';

const route = routeAt(experienceCurationRoutes, '/:id/picture-classes', 'get');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;
const mockedClassify = classifyPictures as unknown as ReturnType<typeof vi.fn>;

const CURATOR = { id: 7, role: 'curator' };
/** Banqiao Dam on dev, 2026-10-31: a Bridges & engineering marvels arrival whose picture is a map. */
const BANQIAO_DAM = 40102;
const MAP = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Banqiaomap.png';
/** The 1865 engraving a run proposed for the Saqqara Tablet, an inscription. */
const ENGRAVING = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Saqqara-deRouge-1865.jpg';

function call(id = BANQIAO_DAM, user = CURATOR) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return { res, done: answer(route, { params: { id: String(id) }, user } as never, res as never) };
}

describe("what a review card's pictures are (#2192)", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedScope.mockReset();
    mockedClassify.mockReset();
  });

  it('classes the pictures the catalogue holds for the place, and answers each', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ url: MAP, work_type: null }, { url: ENGRAVING, work_type: 'inscription' }] });
    mockedScope.mockResolvedValue({ permitted: true, logRegionId: null });
    mockedClassify.mockResolvedValue([
      { url: MAP, class: 'map', basis: 'Maps of dams in China', checkedAt: '2026-10-31T08:00:00.000Z' },
      { url: ENGRAVING, class: 'drawing', basis: 'Engravings of Egypt (1865)', checkedAt: '2026-10-31T08:00:00.000Z' },
    ]);

    const { res, done } = call();
    await done;

    expect(res.json).toHaveBeenCalledWith({ classes: [
      { url: MAP, class: 'map', basis: 'Maps of dams in China', checkedAt: '2026-10-31T08:00:00.000Z' },
      { url: ENGRAVING, class: 'drawing', basis: 'Engravings of Egypt (1865)', checkedAt: '2026-10-31T08:00:00.000Z' },
    ] });
    // Each picture with what it is of: the place, or a work with its type.
    expect(mockedClassify).toHaveBeenCalledWith([
      { url: MAP, subject: { kind: 'place' } }, { url: ENGRAVING, subject: { kind: 'work', type: 'inscription' } },
    ]);
    // The pictures come from the place's rows, named by its id alone: its own, each
    // source's, its proposals' (the place's and its works'), its points' and its works'.
    const [sql, params] = mockedQuery.mock.calls[1];
    expect(params).toEqual([BANQIAO_DAM]);
    expect(sql).toContain('e.image_url');
    expect(sql).toContain('m.reported_image_url');
    expect(sql).toContain("f->>'field' = 'imageUrl'");
    expect(sql).toContain('pending_change_sync_log_id');
    expect(sql).toContain('el.image_url');
    expect(sql).toContain('t.image_url');
    expect(sql).toContain('$.fields[*] ? (@.field == "imageUrl").new');
    expect(sql).toContain('t.treasure_type');
    // The proposals before the works' own pictures, so the cap never cuts a question's "after" side.
    expect(sql.indexOf('changed.proposed')).toBeLessThan(sql.indexOf('SELECT 5, t.image_url'));
    expect(sql).toContain('LIMIT 50');
  });

  it('answers 404 for a place that is not there, and 403 outside the curator\'s scope, asking Commons nothing', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const missing = call(99);
    await missing.done;
    expect(missing.res.status).toHaveBeenCalledWith(404);

    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
    mockedScope.mockResolvedValue({ permitted: false, logRegionId: null });
    const outside = call();
    await outside.done;
    expect(outside.res.status).toHaveBeenCalledWith(403);
    expect(mockedClassify).not.toHaveBeenCalled();
  });
});

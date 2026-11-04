/**
 * The world map's hover card asks for one place's picture once the pointer
 * rests on a pin (#927): a light read of the picture and its credit, served
 * only where a reader is offered the place, with the point's own picture when
 * the card names a point — a serial site's part shows its own photograph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { offeredLocationSql, publishedContentSql, readableByIdSql } from '../../db/readerPredicates.js';
import { pointPictureSql } from '../../db/placePoints.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceReadRoutes } from '../../routes/experienceRoutes.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const route = routeAt(experienceReadRoutes, '/:id/picture');

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const credit = {
  author: 'Diliff',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Cologne_Cathedral.jpg',
};

describe('GET /api/experiences/:id/picture', () => {
  beforeEach(() => { mockedQuery.mockReset(); });

  it('answers the picture with its credit', async () => {
    const url = 'https://commons.wikimedia.org/wiki/Special:FilePath/Cologne_Cathedral.jpg';
    mockedQuery.mockResolvedValueOnce({ rows: [{ image_url: url, image_credit: credit }] });
    const res = makeRes();

    await answer(route, { params: { id: '42' } }, res);

    expect(res.json).toHaveBeenCalledWith({ image_url: url, image_credit: credit, point: null });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('answers the point\'s own picture beside the object\'s, asked of a point the place shows a reader', async () => {
    const site = 'https://commons.wikimedia.org/wiki/Special:FilePath/Vladimir_and_Suzdal_montage.jpg';
    const nerl = 'https://commons.wikimedia.org/wiki/Special:FilePath/Church_of_the_Intercession_on_the_Nerl.jpg';
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ image_url: site, image_credit: credit }] })
      .mockResolvedValueOnce({ rows: [{ image_url: nerl, image_credit: credit }] });
    const res = makeRes();

    await answer(route, { params: { id: '42' }, query: { locationId: '7' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      image_url: site, image_credit: credit, point: { image_url: nerl, image_credit: credit },
    });
    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain(pointPictureSql('el'));
    expect(sql).toContain(offeredLocationSql('el'));
    expect(sql).toContain(publishedContentSql('el'));
    expect(sql).toMatch(/el\.experience_id = ANY\(/);
    // A part only beside another point the place shows: the one point of a place is the place.
    expect(sql).toContain('other.id <> el.id');
    expect(sql).toContain(offeredLocationSql('other'));
    expect(params).toEqual([42, 7]);
  });

  it('answers no point for a point the place does not show a reader, or for a place\'s one point', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ image_url: null, image_credit: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answer(route, { params: { id: '42' }, query: { locationId: '7' } }, res);

    expect(res.json).toHaveBeenCalledWith({ image_url: null, image_credit: null, point: null });
  });

  it('answers nulls for a place with no picture, rather than 404', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ image_url: null, image_credit: null }] });
    const res = makeRes();

    await answer(route, { params: { id: '42' } }, res);

    expect(res.json).toHaveBeenCalledWith({ image_url: null, image_credit: null, point: null });
  });

  it('answers 404 for a place no reader is offered, asked with the reader gate and no curator relaxation', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answer(route, { params: { id: '42' }, query: { locationId: '7' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(readableByIdSql('false'));
    expect(params).toEqual([42]);
  });

  it('is a public read with a budget of its own', () => {
    expect(route.access).toBe('public');
    expect(route.limiter).not.toBe(routeAt(experienceReadRoutes, '/:id/locations').limiter);
  });
});

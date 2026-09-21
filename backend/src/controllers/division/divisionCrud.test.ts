/**
 * Every division read answers with the same six fields, the stored focus
 * among them (#674): a producer without `focusBbox` and `anchorPoint` would
 * hand the map nothing to frame. These pin that every read selects the one
 * column list, maps the aliased focus onto the response, and answers 404 for
 * a division that is not there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  getAncestors, getDivisionById, getRootDivisions, getSiblings, getSubdivisions,
} from './divisionCrud.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** A division as the select list returns it: snake_case, the focus aliased. */
const ROW = {
  id: 12,
  name: 'Kiribati',
  parent_id: null,
  has_children: true,
  focus_bbox_json: [169.5, -11.5, -150.2, 4.7],
  anchor_point_json: [-170.35, -3.4],
};

/** The same division as the API answers with it. */
const DIVISION = {
  id: 12,
  name: 'Kiribati',
  parentId: null,
  hasChildren: true,
  focusBbox: [169.5, -11.5, -150.2, 4.7],
  anchorPoint: [-170.35, -3.4],
};

const FOCUS_ALIASES = /AS focus_bbox_json,[\s\S]*AS anchor_point_json/;

function makeRes() {
  return { json: vi.fn() };
}

function makeReq(divisionId: string, query: Record<string, string> = {}) {
  return { params: { divisionId }, query } as never;
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('getRootDivisions', () => {
  it('selects the divisions without a parent, focus included, and maps them', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [ROW] });
    const res = makeRes();

    await getRootDivisions({} as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[] | undefined];
    expect(sql).toMatch(/WHERE parent_id IS NULL/);
    expect(sql).toMatch(FOCUS_ALIASES);
    expect(params).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith([DIVISION]);
  });
});

describe('getDivisionById', () => {
  it('reads one row by id with its focus', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [ROW] });
    const res = makeRes();

    await getDivisionById(makeReq('12'), res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(sql).toMatch(FOCUS_ALIASES);
    expect(params).toEqual([12]);
    expect(res.json).toHaveBeenCalledWith(DIVISION);
  });

  it('answers 404 for an id that is not there', async () => {
    await expect(getDivisionById(makeReq('999'), makeRes() as never))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getSubdivisions', () => {
  it('checks the parent exists before listing its children with their focus', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ ...ROW, id: 13, name: 'Gilbert Islands', parent_id: 12 }] });
    const res = makeRes();

    await getSubdivisions(makeReq('12'), res as never);

    const [existsSql, existsParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(existsSql).toMatch(/SELECT id FROM administrative_divisions WHERE id = \$1/);
    expect(existsParams).toEqual([12]);
    const [listSql, listParams] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(listSql).toMatch(/WHERE parent_id = \$1/);
    expect(listSql).toMatch(FOCUS_ALIASES);
    expect(listParams).toEqual([12, 1000, 0]);
    expect(res.json).toHaveBeenCalledWith([
      { ...DIVISION, id: 13, name: 'Gilbert Islands', parentId: 12 },
    ]);
  });

  it('walks the whole subtree when asked for all, still carrying the focus', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 12 }] });

    await getSubdivisions(makeReq('12', { getAll: 'true' }), makeRes() as never);

    const [listSql] = mockedQuery.mock.calls[1] as [string];
    expect(listSql).toMatch(/WITH RECURSIVE subdivisions AS/);
    expect(listSql).toMatch(FOCUS_ALIASES);
  });

  it('answers 404 for a parent that is not there, without listing', async () => {
    await expect(getSubdivisions(makeReq('999'), makeRes() as never))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});

describe('getAncestors', () => {
  it('walks up from the division with the focus of every step', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [ROW, { ...ROW, id: 13, parent_id: 12 }] });
    const res = makeRes();

    await getAncestors(makeReq('13'), res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WITH RECURSIVE ancestors AS/);
    expect(sql).toMatch(/ORDER BY depth DESC/);
    expect(sql).toMatch(FOCUS_ALIASES);
    expect(params).toEqual([13]);
    expect(res.json).toHaveBeenCalledWith([DIVISION, { ...DIVISION, id: 13, parentId: 12 }]);
  });

  it('answers 404 when the walk finds nothing', async () => {
    await expect(getAncestors(makeReq('999'), makeRes() as never))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getSiblings', () => {
  it('lists the other children of the same parent', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ parent_id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ ...ROW, id: 13, parent_id: 12 }] });
    const res = makeRes();

    await getSiblings(makeReq('13'), res as never);

    const [parentSql, parentParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(parentSql).toMatch(/SELECT parent_id FROM administrative_divisions WHERE id = \$1/);
    expect(parentParams).toEqual([13]);
    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/WHERE parent_id = \$1/);
    expect(sql).toMatch(FOCUS_ALIASES);
    expect(params).toEqual([12]);
    expect(res.json).toHaveBeenCalledWith([{ ...DIVISION, id: 13, parentId: 12 }]);
  });

  it("lists the other roots for a root, since NULL is never '= $1'", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ parent_id: null }] })
      .mockResolvedValueOnce({ rows: [ROW] });
    const res = makeRes();

    await getSiblings(makeReq('12'), res as never);

    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[] | undefined];
    expect(sql).toMatch(/WHERE parent_id IS NULL/);
    expect(params).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith([DIVISION]);
  });

  it('answers 404 for a division that is not there', async () => {
    await expect(getSiblings(makeReq('999'), makeRes() as never))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});

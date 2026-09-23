/**
 * The batch verdicts of the import review's selection toolbar, and the single
 * ones that share their writers: one transaction on one pinned client, the
 * region checked against the world view first, and the answer counted from
 * what the statements changed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../db/index.js', () => ({
  pool: { connect: async () => ({ query: clientQuery, release }) },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => { await c.query('ROLLBACK'); return undefined; },
}));

import { acceptBatchAndRejectRest, rejectBatchSuggestions } from './wvImportMatchDecisions.js';
import { acceptAndRejectRest, rejectMatch } from './wvImportMatchController.js';

// Gibraltar in the development database's Wikivoyage import (world view 2), and
// the three GADM divisions named Gibraltar the matcher offered it.
const WORLD_VIEW = 2;
const GIBRALTAR = 1808;
const OFFERED = [122193, 255003, 275263];

function answering(regionFound = true) {
  clientQuery.mockImplementation(async (sql: string) => {
    if (/FROM regions WHERE id/.test(sql)) return { rows: regionFound ? [{ id: GIBRALTAR }] : [] };
    if (/UPDATE region_match_suggestions SET rejected = true/.test(sql)) return { rows: [], rowCount: 2 };
    return { rows: [], rowCount: 1 };
  });
}

function call(handler: typeof acceptBatchAndRejectRest, body: Record<string, unknown>) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  return handler({ params: { worldViewId: String(WORLD_VIEW) }, body } as never, res as never)
    .then(() => ({ res, body: json.mock.calls[0]?.[0] }));
}

function statements(): string[] {
  return clientQuery.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  clientQuery.mockReset();
  release.mockReset();
});

describe('accepting a selection and rejecting the rest', () => {
  it('writes members for every chosen division and rejects the others, in one transaction', async () => {
    answering();
    const { body } = await call(acceptBatchAndRejectRest, { regionId: GIBRALTAR, divisionIds: OFFERED.slice(0, 2) });

    expect(body).toEqual({ accepted: 2, rejected: 2 });
    const sql = statements();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    const insert = clientQuery.mock.calls.find(c => /INSERT INTO region_members/.test(String(c[0])));
    expect(insert?.[1]).toEqual([GIBRALTAR, [122193, 255003]]);
    expect(sql.some(s => s.includes("match_status = 'manual_matched'"))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('is the single route\'s writer too, for one division', async () => {
    answering();
    const { body } = await call(acceptAndRejectRest, { regionId: GIBRALTAR, divisionId: 275263 });

    expect(body).toEqual({ accepted: true, rejected: true });
    const insert = clientQuery.mock.calls.find(c => /INSERT INTO region_members/.test(String(c[0])));
    expect(insert?.[1]).toEqual([GIBRALTAR, [275263]]);
  });

  it('answers 404 and writes nothing for a region outside the world view', async () => {
    answering(false);
    const { res } = await call(acceptBatchAndRejectRest, { regionId: GIBRALTAR, divisionIds: OFFERED });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(statements()).toEqual([expect.stringContaining('BEGIN'), expect.stringContaining('FROM regions'), 'ROLLBACK']);
  });
});

describe('rejecting a selection', () => {
  it('rejects the chosen suggestions, drops them from the members and sets the status from what is left', async () => {
    answering();
    const { body } = await call(rejectBatchSuggestions, { regionId: GIBRALTAR, divisionIds: OFFERED });

    expect(body).toEqual({ rejected: 2 });
    const sql = statements();
    expect(sql.some(s => s.startsWith('DELETE FROM region_members'))).toBe(true);
    expect(sql.some(s => s.includes("THEN 'needs_review'") && s.includes("ELSE 'no_candidates'"))).toBe(true);
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('is the single route\'s writer too', async () => {
    answering();
    const { body } = await call(rejectMatch, { regionId: GIBRALTAR, divisionId: 122193 });

    expect(body).toEqual({ rejected: true });
    expect(statements()[0]).toBe('BEGIN');
  });
});

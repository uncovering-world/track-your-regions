import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPoolQuery, mockClientQuery, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

import { createManualExperience } from './curationController.js';

const ADMIN = { id: 1, role: 'admin' };
const CATEGORY_ID = 3;
const REGION_ID = 20;
const EXPERIENCE_ID = 555;
const LOCATION_ID = 777;

const BODY = {
  name: 'Hand-placed Overlook',
  shortDescription: 'A curator saw it and typed it in',
  longitude: 10.5,
  latitude: 50.5,
  regionId: REGION_ID,
  categoryId: CATEGORY_ID,
};

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * Queues what `pool.query` answers. The admin role short-circuits
 * `checkCuratorScope` before it asks the database anything, so the only
 * `pool.query` call `createManualExperience` makes is the category lookup.
 * `client.query` then answers the two RETURNING-id inserts the rest of the
 * write depends on, and `{ rows: [] }` for everything else (BEGIN, the two
 * link inserts, the audit log insert, COMMIT).
 */
function queueQueries() {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockPoolConnect.mockClear();
  mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: CATEGORY_ID }] });
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO experiences')) {
      return { rows: [{ id: EXPERIENCE_ID }] };
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO experience_locations')) {
      return { rows: [{ id: LOCATION_ID }] };
    }
    return { rows: [] };
  });
}

function callCreateManualExperience() {
  const res = makeRes();
  return {
    res,
    done: createManualExperience(
      { body: BODY, user: ADMIN } as never,
      res as never,
    ),
  };
}

/** The SQL text of the `client.query` call whose statement matches `pattern`. */
function statementFor(pattern: RegExp): string {
  const call = mockClientQuery.mock.calls.find(
    ([sql]) => typeof sql === 'string' && pattern.test(sql),
  ) as [string, unknown[]] | undefined;
  expect(call, `expected a client.query call matching ${pattern}`).toBeDefined();
  return call![0];
}

describe('createManualExperience curation state', () => {
  beforeEach(() => {
    queueQueries();
  });

  it('writes the experience verified and published now, not read from any gate', async () => {
    const { res, done } = callCreateManualExperience();
    await done;

    const sql = statementFor(/INSERT INTO experiences/);
    expect(sql).toMatch(/curation_state/);
    expect(sql).toMatch(/'verified'/);
    expect(sql).toMatch(/published_at/);
    expect(sql).toMatch(/NOW\(\)/);
    // A person's judgement does not depend on the source's setting: unlike
    // the sync writer, nothing here may read experience_categories at all.
    expect(sql).not.toMatch(/requires_curation/);
    expect(sql).not.toMatch(/CASE/);

    // Both new values are literals, not new bound parameters - the params
    // array is unchanged from before this insert carried them.
    const [, params] = mockClientQuery.mock.calls.find(
      ([callSql]) => typeof callSql === 'string' && /INSERT INTO experiences/.test(callSql),
    ) as [string, unknown[]];
    expect(params).toHaveLength(13);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('writes the location verified too - the curator placed the point by hand', async () => {
    const { done } = callCreateManualExperience();
    await done;

    const sql = statementFor(/INSERT INTO experience_locations/);
    expect(sql).toMatch(/curation_state/);
    expect(sql).toMatch(/'verified'/);
    expect(sql).not.toMatch(/requires_curation/);
    expect(sql).not.toMatch(/CASE/);
  });
});

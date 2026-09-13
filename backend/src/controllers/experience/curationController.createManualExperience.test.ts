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
const KIND_ID = 3;
const SOURCE_ID = 3;
const REGION_ID = 20;
const EXPERIENCE_ID = 555;
const LOCATION_ID = 777;

const BODY = {
  name: 'Hand-placed Overlook',
  shortDescription: 'A curator saw it and typed it in',
  longitude: 10.5,
  latitude: 50.5,
  regionId: REGION_ID,
  kindId: KIND_ID,
};

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * Queues what `pool.query` answers. The admin role short-circuits
 * `checkCuratorScope` before it asks the database anything, so the only
 * `pool.query` call `createManualExperience` makes is the kind's source lookup.
 * `client.query` then answers the two RETURNING-id inserts the rest of the
 * write depends on, and `{ rows: [] }` for everything else (BEGIN, the two
 * link inserts, the audit log insert, COMMIT).
 */
function queueQueries() {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockPoolConnect.mockClear();
  mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: SOURCE_ID }] });
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

  it('writes the membership verified and published now, not read from any gate', async () => {
    const { res, done } = callCreateManualExperience();
    await done;

    // The state is the membership's (#822): the place carries none, and the
    // membership is written in the same transaction, for the kind the chosen
    // source fills.
    const place = statementFor(/INSERT INTO experiences/);
    expect(place).not.toMatch(/curation_state/);
    expect(place).not.toMatch(/published_at/);

    const membership = statementFor(/INSERT INTO experience_kind_memberships/);
    expect(membership).toMatch(/curation_state/);
    expect(membership).toMatch(/'verified'/);
    expect(membership).toMatch(/published_at/);
    expect(membership).toMatch(/NOW\(\)/);
    expect(membership).toMatch(/\(SELECT kind_id FROM experience_sources WHERE id = \$2\)/);
    // A person's judgement does not depend on the source's setting: unlike
    // the sync writer, nothing here may read the gate at all.
    expect(membership).not.toMatch(/requires_curation/);
    expect(membership).not.toMatch(/CASE/);
    const [, membershipParams] = mockClientQuery.mock.calls.find(
      ([callSql]) => typeof callSql === 'string' && /INSERT INTO experience_kind_memberships/.test(callSql),
    ) as [string, unknown[]];
    expect(membershipParams).toEqual([EXPERIENCE_ID, SOURCE_ID]);

    // The state values are literals, not new bound parameters - the place's
    // params array is unchanged from before the split.
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

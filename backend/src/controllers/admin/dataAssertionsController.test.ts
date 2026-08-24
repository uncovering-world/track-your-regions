/**
 * The two things a screen may do, and the two it may not.
 *
 * Accepting a number is how a rule the catalogue cannot pass today stops
 * blocking everything else, and equally how a defect gets quietly buried — so
 * what it records has to be a measurement the server took, one assertion at a
 * time, and never a figure the browser supplied.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { catalogueAssertions } from './dataAssertions/catalogueAssertions.js';
import { acceptDataAssertion, getDataAssertions } from './dataAssertionsController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

// `null` rather than `undefined` for "nobody is signed in": passing `undefined`
// to a defaulted parameter selects the default, which would have made the
// unauthenticated case quietly test the authenticated one.
const asRequest = (body: unknown, userId: number | null = 7) =>
  ({ body, user: userId === null ? undefined : { id: userId } } as unknown as AuthenticatedRequest);

/**
 * What Postgres answers when the table is not there — the code, not the words,
 * because the code is what the controller is allowed to diagnose from.
 */
function missingTable(): Error {
  return Object.assign(new Error('relation "data_assertion_acceptances" does not exist'), { code: '42P01' });
}

/** What it answers when an admin's account has been deleted under their token. */
function foreignKeyViolation(): Error {
  return Object.assign(new Error('insert violates foreign key constraint'), { code: '23503' });
}

/** Every assertion answers with nothing, then the acceptance read answers with nothing. */
function everythingClear() {
  mockedQuery.mockResolvedValue({ rows: [] });
}

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('the report', () => {
  it('sends every assertion, including the ones with nothing to say', async () => {
    everythingClear();
    const res = fakeRes();
    await getDataAssertions({} as AuthenticatedRequest, res as never);

    const body = res.body as { assertions: { id: string }[]; needsAttention: number };
    // A panel showing only the assertions in trouble leaves an admin unable to
    // tell "nothing is wrong" from "nothing ran".
    expect(body.assertions.map(a => a.id)).toEqual(catalogueAssertions.map(a => a.id));
    expect(body.needsAttention).toBe(0);
  });
});

describe('a database whose ledger is not there yet', () => {
  it('reports every check and names the migration, rather than answering with a 500', async () => {
    // The table arrives with a migration applied by hand, so every existing
    // database passes through this state exactly once — at the moment somebody
    // opens the screen for the first time.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (/data_assertion_acceptances/.test(sql)) throw missingTable();
      return { rows: [] };
    });
    const res = fakeRes();
    await getDataAssertions({} as AuthenticatedRequest, res as never);

    const body = res.body as { assertions: unknown[]; acceptancesUnavailable: string | null };
    expect(res.statusCode).toBe(200);
    expect(body.assertions).toHaveLength(catalogueAssertions.length);
    expect(body.acceptancesUnavailable).toMatch(/031-data-assertion-acceptances\.sql/);
  });

  it('answers an acceptance with the same sentence rather than a stack trace', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO data_assertion_acceptances/.test(sql)) throw missingTable();
      return { rows: [] };
    });
    const res = fakeRes();
    await acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }), res as never);

    expect(res.statusCode).toBe(503);
    expect((res.body as { error: string }).error).toMatch(/031-data-assertion-acceptances\.sql/);
  });
});

describe('a ledger failure that is not a missing table', () => {
  it('does not tell an admin to apply a migration that is already applied', async () => {
    // Reachable without any infrastructure trouble: `requireAuth` verifies a
    // JWT and never looks the account up, so a deleted admin's still-valid
    // token reaches the insert and `accepted_by` answers 23503.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO data_assertion_acceptances/.test(sql)) throw foreignKeyViolation();
      return { rows: [] };
    });
    const res = fakeRes();

    await expect(acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }), res as never))
      .rejects.toThrow(/foreign key/);
    expect(res.body).toBeUndefined();
  });

  it('says the report could not read it, without borrowing the migration sentence', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (/DISTINCT ON/.test(sql)) throw foreignKeyViolation();
      return { rows: [] };
    });
    const res = fakeRes();
    await getDataAssertions({} as AuthenticatedRequest, res as never);

    const body = res.body as { acceptancesUnavailable: string | null };
    expect(body.acceptancesUnavailable).toMatch(/could not be read/);
    expect(body.acceptancesUnavailable).not.toMatch(/031-data-assertion-acceptances/);
  });
});

describe('reading the ledger back after writing to it', () => {
  it('answers with the row it wrote when the read-back fails', async () => {
    // `readAcceptedNumbers` never throws, so a pool error here would otherwise
    // come back as no accepted number at all — and the panel would show
    // "nobody has answered for this" beside a snackbar saying it is carried.
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ accepted_at: new Date('2026-08-24T10:00:00Z') }] })
      .mockRejectedValueOnce(new Error('connection terminated'));
    const res = fakeRes();

    await acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }), res as never);

    const body = res.body as { accepted: number; status: string; needsAttention: boolean; acceptedBy: string | null };
    expect(body.accepted).toBe(2);
    expect(body.status).toBe('holding');
    expect(body.needsAttention).toBe(false);
    // The one thing that read was for, and the only thing lost with it.
    expect(body.acceptedBy).toBeNull();
  });
});

describe('accepting a number', () => {
  it('records what the server measures, not what the request says', async () => {
    // Three rows come back from the re-run; the request carries no count at all,
    // and could not be believed if it did.
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ accepted_at: new Date('2026-08-24T10:00:00Z') }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = fakeRes();

    await acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }), res as never);

    const insert = mockedQuery.mock.calls.find(call => /INSERT INTO data_assertion_acceptances/.test(String(call[0])));
    expect(insert).toBeDefined();
    expect(insert?.[1]).toEqual(['held-by-no-region', 3, 7]);
    expect(res.statusCode).toBe(200);
  });

  it('refuses an assertion nobody has heard of', async () => {
    const res = fakeRes();
    await acceptDataAssertion(asRequest({ assertionId: 'not-a-rule' }), res as never);

    expect(res.statusCode).toBe(404);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('refuses a watch, whose count is a number to watch rather than a debt', async () => {
    const res = fakeRes();
    await acceptDataAssertion(asRequest({ assertionId: 'visits-on-places-no-reader-is-shown' }), res as never);

    // ADR-0022 makes those rows legitimate: there is nothing to answer for, so
    // refusing is the honest answer to a button that should not exist.
    expect(res.statusCode).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('records nothing when the assertion could not be run', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation does not exist'));
    const res = fakeRes();

    await acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }), res as never);

    // A zero written here would turn a broken query into a clean bill of health,
    // and the next report would read its silence as debt somebody answered for.
    expect(res.statusCode).toBe(503);
    expect(mockedQuery.mock.calls.some(call => /INSERT/.test(String(call[0])))).toBe(false);
  });

  it('refuses an unauthenticated request rather than recording an anonymous decision', async () => {
    const res = fakeRes();
    await acceptDataAssertion(asRequest({ assertionId: 'held-by-no-region' }, null), res as never);

    expect(res.statusCode).toBe(401);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

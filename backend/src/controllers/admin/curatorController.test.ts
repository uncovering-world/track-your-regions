/**
 * Tests for the two writes that grant and take back a curator's scope.
 *
 * Both are transactions for the same reason: a scope row and the role that
 * answers for it are one fact in two tables. A `curator_assignments` row whose
 * user is still `user` reaches no curation screen, and a `curator` role with no
 * row left grants powers over nothing — either half alone is a state no screen
 * in the product can explain.
 *
 * What is asserted here is not that the statements ran but that they ran on the
 * one connection the handler checked out (#532). `pool.query('BEGIN')` reads as
 * a transaction and is not one: pg.Pool hands out an arbitrary idle client per
 * call and releases it with the transaction still open, so the promotion may
 * land on another connection — and a *different admin's* write that checks out
 * the leaked client is swept into the stray transaction and dies with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { createCuratorAssignment, revokeCuratorAssignment } from './curatorController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
/** The same mock, in its callable shape: `vi.fn()`'s own type is not callable. */
const answer = mockedQuery as unknown as (sql: string, params?: unknown[]) => Promise<unknown>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/** The client the handler must pin; its statements answer from the pool's mock. */
function pinClient() {
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => answer(sql, params)),
    release: vi.fn(),
  };
  mockedConnect.mockResolvedValue(client);
  return client;
}

/** What the pinned client was asked, in order. */
function clientSql(client: ReturnType<typeof pinClient>): string[] {
  return client.query.mock.calls.map(call => String(call[0]));
}

/** A reader being given, or losing, the curator's chair over Algeria. */
const ALGERIA = 3;
const CANDIDATE = 214;
const ADMIN = { id: 1 };

/**
 * Answers each statement by what it asks for, so a handler's own order of
 * questions — not a fixture's order — decides what comes back.
 *
 * `role` and `lockedRole` are separate on purpose: the first answers the
 * reference check, which runs outside any transaction, and the second answers
 * the read under `FOR NO KEY UPDATE`. Letting a test set them apart is how the
 * "decided from the locked read" rule can be asserted at all.
 */
function answering(
  overrides: { role?: string; lockedRole?: string; remaining?: string } = {},
) {
  mockedQuery.mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (/FROM users/i.test(text) && /SELECT/i.test(text)) {
      const role = /FOR NO KEY UPDATE/i.test(text)
        ? overrides.lockedRole ?? overrides.role ?? 'user'
        : overrides.role ?? 'user';
      return { rows: [{ id: CANDIDATE, role }] };
    }
    if (/FROM regions/i.test(text)) return { rows: [{ id: ALGERIA }] };
    if (/FROM curator_assignments/i.test(text) && /COUNT/i.test(text)) {
      return { rows: [{ count: overrides.remaining ?? '0' }] };
    }
    if (/FROM curator_assignments/i.test(text)) {
      return { rows: [{ id: 77, user_id: CANDIDATE }] };
    }
    if (/INSERT INTO curator_assignments/i.test(text)) {
      return { rows: [{ id: 77, assigned_at: new Date('2026-08-23T10:00:00Z') }] };
    }
    return { rows: [], rowCount: 1 };
  });
}

/** Make one statement of the transaction fail, leaving the rest answering. */
function failOn(statement: RegExp, message: string) {
  const answering = mockedQuery.getMockImplementation() as
    (sql: string, params?: unknown[]) => Promise<unknown>;
  mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (statement.test(String(sql))) throw new Error(message);
    return answering(sql, params);
  });
}

describe('granting a curator their scope', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    answering();
  });

  it('writes the scope and the promotion on one pinned client', async () => {
    const client = pinClient();
    const res = makeRes();

    await createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region', regionId: ALGERIA },
      user: ADMIN,
    } as never, res as never);

    const onClient = clientSql(client);
    expect(onClient[0]).toBe('BEGIN');
    expect(onClient.at(-1)).toBe('COMMIT');
    expect(onClient.filter(sql => /INSERT INTO curator_assignments/i.test(sql))).toHaveLength(1);
    expect(onClient.filter(sql => /UPDATE users SET role = 'curator'/i.test(sql))).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('leaves the role alone for someone who already curates elsewhere', async () => {
    answering({ role: 'curator', lockedRole: 'curator' });
    const client = pinClient();

    await createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region', regionId: ALGERIA },
      user: ADMIN,
    } as never, makeRes() as never);

    // A second scope is not a second promotion; the row is all that is new.
    expect(clientSql(client).filter(sql => /UPDATE users/i.test(sql))).toHaveLength(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('takes the user row under the lock before it writes anything', async () => {
    const client = pinClient();

    await createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region', regionId: ALGERIA },
      user: ADMIN,
    } as never, makeRes() as never);

    // Ordering is the assertion, not the presence of the lock: a lock taken
    // after the INSERT serialises nothing that has already happened.
    const onClient = clientSql(client);
    const locked = onClient.findIndex(sql => /FROM users[\s\S]*FOR NO KEY UPDATE/i.test(sql));
    const inserted = onClient.findIndex(sql => /INSERT INTO curator_assignments/i.test(sql));
    expect(locked).toBe(1);
    expect(locked).toBeLessThan(inserted);
  });

  it('decides the promotion from the locked read, not the check before it', async () => {
    // The reference check saw `user`; by the time the transaction opened, a
    // concurrent grant had already promoted them. Deciding from the stale read
    // would write the promotion a second time — harmless here — but the same
    // staleness in the other direction is what demotes a live curator.
    answering({ role: 'user', lockedRole: 'curator' });
    const client = pinClient();
    const res = makeRes();

    await createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region', regionId: ALGERIA },
      user: ADMIN,
    } as never, res as never);

    expect(clientSql(client).filter(sql => /UPDATE users/i.test(sql))).toHaveLength(0);
    const [payload] = res.json.mock.calls[0] as [{ rolePromoted: boolean }];
    expect(payload.rolePromoted).toBe(false);
  });

  it('rolls back and hands the connection back when the promotion fails', async () => {
    const client = pinClient();
    failOn(/UPDATE users/i, 'could not serialize access');

    await expect(createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region', regionId: ALGERIA },
      user: ADMIN,
    } as never, makeRes() as never)).rejects.toThrow('could not serialize access');

    // The scope row must not survive the promotion that failed, and the
    // connection must not go back to the pool still inside the transaction.
    expect(clientSql(client)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('never opens the transaction for input the validator refuses', async () => {
    const client = pinClient();
    const res = makeRes();

    // Region scope with no region names nothing to curate.
    await createCuratorAssignment({
      body: { userId: CANDIDATE, scopeType: 'region' }, user: ADMIN,
    } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedConnect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('taking a curator scope back', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    answering();
  });

  it('deletes the scope and demotes on one pinned client', async () => {
    const client = pinClient();
    const res = makeRes();

    answering({ role: 'curator', lockedRole: 'curator', remaining: '0' });

    await revokeCuratorAssignment(
      { params: { assignmentId: '77' } } as never, res as never);

    const onClient = clientSql(client);
    expect(onClient[0]).toBe('BEGIN');
    expect(onClient.at(-1)).toBe('COMMIT');
    expect(onClient.filter(sql => /DELETE FROM curator_assignments/i.test(sql))).toHaveLength(1);
    // The count that decides the demotion is read inside the transaction that
    // did the delete; on a shared connection it could count rows a concurrent
    // revoke had not committed.
    expect(onClient.filter(sql => /COUNT\(\*\)/i.test(sql))).toHaveLength(1);
    expect(onClient.filter(sql => /UPDATE users SET role = 'user'/i.test(sql))).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 77, userId: CANDIDATE, remainingAssignments: 0, roleReverted: true,
    }));
  });

  it('keeps the role of a curator who still holds another scope', async () => {
    answering({ role: 'curator', lockedRole: 'curator', remaining: '2' });
    const client = pinClient();
    const res = makeRes();

    await revokeCuratorAssignment(
      { params: { assignmentId: '77' } } as never, res as never);

    expect(clientSql(client).filter(sql => /UPDATE users/i.test(sql))).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      remainingAssignments: 2, roleReverted: false,
    }));
  });

  it('rolls back and hands the connection back when the delete fails', async () => {
    const client = pinClient();
    failOn(/DELETE FROM curator_assignments/i, 'deadlock detected');

    await expect(revokeCuratorAssignment(
      { params: { assignmentId: '77' } } as never, makeRes() as never,
    )).rejects.toThrow('deadlock detected');

    expect(clientSql(client)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('takes the user row under the lock before it deletes', async () => {
    const client = pinClient();

    await revokeCuratorAssignment(
      { params: { assignmentId: '77' } } as never, makeRes() as never);

    // The same order granting uses, which is what keeps the two from
    // deadlocking on each other rather than merely serialising.
    const onClient = clientSql(client);
    const locked = onClient.findIndex(sql => /FROM users[\s\S]*FOR NO KEY UPDATE/i.test(sql));
    const deleted = onClient.findIndex(sql => /DELETE FROM curator_assignments/i.test(sql));
    expect(locked).toBe(1);
    expect(locked).toBeLessThan(deleted);
  });

  it('answers 404, and touches no role, when the delete removes nothing', async () => {
    // Another admin revoked it between the read that found it and this
    // transaction. Reporting success for a delete that removed nothing is the
    // misleading half; demoting on a count taken for somebody else's decision
    // is the damaging one.
    const client = pinClient();
    const res = makeRes();
    answering({ role: 'curator', lockedRole: 'curator', remaining: '0' });
    const answers = mockedQuery.getMockImplementation() as
      (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => (
      /DELETE FROM curator_assignments/i.test(String(sql))
        ? { rows: [], rowCount: 0 }
        : answers(sql, params)
    ));

    await revokeCuratorAssignment(
      { params: { assignmentId: '77' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    const onClient = clientSql(client);
    expect(onClient).toContain('ROLLBACK');
    expect(onClient).not.toContain('COMMIT');
    expect(onClient.filter(sql => /COUNT\(\*\)/i.test(sql))).toHaveLength(0);
    expect(onClient.filter(sql => /UPDATE users/i.test(sql))).toHaveLength(0);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

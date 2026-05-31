import { describe, expect, it, vi, beforeEach } from 'vitest';

const { query, release, connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect };
});
vi.mock('../db/index.js', () => ({ pool: { connect } }));

import { maybePromoteToAdmin } from './adminBootstrap.js';

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockClear();
  query.mockResolvedValue({ rows: [] });
});

describe('maybePromoteToAdmin', () => {
  it('promotes the first verified dev user and always releases the client', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_EMAIL;
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE')) return { rowCount: 1, rows: [] };
      return { rows: [] }; // BEGIN, advisory lock, SELECT (no admin yet), COMMIT
    });
    const promoted = await maybePromoteToAdmin(42, 'me@x.com', true);
    expect(promoted).toBe(true);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE users SET role'))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not UPDATE when an admin already exists', async () => {
    process.env.NODE_ENV = 'development';
    query.mockImplementation(async (sql: string) =>
      !sql.startsWith('UPDATE') && sql.includes("role = 'admin'")
        ? { rows: [{ '?column?': 1 }] }
        : { rows: [] },
    );
    const promoted = await maybePromoteToAdmin(42, 'me@x.com', true);
    expect(promoted).toBe(false);
    expect(query.mock.calls.map((c) => String(c[0])).some((s) => s.startsWith('UPDATE'))).toBe(false);
  });

  it('rolls back, releases, and rethrows the original error when a query throws', async () => {
    process.env.NODE_ENV = 'development';
    const boom = new Error('db exploded');
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'admin'")) throw boom;
      return { rows: [] };
    });
    await expect(maybePromoteToAdmin(42, 'me@x.com', true)).rejects.toBe(boom);
    expect(query.mock.calls.map((c) => String(c[0]))).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('surfaces the original error even if ROLLBACK itself throws', async () => {
    process.env.NODE_ENV = 'development';
    const boom = new Error('original failure');
    query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed too');
      if (sql.includes("role = 'admin'")) throw boom;
      return { rows: [] };
    });
    await expect(maybePromoteToAdmin(42, 'me@x.com', true)).rejects.toBe(boom);
    expect(release).toHaveBeenCalledOnce();
  });
});

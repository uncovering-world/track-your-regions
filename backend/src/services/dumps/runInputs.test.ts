/**
 * A run's row and the copies it reads, written as one transaction (#2415):
 * a failure between the two leaves no `running` row behind, and a client whose
 * ROLLBACK failed is never handed back to the pool, which would reuse it with
 * the transaction still open. `swapGuard.db.test.ts` holds the lock's order
 * against PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../../db/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db/index.js')>()),
  pool: { connect: vi.fn(async () => client), query: vi.fn() },
}));
const keeper = vi.hoisted(() => ({ latest: vi.fn() }));
vi.mock('./keepers.js', () => ({ keeperOf: () => keeper }));

const { openRunLog } = await import('./runInputs.js');

/** The statements the client was sent, by their first word. */
const sent = () => client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);

beforeEach(() => {
  client.query.mockReset().mockResolvedValue({ rows: [] });
  client.release.mockReset();
  keeper.latest.mockReset().mockResolvedValue({ dumpDate: '2026-11-01' });
});

describe("a run's row and the copies it reads (#2415)", () => {
  it('writes both in one transaction and hands the client back', async () => {
    expect(await openRunLog(async () => 859)).toBe(859);
    expect(sent()).toEqual(['SELECT', 'BEGIN', 'UPDATE', 'COMMIT', 'SELECT']);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('rolls the row back when the copies cannot be read', async () => {
    keeper.latest.mockRejectedValue(new Error('the subset is being swapped'));
    await expect(openRunLog(async () => 859)).rejects.toThrow('the subset is being swapped');
    expect(sent()).toContain('ROLLBACK');
    expect(sent()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('discards a client whose ROLLBACK failed, with the rollback\'s own error', async () => {
    keeper.latest.mockRejectedValue(new Error('the subset is being swapped'));
    const refused = new Error('ROLLBACK refused');
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw refused;
      return { rows: [] };
    });
    await expect(openRunLog(async () => 859)).rejects.toThrow('the subset is being swapped');
    expect(client.release).toHaveBeenCalledWith(refused);
  });
});

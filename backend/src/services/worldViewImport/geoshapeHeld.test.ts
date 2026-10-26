import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));

const { geoshapeHeld } = await import('./geoshapeCache.js');

describe('geoshapeHeld (#2084)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    poolQuery.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('answers from the store and asks no one for a shape it does not hold', async () => {
    poolQuery.mockResolvedValue({ rows: [{ held: false }] });

    expect(await geoshapeHeld('Q463871')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(poolQuery.mock.calls.some(([sql]) => /INSERT|UPDATE/i.test(String(sql)))).toBe(false);
  });

  it('answers yes for a shape the store holds', async () => {
    poolQuery.mockResolvedValue({ rows: [{ held: true }] });

    expect(await geoshapeHeld('Q463871')).toBe(true);
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('not_available = FALSE'), ['Q463871']);
  });
});

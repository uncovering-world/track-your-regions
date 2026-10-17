import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));

const negativeCached = () => poolQuery.mock.calls.some(([sql]) => String(sql).includes('not_available) VALUES ($1, TRUE)'));

async function freshFetch() {
  vi.resetModules();
  return (await import('./geoshapeCache.js')).getOrFetchGeoshape;
}

describe('getOrFetchGeoshape on a failure (#1628)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('remembers nothing when the request itself fails, so the item is asked again', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    const getOrFetchGeoshape = await freshFetch();

    expect(await getOrFetchGeoshape('Q463871')).toBe(false);
    expect(negativeCached()).toBe(false);
  });

  it('remembers none when the shape Wikimedia sent cannot be stored', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('ST_GeomFromGeoJSON')) throw new Error('invalid GeoJSON representation');
      return { rows: [] };
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ features: [{ geometry: { type: 'Polygon', coordinates: [] } }] })));
    const getOrFetchGeoshape = await freshFetch();

    expect(await getOrFetchGeoshape('Q463871')).toBe(false);
    expect(negativeCached()).toBe(true);
  });
});

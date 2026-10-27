import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));

const { getOrFetchCommonsMapGeoshape } = await import('./geoshapeCache.js');

const FILE = 'North_Sea_Coast_region.map';
const SQUARE = { type: 'Polygon', coordinates: [[[7, 53], [8, 53], [8, 54], [7, 54], [7, 53]]] };

/** The Action API's answer for one `Data:` page, its content the map file's JSON. */
function actionAnswer(map: unknown): Response {
  const pages = map === undefined
    ? [{ title: `Data:${FILE}`, missing: true }]
    : [{ title: `Data:${FILE}`, revisions: [{ slots: { main: { contentmodel: 'Map.JsonConfig', content: JSON.stringify(map) } } }] }];
  return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
}

const writes = () => poolQuery.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));

describe('getOrFetchCommonsMapGeoshape keeps the file\'s licence (#2085)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    poolQuery.mockReset();
    // Nothing cached; every write succeeds.
    poolQuery.mockResolvedValue({ rows: [] });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // The fetch slot spaces calls by wall time: each test starts well after the last.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('reads the file through the Action API and stores its shape with its licence and sources', async () => {
    fetchSpy.mockResolvedValue(actionAnswer({
      license: 'ODbL-1.0',
      sources: 'Based on [[OpenStreetMap]] data',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: SQUARE, properties: { title: '[[North Sea Coast]]', fill: '#a0c0e0' } }] },
    }));

    const meta = await getOrFetchCommonsMapGeoshape(FILE);

    expect(meta).toEqual({ available: true, title: 'North Sea Coast', color: '#a0c0e0' });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(url.searchParams.get('titles')).toBe(`Data:${FILE}`);
    expect(url.searchParams.get('rvslots')).toBe('main');
    const [[sql, params]] = writes();
    expect(String(sql)).toMatch(/licence = EXCLUDED\.licence/);
    expect(params).toEqual([`commons:${FILE}`, JSON.stringify(SQUARE), 'ODbL-1.0', 'Based on OpenStreetMap data']);
  });

  it('keeps a file that declares no licence as no shape', async () => {
    fetchSpy.mockResolvedValue(actionAnswer({
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: SQUARE }] },
    }));

    expect(await getOrFetchCommonsMapGeoshape(FILE)).toEqual({ available: false });
    const [[sql, params]] = writes();
    expect(String(sql)).toMatch(/not_available\) VALUES \(\$1, TRUE\)/);
    expect(params).toEqual([`commons:${FILE}`]);
  });

  it('keeps a missing page as no shape', async () => {
    fetchSpy.mockResolvedValue(actionAnswer(undefined));

    expect(await getOrFetchCommonsMapGeoshape(FILE)).toEqual({ available: false });
    expect(writes()).toHaveLength(1);
    expect(String(writes()[0][0])).toMatch(/not_available\) VALUES \(\$1, TRUE\)/);
  });

  it('stores nothing when Commons is busy, so the next match asks again', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 503 }));

    expect(await getOrFetchCommonsMapGeoshape(FILE)).toEqual({ available: false });
    expect(writes()).toHaveLength(0);
  });

  it('stores nothing when the Action API answers a refusal, so the next match asks again', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'maxlag', info: 'Waiting for a database server' } }), { status: 200 }));

    expect(await getOrFetchCommonsMapGeoshape(FILE)).toEqual({ available: false });
    expect(writes()).toHaveLength(0);
  });

  it('answers a stored file from the store without asking Commons', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ not_available: false }] });

    expect(await getOrFetchCommonsMapGeoshape(FILE)).toEqual({ available: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

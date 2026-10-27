import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));

const { shapeCredit, shapeCreditsFor } = await import('./shapeCredit.js');

describe('shapeCredit (#2085)', () => {
  it('credits a Commons map file by its page, with its licence and sources', () => {
    expect(shapeCredit({
      wikidata_id: 'commons:North_Sea_Coast_region.map',
      licence: 'ODbL-1.0',
      attribution: 'Based on OpenStreetMap data',
    })).toEqual({
      label: 'Data:North_Sea_Coast_region.map',
      url: 'https://commons.wikimedia.org/wiki/Data:North_Sea_Coast_region.map',
      licence: 'ODbL-1.0',
      attribution: 'Based on OpenStreetMap data',
    });
  });

  it('gives no credit for a shape with no licence', () => {
    expect(shapeCredit({ wikidata_id: 'commons:North_Sea_Coast_region.map', licence: null, attribution: null })).toBeNull();
  });
});

describe('shapeCreditsFor (#2085)', () => {
  beforeEach(() => poolQuery.mockReset());

  it('reads nothing for no keys', async () => {
    expect(await shapeCreditsFor([])).toEqual([]);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('reads each held shape once and answers its credit', async () => {
    poolQuery.mockResolvedValue({ rows: [
      { wikidata_id: 'commons:A.map', licence: 'CC0-1.0', attribution: null },
    ] });

    expect(await shapeCreditsFor(['commons:A.map', 'commons:A.map'])).toEqual([
      { label: 'Data:A.map', url: 'https://commons.wikimedia.org/wiki/Data:A.map', licence: 'CC0-1.0', attribution: null },
    ]);
    const [[sql, params]] = poolQuery.mock.calls;
    expect(String(sql)).toMatch(/NOT not_available/);
    expect(params).toEqual([['commons:A.map']]);
  });
});

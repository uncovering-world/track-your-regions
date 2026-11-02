/**
 * #2276: a place kind refuses the item of a World Heritage site of several
 * components, on the places the development catalogue held on 2026-11-02:
 * Places of worship's Painted Churches of the Troödos Region (Q462702, ten
 * components) is refused, its Cologne Cathedral (Q4176, a site of one point)
 * kept. Which item is a series is the catalogue's SQL, run against PostgreSQL
 * in `serialSite.db.test.ts`; this spec holds the run's side of it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../../db/index.js';
import { refuseSerialSites, serialSiteItems, serialSiteReason, SERIES_MIN_COMPONENTS, SERIES_MIN_SPAN_KM } from './serialSite.js';

const TROODOS = 'Q462702';
const COLOGNE = 'Q4176';
const TROODOS_SITE = 'Painted Churches in the Troodos Region';

const answer = (rows: Array<{ item: string; site: string; components: number }>) =>
  vi.mocked(pool.query).mockResolvedValueOnce({ rows } as never);

beforeEach(() => {
  vi.mocked(pool.query).mockReset();
});

describe('serialSiteItems', () => {
  it('asks the catalogue once for the World Heritage kind and the series floor, each item once, ids only', async () => {
    answer([{ item: TROODOS, site: TROODOS_SITE, components: 10 }]);
    const series = await serialSiteItems([TROODOS, COLOGNE, TROODOS, 'not-an-item']);
    expect(series).toEqual(new Map([[TROODOS, { site: TROODOS_SITE, components: 10 }]]));
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([[TROODOS, COLOGNE], 1, SERIES_MIN_COMPONENTS, SERIES_MIN_SPAN_KM]);
    expect(SERIES_MIN_COMPONENTS).toBe(2);
    expect(SERIES_MIN_SPAN_KM).toBe(10);
  });

  it('asks nothing of a run with no item', async () => {
    expect((await serialSiteItems([])).size).toBe(0);
    expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
  });

  it('names an item two listed sites resolve to by the larger series', async () => {
    answer([{ item: TROODOS, site: 'A smaller series', components: 2 }, { item: TROODOS, site: TROODOS_SITE, components: 10 }]);
    expect((await serialSiteItems([TROODOS])).get(TROODOS)).toEqual({ site: TROODOS_SITE, components: 10 });
  });
});

describe('refuseSerialSites', () => {
  it('refuses the Painted Churches of the Troödos with the series named and keeps Cologne Cathedral', async () => {
    answer([{ item: TROODOS, site: TROODOS_SITE, components: 10 }]);
    const items = [
      { qid: TROODOS, label: 'Painted Churches in the Troödos Region', type: 'church' },
      { qid: COLOGNE, label: 'Cologne Cathedral', type: 'cathedral' },
    ];
    const filtered = [{ externalId: 'Q1', name: 'Rancho de San Rafael', reason: 'not a place of worship' }];
    const refused = await refuseSerialSites(items, filtered, { id: (i) => i.qid, name: (i) => i.label, type: (i) => i.type }, '[Worship]');
    expect(refused).toBe(1);
    expect(items.map((i) => i.qid)).toEqual([COLOGNE]);
    expect(filtered).toContainEqual({
      externalId: TROODOS,
      name: 'Painted Churches in the Troödos Region',
      reason: serialSiteReason({ site: TROODOS_SITE, components: 10 }),
      type: 'church',
    });
    expect(serialSiteReason({ site: TROODOS_SITE, components: 10 }))
      .toBe(`a World Heritage site of 10 components (${TROODOS_SITE}): each component is a place of its own`);
  });
});

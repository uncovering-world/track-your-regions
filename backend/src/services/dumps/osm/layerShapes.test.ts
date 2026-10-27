import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The region shapes kept from the OpenStreetMap layer (#2085, ADR-0157): one
 * statement that replaces the store's item-keyed shapes with those the layer
 * draws, under ODbL, and leaves the Commons map shapes, then the composites of
 * child regions' shapes (#2113, ADR-0159), all in one transaction. The
 * statements themselves run against PostgreSQL in layerBuild.db.test.ts.
 */

/** What each statement answers, in the order the refill sends them; BEGIN, COMMIT and ROLLBACK answer nothing. */
let answers: { rows: unknown[] }[] = [];
let failOn: RegExp | null = null;
const query = vi.fn(async (sql: string) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (failOn?.test(sql)) throw new Error('store refused');
  return answers.shift() ?? { rows: [] };
});
const release = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { connect: async () => ({ query, release }) } }));

const { COMPOSITE_PASSES, OSM_SHAPE_LICENCE, refillRegionShapes } = await import('./layerShapes.js');

const sent = () => query.mock.calls.map(([sql]) => sql as string);

beforeEach(() => {
  query.mockClear();
  release.mockClear();
  answers = [];
  failOn = null;
});

describe('refillRegionShapes', () => {
  it('keeps the items the layer draws as areas, under ODbL, and answers what it held and dropped', async () => {
    answers = [{ rows: [{ held: ['Q1000001'], dropped: 2 }] }, { rows: [] }, { rows: [{ n: 0 }] }];

    expect(await refillRegionShapes(['Q1000001', 'Q1000002'])).toEqual({ held: ['Q1000001'], dropped: 2, composed: [], uncomposed: 0 });
    const [sql, params] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(params).toEqual([['Q1000001', 'Q1000002'], 0.001, OSM_SHAPE_LICENCE]);
    expect(OSM_SHAPE_LICENCE).toBe('ODbL-1.0');
    expect(sql).toMatch(/o\.osm_type IN \('R', 'W'\)/);
    expect(sql).toMatch(/ORDER BY o\.wikidata, o\.osm_type = 'R' DESC, ST_Area\(shape\.geom\) DESC/);
    expect(sql).toMatch(/composite_of = NULL/);
  });

  it('drops only the item-keyed shapes the layer no longer draws, never a Commons map shape', async () => {
    answers = [{ rows: [{ held: [], dropped: 0 }] }, { rows: [] }, { rows: [{ n: 0 }] }];

    await refillRegionShapes([]);
    expect(sent()[1]).toMatch(/DELETE FROM wikidata_geoshapes g\s+WHERE g\.wikidata_id ~ '\^Q\[1-9\]\[0-9\]\*\$'/);
  });

  it('builds composites pass after pass until one builds none, inside the refill\'s transaction', async () => {
    answers = [
      { rows: [{ held: ['Q1000002'], dropped: 0 }] },
      { rows: [{ wikidata_id: 'Q1000010' }, { wikidata_id: 'Q1000011' }] },
      { rows: [{ wikidata_id: 'Q1000020' }] },
      { rows: [] },
      { rows: [{ n: 3 }] },
    ];

    expect(await refillRegionShapes(['Q1000002'])).toEqual({
      held: ['Q1000002'], dropped: 0, composed: ['Q1000010', 'Q1000011', 'Q1000020'], uncomposed: 3,
    });
    expect(sent()[0]).toBe('BEGIN');
    expect(sent().filter(sql => sql.includes('composite_of)'))).toHaveLength(3);
    expect(sent().at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('stops after its passes on a tree deeper than them', async () => {
    answers = [
      { rows: [{ held: [], dropped: 0 }] },
      ...Array.from({ length: COMPOSITE_PASSES + 2 }, (_, i) => ({ rows: [{ wikidata_id: `Q${2000000 + i}` }] })),
    ];

    const refilled = await refillRegionShapes([]);
    expect(refilled.composed).toHaveLength(COMPOSITE_PASSES);
  });

  it('composes only from child regions that all hold an OpenStreetMap shape, one region per item', async () => {
    answers = [{ rows: [{ held: [], dropped: 0 }] }, { rows: [] }, { rows: [{ n: 0 }] }];

    await refillRegionShapes([]);
    const compose = sent().find(sql => sql.includes('composite_of)'))!;
    expect(compose).toMatch(/AND cg\.licence = \$1\s+WHERE c\.parent_region_id = r\.id AND cg\.wikidata_id IS NULL/);
    expect(compose).toMatch(/DISTINCT ON \(ps\.source_external_id\)/);
    expect(compose).toMatch(/NOT EXISTS \(SELECT 1 FROM wikidata_geoshapes g WHERE g\.wikidata_id = ps\.source_external_id\)/);
  });

  it('rolls the whole refill back when a composite cannot be built, so the store keeps the last build\'s shapes', async () => {
    answers = [{ rows: [{ held: ['Q1000001'], dropped: 0 }] }];
    failOn = /composite_of\)/;

    await expect(refillRegionShapes(['Q1000001'])).rejects.toThrow('store refused');
    expect(sent()).toContain('ROLLBACK');
    expect(sent()).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

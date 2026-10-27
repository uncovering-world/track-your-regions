import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The region shapes kept from the OpenStreetMap layer (#2085, ADR-0157): one
 * statement that replaces the store's item-keyed shapes with those the layer
 * draws, under ODbL, and leaves the Commons map shapes. The statement itself
 * runs against PostgreSQL in layerBuild.db.test.ts.
 */

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const { OSM_SHAPE_LICENCE, refillRegionShapes } = await import('./layerShapes.js');

describe('refillRegionShapes', () => {
  beforeEach(() => query.mockReset());

  it('keeps the items the layer draws as areas, under ODbL, and answers what it held and dropped', async () => {
    query.mockResolvedValueOnce({ rows: [{ held: ['Q1000001'], dropped: 2 }] });

    expect(await refillRegionShapes(['Q1000001', 'Q1000002'])).toEqual({ held: ['Q1000001'], dropped: 2 });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['Q1000001', 'Q1000002'], 0.001, OSM_SHAPE_LICENCE]);
    expect(OSM_SHAPE_LICENCE).toBe('ODbL-1.0');
    expect(sql).toMatch(/o\.osm_type IN \('R', 'W'\)/);
    expect(sql).toMatch(/ORDER BY o\.wikidata, o\.osm_type = 'R' DESC, ST_Area\(shape\.geom\) DESC/);
    expect(sql).toMatch(/composite_of = NULL/);
  });

  it('drops only the item-keyed shapes the layer no longer draws, never a Commons map shape', async () => {
    query.mockResolvedValueOnce({ rows: [{ held: [], dropped: 0 }] });

    await refillRegionShapes([]);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(/DELETE FROM wikidata_geoshapes g\s+WHERE g\.wikidata_id ~ '\^Q\[1-9\]\[0-9\]\*\$'/);
  });
});

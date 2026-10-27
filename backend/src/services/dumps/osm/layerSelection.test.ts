import { describe, expect, it, vi } from 'vitest';

/**
 * What the OpenStreetMap layer keeps (ADR-0134 decisions 2 and 3): the
 * selection as the expression file osmium and the flex style both read, and
 * the objects the catalogue names, as `osmium getid` names them.
 */

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const { drawnFile, drawnItems, getidOf, LAYER_DRAWN, LAYER_SELECTION, layerDraws, pinnedObjects, selectionFile } = await import('./layerSelection.js');

describe('the layer selection', () => {
  it('writes one osmium expression a line, for nodes, ways and relations', () => {
    const lines = selectionFile().trimEnd().split('\n');
    expect(lines).toHaveLength(LAYER_SELECTION.length);
    expect(lines).toContain('nwr/wikidata');
    expect(lines).toContain('nwr/amenity=place_of_worship');
    expect(lines).toContain('nwr/boundary=protected_area,national_park');
    expect(lines.every(line => /^nwr\/[a-z_:]+(=[a-z_,]+)?$/.test(line))).toBe(true);
  });

  it('selects no object by an address alone', () => {
    expect(LAYER_SELECTION.some(selector => selector.startsWith('addr'))).toBe(false);
  });

  it('writes the drawn rule one key a line, for the flex style (ADR-0136)', () => {
    const lines = drawnFile().trimEnd().split('\n');
    expect(lines).toContain('ruins');
    expect(lines).toContain('archaeological_site');
    expect(lines).toContain('boundary=protected_area,national_park');
    expect(lines.find(line => line.startsWith('historic='))).toBe(`historic=${LAYER_DRAWN.historic.join(',')}`);
    expect(lines.every(line => /^[a-z_]+(=[a-z_,]+)?$/.test(line))).toBe(true);
  });

  it('says whether a layer cut with a drawn rule keeps the outlines a keep rule asks for', () => {
    expect(layerDraws(LAYER_DRAWN, LAYER_DRAWN)).toBe(true);
    expect(layerDraws(LAYER_DRAWN, { historic: [], manMade: [], boundary: [] })).toBe(true);
    expect(layerDraws(LAYER_DRAWN, { historic: ['memorial'], manMade: [], boundary: [] })).toBe(false);
    expect(layerDraws(LAYER_DRAWN, { historic: [], manMade: [], boundary: ['administrative'] })).toBe(false);
    // A layer cut before ADR-0136 kept every geometry whole.
    expect(layerDraws(null, { historic: ['memorial'], manMade: [], boundary: [] })).toBe(true);
  });

  it("names an OSM object as osmium getid does, and nothing that is not one", () => {
    expect(getidOf('node/3539751036')).toBe('n3539751036');
    expect(getidOf('way/24006432')).toBe('w24006432');
    expect(getidOf('relation/1834818')).toBe('r1834818');
    expect(getidOf('relation/0')).toBeNull();
    expect(getidOf('changeset/1')).toBeNull();
    expect(getidOf('node/1; rm -rf /')).toBeNull();
  });

  it("pins the objects a place's OSM facts and extent were read from, each once", async () => {
    query.mockResolvedValueOnce({ rows: [{ ref: 'relation/1834818' }, { ref: 'node/3539751036' }, { ref: 'way/x' }] });
    expect(await pinnedObjects()).toEqual(['n3539751036', 'r1834818']);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(/metadata->'osm'->>'object'/);
    expect(sql).toMatch(/metadata->'osm'->>'extentFrom'/);
  });

  it('draws whole the objects of each item a world-view import names, by its QID only (ADR-0157)', async () => {
    query.mockResolvedValueOnce({ rows: [{ item: 'Q1000001' }, { item: 'Q1000002' }] });
    expect(await drawnItems()).toEqual(['Q1000001', 'Q1000002']);
    const [sql] = query.mock.calls.at(-1) as [string];
    expect(sql).toMatch(/FROM region_import_state/);
    expect(sql).toMatch(/source_external_id ~ '\^Q\[1-9\]\[0-9\]\*\$'/);
  });
});

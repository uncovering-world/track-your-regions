import { describe, expect, it, vi } from 'vitest';

/**
 * What the OpenStreetMap layer keeps (ADR-0134 decisions 2 and 3): the
 * selection as the expression file osmium and the flex style both read, and
 * the objects the catalogue names, as `osmium getid` names them.
 */

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

// The kept copy of English Wikivoyage, as the build reads it: null while none is kept.
const pages = vi.hoisted(() => ({ wikitext: new Map<string, string>() as Map<string, string> | null }));
vi.mock('../../wikivoyageExtract/pageCopy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../wikivoyageExtract/pageCopy.js')>();
  return {
    ...actual,
    PageCopy: {
      open: async () => {
        const kept = pages.wikitext;
        if (!kept) throw new actual.CopyRefusal('not kept');
        return { article: async (title: string) => (kept.has(title) ? { title, wikitext: kept.get(title)! } : null) };
      },
    },
  };
});

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
    pages.wikitext = new Map();
    query.mockResolvedValueOnce({ rows: [
      { item: 'Q1000002', source_url: null },
      { item: 'Q1000001', source_url: null },
      { item: 'commons:Test_region.map', source_url: null },
      { item: null, source_url: null },
    ] });
    expect(await drawnItems()).toEqual({ named: ['Q1000001', 'Q1000002'], listed: [] });
    const [sql] = query.mock.calls.at(-1) as [string];
    expect(sql).toMatch(/FROM region_import_state/);
  });

  it("also draws the items each mapshape on an imported region's page lists, read from the kept copy (#2105)", async () => {
    // Fixture items, not real ones: a region whose page draws two child regions from four districts.
    pages.wikitext = new Map([[
      'Test_Land',
      '{{mapshape|type=geoshape|fill=#cfd48c|title=Coast|wikidata=Q1000003, Q1000004}}\n'
        + '{{mapshape|type=geoshape|fill=#d5dc76|title=Heath|wikidata=Q1000005,q1000006,Q1000001}}\n'
        + '{{mapshape|type=geoshape|title=Hills|wikicommons=Test_region.map}}',
    ]]);
    query.mockResolvedValueOnce({ rows: [
      { item: 'Q1000001', source_url: 'https://en.wikivoyage.org/wiki/Test_Land' },
      { item: 'Q1000002', source_url: 'https://en.wikivoyage.org/wiki/No_such_page' },
    ] });
    // Q1000001 is listed too, and counted once, as the item an import names.
    expect(await drawnItems()).toEqual({ named: ['Q1000001', 'Q1000002'], listed: ['Q1000003', 'Q1000004', 'Q1000005'] });
  });

  it('draws the regions by their own items while no copy of Wikivoyage is kept', async () => {
    pages.wikitext = null;
    query.mockResolvedValueOnce({ rows: [{ item: 'Q1000001', source_url: 'https://en.wikivoyage.org/wiki/Test_Land' }] });
    expect(await drawnItems()).toEqual({ named: ['Q1000001'], listed: [] });
  });
});

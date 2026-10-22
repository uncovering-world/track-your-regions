import { describe, expect, it, vi } from 'vitest';

/**
 * What the OpenStreetMap layer keeps (ADR-0134 decisions 2 and 3): the
 * selection as the expression file osmium and the flex style both read, and
 * the objects the catalogue names, as `osmium getid` names them.
 */

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const { getidOf, LAYER_SELECTION, pinnedObjects, selectionFile } = await import('./layerSelection.js');

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
});

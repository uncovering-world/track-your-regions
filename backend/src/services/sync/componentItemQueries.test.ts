/**
 * How the component-item search asks Wikidata for a site's parts (#1272):
 * smaller questions where the service cannot answer a big one, and none at all
 * once it says to stop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./wikidataUtils.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./wikidataUtils.js')>(),
  sparqlQuery: vi.fn(),
}));
vi.mock('./qleverWikidata.js', () => ({ qleverWikidataQuery: vi.fn() }));
vi.mock('./wikipediaCategories.js', () => ({ askWikipediaOnce: vi.fn() }));

const { sparqlQuery, SparqlUnanswered, WaitBudget } = await import('./wikidataUtils.js');
const { boxFilter, contentsOf, itemsInBoxes, partsOfSites } = await import('./componentItemQueries.js');
const { qleverWikidataQuery } = await import('./qleverWikidata.js');
const { askWikipediaOnce } = await import('./wikipediaCategories.js');

const asked = vi.mocked(sparqlQuery);
const hooks = () => ({ budget: new WaitBudget(1000) });

/** The sites a query names in its VALUES block. */
const sitesIn = (query: string) => [...query.matchAll(/wd:(Q\d+)/g)].map(m => m[1]);
const part = (site: string, item: string, whc?: string) => ({
  site: { value: `http://www.wikidata.org/entity/${site}` },
  part: { value: `http://www.wikidata.org/entity/${item}` },
  coord: { value: 'Point(21.87 61.59)' },
  ...(whc ? { whc: { value: whc } } : {}),
});

// A braced body: a function returned from beforeEach is run as its cleanup.
beforeEach(() => { asked.mockReset(); });

describe('partsOfSites', () => {
  it('asks again in halves where the service cannot answer a batch, and names a site it cannot answer alone', async () => {
    // Q2 is the site item with thousands of parts: any batch holding it times out.
    asked.mockImplementation(async (query) => {
      const sites = sitesIn(query);
      if (sites.includes('Q2')) throw new SparqlUnanswered('Wikidata SPARQL error 504: gateway timeout');
      return sites.map(site => part(site, `Q${site.slice(1)}00`));
    });

    const { parts, unread } = await partsOfSites(['Q1', 'Q2', 'Q3', 'Q4'], hooks());

    expect(unread).toEqual(['Q2']);
    expect([...parts.keys()].sort()).toEqual(['Q1', 'Q3', 'Q4']);
    expect(parts.get('Q3')).toEqual([{ item: 'Q300', labels: [], coords: [[61.59, 21.87]], classes: [] }]);
  });

  it('carries the World Heritage references a part states, so the finder can tell another site\'s part from this one\'s (#1344)', async () => {
    asked.mockResolvedValue([part('Q1', 'Q100', '527-002'), part('Q1', 'Q100', '527ter-002'), part('Q1', 'Q101')]);

    const { parts } = await partsOfSites(['Q1'], hooks());

    expect(parts.get('Q1')).toEqual([
      { item: 'Q100', labels: [], coords: [[61.59, 21.87]], classes: [], references: ['527-002', '527ter-002'] },
      { item: 'Q101', labels: [], coords: [[61.59, 21.87]], classes: [] },
    ]);
  });

  it.each([
    ['a 429', 'Wikidata SPARQL error 429: too many requests'],
    ['a 403', 'Wikidata SPARQL error 403: you have been banned'],
    ['a malformed query', 'Wikidata SPARQL error 400: parse error'],
    ['a spent wait budget', "SPARQL 503, and this run's 15 min of waiting is spent"],
  ])('stops on %s, rather than asking the service smaller questions', async (_case, message) => {
    asked.mockRejectedValue(new Error(message));

    await expect(partsOfSites(['Q1', 'Q2', 'Q3', 'Q4'], hooks())).rejects.toThrow(message);
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe('itemsInBoxes', () => {
  it("reads QLever's coordinates, written POINT, as the query service's", async () => {
    vi.mocked(qleverWikidataQuery).mockResolvedValue([{
      item: { value: 'http://www.wikidata.org/entity/Q98402' },
      coord: { value: 'POINT(22.8754 46.8851)' },
      class: { value: 'http://www.wikidata.org/entity/Q88205' },
    }]);

    const items = await itemsInBoxes([{ south: 46.8, west: 22.8, north: 46.9, east: 22.9 }], ['Q88205'], hooks());

    expect(items).toEqual([{ item: 'Q98402', labels: [], coords: [[46.8851, 22.8754]], classes: ['Q88205'] }]);
  });
});

describe('boxFilter', () => {
  it('takes the other side of the antimeridian for a box that runs past it', () => {
    // A margin around a point on Taveuni, Fiji, at 179.98° east.
    const filter = boxFilter({ south: -16.9, west: 179.9, north: -16.7, east: 180.05 });

    expect(filter).toContain('?lon >= 179.9 && ?lon <= 180');
    expect(filter).toContain('?lon >= -180 && ?lon <= -179.95');
  });

  it('is one range for a box that does not', () => {
    expect(boxFilter({ south: 46.8, west: 22.8, north: 46.9, east: 22.9 }))
      .toBe('(?lat >= 46.8 && ?lat <= 46.9 && (?lon >= 22.8 && ?lon <= 22.9))');
  });
});

describe('contentsOf', () => {
  it("reads each confirmed item's first picture by its address and its English description, skipping a deprecated statement", async () => {
    vi.mocked(askWikipediaOnce).mockResolvedValue({
      entities: {
        Q98501: {
          descriptions: { en: { value: 'Roman fort in Cluj County, Romania' } },
          claims: {
            P18: [
              { rank: 'normal', mainsnak: { datavalue: { value: 'Castrul roman (Bologa) 2.jpg' } } },
              { rank: 'deprecated', mainsnak: { datavalue: { value: 'A wrong file.jpg' } } },
              { rank: 'normal', mainsnak: { datavalue: { value: 'Castrul roman (Bologa) 1.jpg' } } },
            ],
          },
        },
        Q98502: { claims: {} },
      },
    } as never);

    const contents = await contentsOf(['Q98501', 'Q98502'], hooks());

    expect(vi.mocked(askWikipediaOnce).mock.calls[0][0]).toMatchObject({
      action: 'wbgetentities', ids: 'Q98501|Q98502', props: 'claims|descriptions', languages: 'en',
    });
    // The query service's spelling of a file: a space as %20, a parenthesis as %28,
    // so the picture is the same address the run stores for the same file.
    expect(contents.get('Q98501')).toEqual({
      image: 'http://commons.wikimedia.org/wiki/Special:FilePath/Castrul%20roman%20%28Bologa%29%201.jpg',
      description: 'Roman fort in Cluj County, Romania',
    });
    expect(contents.get('Q98502')).toEqual({ image: null, description: null });
  });
});

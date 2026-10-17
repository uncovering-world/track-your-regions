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
const { boxFilter, contentsOf, itemsInBoxes, labelsOf, partsOfSites, placesOf, registerCodesOf } = await import('./componentItemQueries.js');
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

  it('counts every site once as answered, the halves and the one it cannot answer alone included (#1356)', async () => {
    asked.mockImplementation(async (query) => {
      const sites = sitesIn(query);
      if (sites.includes('Q2')) throw new SparqlUnanswered('Wikidata SPARQL error 504: gateway timeout');
      return sites.map(site => part(site, `Q${site.slice(1)}00`));
    });
    const answered: number[] = [];

    await partsOfSites(['Q1', 'Q2', 'Q3', 'Q4'], { ...hooks(), onAnswered: (count: number) => answered.push(count) });

    expect(answered.reduce((a, b) => a + b, 0)).toBe(4);
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

  it('refuses a record of a find or a dig, though it is of a class asked about (#1357)', async () => {
    // "Pompeii (Samian Ware Discovery Site)", Q103190089, is typed Samian Ware
    // Discovery Site and archaeological site: an answer to a question about
    // archaeological sites names that class alone, so the query refuses it.
    vi.mocked(qleverWikidataQuery).mockResolvedValue([]);

    await itemsInBoxes([{ south: 40.74, west: 14.47, north: 40.76, east: 14.5 }], ['Q839954'], hooks());

    const query = vi.mocked(qleverWikidataQuery).mock.calls.at(-1)![0].replace(/\s+/g, ' ');
    expect(query).toContain('VALUES ?class { wd:Q839954 } ?item wdt:P31 ?class .');
    expect(query).toContain(
      'FILTER NOT EXISTS { VALUES ?record { wd:Q102202066 wd:Q101008619 } ?item wdt:P31/wdt:P279* ?record } }');
  });
});

describe('placesOf', () => {
  it('reads each place an item stands in or is part of, with its names, coordinates and whether it carries a reference (#1349)', async () => {
    const row = (item: string, place: string, name: string, coord?: string, reference?: string) => ({
      item: { value: `http://www.wikidata.org/entity/${item}` }, place: { value: `http://www.wikidata.org/entity/${place}` },
      name: { value: name }, ...(coord ? { coord: { value: coord } } : {}), ...(reference ? { reference: { value: reference } } : {}),
    });
    // Christiansfeld's pharmacy: in Kolding Municipality and at Christiansfeld, which carries
    // the reference of the inscription it was before the extension, 1468.
    vi.mocked(qleverWikidataQuery).mockResolvedValue([
      row('Q61757379', 'Q21101', 'Kolding Municipality', 'POINT(9.4722 55.4903)'),
      row('Q61757379', 'Q3197288', 'Christiansfeld', 'POINT(9.483056 55.356667)', '1468'),
      row('Q76637833', 'Q165140', 'Herrnhut', 'POINT(14.741666 51.016666)'),
      row('Q76637833', 'Q165140', 'Herrnhut', 'POINT(14.741666 51.016666)'),
    ]);

    const places = await placesOf(['Q61757379', 'Q76637833'], hooks());

    expect(places.get('Q61757379')).toEqual([
      { item: 'Q21101', names: ['Kolding Municipality'], coords: [[55.4903, 9.4722]], referenced: false },
      { item: 'Q3197288', names: ['Christiansfeld'], coords: [[55.356667, 9.483056]], referenced: true },
    ]);
    expect(places.get('Q76637833')).toEqual([{ item: 'Q165140', names: ['Herrnhut'], coords: [[51.016666, 14.741666]], referenced: false }]);
    const query = vi.mocked(qleverWikidataQuery).mock.calls.at(-1)![0].replace(/\s+/g, ' ');
    expect(query).toContain('VALUES ?item { wd:Q61757379 wd:Q76637833 } VALUES ?held { wdt:P131 wdt:P276 wdt:P361 } ?item ?held ?place . ?place rdfs:label ?name . FILTER(LANG(?name) = "en" || LANG(?name) = "mul") OPTIONAL { ?place wdt:P625 ?coord } OPTIONAL { ?place wdt:P757 ?reference }');
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

describe('labelsOf', () => {
  it('keeps every label for matching and the English one, else the multilingual one, to name the item by (#1358)', async () => {
    vi.mocked(askWikipediaOnce).mockResolvedValueOnce({
      entities: {
        Q98511: { labels: { tr: { value: 'Bir türbe' }, en: { value: 'A shrine' } } },
        Q98512: { labels: { mul: { value: 'Kastell Fixture' }, de: { value: 'Kastell Fixture' }, ro: { value: 'Castrul Fixture' } } },
        Q98513: { labels: { fr: { value: 'Un phare' } } },
      },
    } as never);

    const labels = await labelsOf(['Q98511', 'Q98512', 'Q98513'], hooks());

    expect(labels.get('Q98511')).toEqual({ all: ['Bir türbe', 'A shrine'], english: 'A shrine' });
    expect(labels.get('Q98512')).toEqual({ all: ['Kastell Fixture', 'Castrul Fixture'], english: 'Kastell Fixture' });
    expect(labels.get('Q98513')).toEqual({ all: ['Un phare'], english: null });
  });
});

describe('registerCodesOf', () => {
  it('asks the query service, never QLever, for the codes the registers list carries, keyed by item', async () => {
    vi.mocked(qleverWikidataQuery).mockClear();
    asked.mockResolvedValueOnce([
      { item: { value: 'http://www.wikidata.org/entity/Q7234612' }, property: { value: 'http://www.wikidata.org/prop/direct/P1770' }, code: { value: 'CJ-I-s-A-07208' } },
      { item: { value: 'http://www.wikidata.org/entity/Q1414131' }, property: { value: 'http://www.wikidata.org/prop/direct/P4009' }, code: { value: '1393' } },
    ]);
    const codes = await registerCodesOf(['Q7234612', 'Q1414131'], hooks());
    expect(codes.get('Q7234612')).toEqual([{ property: 'P1770', code: 'CJ-I-s-A-07208' }]);
    expect(codes.get('Q1414131')).toEqual([{ property: 'P4009', code: '1393' }]);
    const query = asked.mock.calls[0][0].replace(/\s+/g, ' ');
    expect(query).toContain('VALUES ?property { wdt:P1770 wdt:P381 wdt:P4009 }');
    expect(vi.mocked(qleverWikidataQuery)).not.toHaveBeenCalled();
  });
});

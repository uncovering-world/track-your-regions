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

const { sparqlQuery, SparqlUnanswered, WaitBudget } = await import('./wikidataUtils.js');
const { partsOfSites } = await import('./componentItemQueries.js');

const asked = vi.mocked(sparqlQuery);
const hooks = () => ({ budget: new WaitBudget(1000) });

/** The sites a query names in its VALUES block. */
const sitesIn = (query: string) => [...query.matchAll(/wd:(Q\d+)/g)].map(m => m[1]);
const part = (site: string, item: string) => ({
  site: { value: `http://www.wikidata.org/entity/${site}` },
  part: { value: `http://www.wikidata.org/entity/${item}` },
  coord: { value: 'Point(21.87 61.59)' },
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

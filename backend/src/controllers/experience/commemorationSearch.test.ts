/**
 * A curator's search for whom a place commemorates (#2144): the items a name
 * finds on Wikidata, with the words that tell them apart and the article the
 * card will link. Wikidata is a mocked fetch here; nothing leaves the machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answer, routeAt } from '../../api/routeTesting.js';
import { experienceCurationRoutes } from '../../routes/experienceRoutes.js';
import { resetActionApiTurn } from '../../services/wikimediaApi.js';
import { userAgent } from '../../config/userAgent.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.spyOn(console, 'error').mockImplementation(() => {});

const search = routeAt(experienceCurationRoutes, '/commemorates/search', 'get');
const CURATOR = { id: 7, role: 'curator' } as Express.User;

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

async function ask(q: string): Promise<{ status: number; body: unknown }> {
  let status = 200;
  let body: unknown;
  const res = {
    status: vi.fn((code: number) => { status = code; return res; }),
    json: vi.fn((sent: unknown) => { body = sent; return res; }),
  };
  await answer(search, { query: { q }, user: CURATOR }, res);
  return { status, body };
}

/** The Action API parameters of the n-th request sent. */
function sent(n: number): { params: URLSearchParams; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { params: new URL(url).searchParams, headers: init.headers as Record<string, string> };
}

beforeEach(() => resetActionApiTurn());
afterEach(() => fetchMock.mockReset());

describe('the search for whom a place commemorates', () => {
  it('is a curator\'s, held to the search ceiling', () => {
    expect(search.access).toBe('curator');
    expect(search.limiter).toBeDefined();
  });

  it('answers each item with its English label and description, and its English article', async () => {
    // "Lincoln", as a curator correcting the Lincoln Memorial (Q213559) types it:
    // the president and the memorial itself, told apart by their descriptions.
    reply({ search: [
      { id: 'Q91', label: 'Abraham Lincoln', description: 'president of the United States from 1861 to 1865' },
      { id: 'Q213559', label: 'Lincoln Memorial', description: 'memorial in Washington, D.C.' },
      { id: 'P91', label: 'a property, not an item' },
    ] });
    reply({ entities: {
      Q91: {
        labels: { en: { value: 'Abraham Lincoln' } },
        descriptions: { en: { value: 'president of the United States from 1861 to 1865' } },
        sitelinks: { enwiki: { title: 'Abraham Lincoln' } },
      },
      Q213559: {
        labels: { en: { value: 'Lincoln Memorial' } },
        descriptions: { en: { value: 'memorial in Washington, D.C.' } },
        sitelinks: { enwiki: { title: 'Lincoln Memorial' } },
      },
    } });

    const { status, body } = await ask('Lincoln');

    expect(status).toBe(200);
    expect(body).toEqual({ candidates: [
      { item: 'Q91', label: 'Abraham Lincoln', description: 'president of the United States from 1861 to 1865',
        articleUrl: 'https://en.wikipedia.org/wiki/Abraham_Lincoln' },
      { item: 'Q213559', label: 'Lincoln Memorial', description: 'memorial in Washington, D.C.',
        articleUrl: 'https://en.wikipedia.org/wiki/Lincoln_Memorial' },
    ] });

    const first = sent(0);
    expect(Object.fromEntries(first.params)).toMatchObject({
      action: 'wbsearchentities', search: 'Lincoln', type: 'item', language: 'en', uselang: 'en', limit: '8', format: 'json',
    });
    const second = sent(1);
    expect(Object.fromEntries(second.params)).toMatchObject({
      action: 'wbgetentities', ids: 'Q91|Q213559',
      props: 'sitelinks|labels|descriptions', languages: 'en', sitefilter: 'enwiki', format: 'json',
    });
    // The product's own header, built in one place, without the bot marker: a curator waits on it.
    for (const { headers } of [first, second]) expect(headers['User-Agent']).toBe(userAgent());
  });

  it('spells an article as a run does, so the two cannot store one article two ways', async () => {
    reply({ search: [{ id: 'Q15193', label: 'Alexander I of Russia' }] });
    reply({ entities: { Q15193: { labels: { en: { value: 'Alexander I of Russia' } }, sitelinks: { enwiki: { title: 'Alexander I of Russia' } } } } });

    const { body } = await ask('Alexander I');

    expect(body).toEqual({ candidates: [
      { item: 'Q15193', label: 'Alexander I of Russia', description: null, articleUrl: 'https://en.wikipedia.org/wiki/Alexander_I_of_Russia' },
    ] });
  });

  it('shows an item with no English label under the label the search matched', async () => {
    // Kuzma Minin (Q469785), as if Wikidata held no English label or article for
    // him: a curator who typed his name in Russian still finds him.
    reply({ search: [{ id: 'Q469785', display: { label: { value: 'Кузьма Минин' }, description: { value: 'купец' } } }] });
    reply({ entities: { Q469785: { labels: {}, descriptions: {}, sitelinks: {} } } });

    expect((await ask('Кузьма Минин')).body).toEqual({ candidates: [
      { item: 'Q469785', label: 'Кузьма Минин', description: 'купец', articleUrl: null },
    ] });
  });

  it('asks nothing more where the name finds nobody', async () => {
    reply({ search: [] });

    expect((await ask('Ethel Saxonn')).body).toEqual({ candidates: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 502 rather than candidates without their articles when Wikidata fails', async () => {
    reply({ search: [{ id: 'Q91', label: 'Abraham Lincoln' }] });
    reply({ error: 'unavailable' }, 500);

    const { status, body } = await ask('Lincoln');

    expect(status).toBe(502);
    expect(body).toMatchObject({ error: 'Wikidata search failed' });
  });

  it('refuses a name too short to search for', async () => {
    await expect(ask('L')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

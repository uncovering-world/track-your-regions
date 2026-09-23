import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestImage, searchPlaces } from './geocodeController.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.spyOn(console, 'error').mockImplementation(() => {});

function reply(body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

async function call(handler: typeof searchPlaces, query: Record<string, string>) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  await handler({ query } as never, res as never);
  return { res, body: json.mock.calls[0]?.[0] };
}

const KREMLIN = 'Казанский кремль, проезд Шейнкмана, Вахитовский район, Казань, городской округ Казань, Татарстан, Приволжский федеральный округ, 420014, Россия';
const STREET = 'Кремлёвская улица, Старо-Татарская слобода, Вахитовский район, Казань, городской округ Казань, Татарстан, Приволжский федеральный округ, 420111, Россия';

afterEach(() => fetchMock.mockReset());

describe('searchPlaces', () => {
  it('answers each place with its point as numbers, and null where OpenStreetMap links no item', async () => {
    // What Nominatim answers for the Kazan Kremlin and for the street beside it.
    reply([
      { display_name: KREMLIN, lat: '55.7990218', lon: '49.1061691', type: 'castle', extratags: { wikidata: 'Q603622' } },
      { display_name: STREET, lat: '55.7954296', lon: '49.1112151', type: 'unclassified', extratags: {} },
    ]);
    const { body } = await call(searchPlaces, { q: 'Kazan Kremlin' });
    expect(body).toEqual({
      results: [
        { display_name: KREMLIN, lat: 55.7990218, lng: 49.1061691, type: 'castle', wikidataId: 'Q603622' },
        { display_name: STREET, lat: 55.7954296, lng: 49.1112151, type: 'unclassified', wikidataId: null },
      ],
    });
  });

  it('answers 500 with its own message when Nominatim cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const { res, body } = await call(searchPlaces, { q: 'Kazan Kremlin' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body).toEqual({ error: 'Geocode search failed' });
  });
});

describe('suggestImage', () => {
  it('answers the item the curator named, found directly', async () => {
    // Q603622 as Wikidata holds it, the Kazan Kremlin.
    reply({
      entities: {
        Q603622: {
          labels: { en: { value: 'Qazan Kremlin' } },
          descriptions: { en: { value: 'historic citadel in Tatarstan' } },
          claims: { P18: [{ mainsnak: { datavalue: { value: 'Казанский кремль. Панорама с колеса обозрения.jpg' } } }] },
          sitelinks: { enwiki: { title: 'Kazan Kremlin', url: 'https://en.wikipedia.org/wiki/Kazan_Kremlin' } },
        },
      },
    });
    const { body } = await call(suggestImage, { wikidataId: 'Q603622' });
    expect(body).toEqual({
      imageUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent('Казанский кремль. Панорама с колеса обозрения.jpg')}`,
      source: 'wikidata_direct',
      entityLabel: 'Qazan Kremlin',
      wikidataId: 'Q603622',
      description: 'historic citadel in Tatarstan',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Kazan_Kremlin',
    });
  });

  it('answers 404 when no layer finds a picture', async () => {
    reply({ entities: { Q603622: { labels: { en: { value: 'Qazan Kremlin' } }, claims: {} } } });
    const { res, body } = await call(suggestImage, { wikidataId: 'Q603622' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body).toEqual({ error: 'No image found' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestImage, searchPlaces } from './geocodeController.js';
import { geocodeSearchQuerySchema, suggestImageQuerySchema } from '../types/index.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.spyOn(console, 'error').mockImplementation(() => {});

function reply(body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/** Each handler with its query as the route hands it over, parsed by its schema. */
const search = (query: Record<string, string>) => searchPlaces({ query: geocodeSearchQuerySchema.parse(query) });
const suggest = (query: Record<string, string>) => suggestImage({ query: suggestImageQuerySchema.parse(query) });

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
    expect(await search({ q: 'Kazan Kremlin' })).toEqual({
      results: [
        { display_name: KREMLIN, lat: 55.7990218, lng: 49.1061691, type: 'castle', wikidataId: 'Q603622' },
        { display_name: STREET, lat: 55.7954296, lng: 49.1112151, type: 'unclassified', wikidataId: null },
      ],
    });
  });

  it('answers 500 with its own message when Nominatim cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(search({ q: 'Kazan Kremlin' }))
      .rejects.toMatchObject({ statusCode: 500, message: 'Geocode search failed' });
  });

  it("passes Nominatim's refusal on with its status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve([]) });
    await expect(search({ q: 'Kazan Kremlin' }))
      .rejects.toMatchObject({ statusCode: 429, message: 'Nominatim request failed' });
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
    expect(await suggest({ wikidataId: 'Q603622' })).toEqual({
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
    await expect(suggest({ wikidataId: 'Q603622' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'No image found' });
  });

  it('answers 400 when it is given nothing to look for', async () => {
    await expect(suggest({})).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

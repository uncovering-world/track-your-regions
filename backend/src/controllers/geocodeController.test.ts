import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestImage, searchPlaces } from './geocodeController.js';
import { geocodeSearchQuerySchema, suggestImageQuerySchema } from '../types/index.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.spyOn(console, 'error').mockImplementation(() => {});

function reply(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
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

  it('answers 502 with its own message when Nominatim cannot be reached, never a 500 of its own', async () => {
    // Each spec asks its own question: the same one would be answered from the cache.
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(search({ q: 'Söyembikä Tower' }))
      .rejects.toMatchObject({ statusCode: 502, message: 'Geocode search failed' });
  });

  it('answers 504 when Nominatim does not answer before the deadline', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(search({ q: 'Kul Sharif Mosque' }))
      .rejects.toMatchObject({ statusCode: 504, message: 'Geocode search failed' });
  });

  it("answers 502 for Nominatim's own server error, never a 500 of its own", async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 500 }));
    await expect(search({ q: 'Kremlin of Kazan' }))
      .rejects.toMatchObject({ statusCode: 502, message: 'Nominatim request failed' });
  });

  it("passes Nominatim's refusal on with its status", async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 429 }));
    await expect(search({ q: 'Qolşärif Mosque' }))
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

  it("answers the item's own coordinate with the item it found by its name", async () => {
    // Charles Bridge, Q204871, as Wikidata holds it: the item a curator adding it
    // under *Europe* is matched with, where no address names the continent.
    reply({ search: [{ id: 'Q204871', label: 'Charles Bridge' }] });
    reply({
      entities: {
        Q204871: {
          labels: { en: { value: 'Charles Bridge' } },
          descriptions: { en: { value: 'bridge in Prague, Czech Republic' } },
          claims: {
            P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Prague 07-2016 View from Petrinska Tower img2.jpg' } } }],
            P625: [{
              rank: 'normal',
              mainsnak: {
                datavalue: {
                  value: {
                    latitude: 50.086388888889, longitude: 14.411944444444, altitude: null,
                    precision: 0.000277778, globe: 'http://www.wikidata.org/entity/Q2',
                  },
                },
              },
            }],
          },
          sitelinks: { enwiki: { title: 'Charles Bridge', url: 'https://en.wikipedia.org/wiki/Charles_Bridge' } },
        },
      },
    });

    expect(await suggest({ name: 'Charles Bridge' })).toMatchObject({
      source: 'wikidata_search',
      wikidataId: 'Q204871',
      coordinates: { lat: 50.086388888889, lng: 14.411944444444 },
    });
  });

  it('answers no coordinate the item states on another globe', async () => {
    // Tycho, Q631696, a lunar crater: its P625 is on the Moon (Q405).
    reply({
      entities: {
        Q631696: {
          labels: { en: { value: 'Tycho' } },
          claims: {
            P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'ComputerHotline - Sud-lune (by).jpg' } } }],
            P625: [{
              rank: 'normal',
              mainsnak: {
                datavalue: {
                  value: {
                    latitude: -43.3, longitude: -11.22, altitude: null,
                    precision: 0.01, globe: 'http://www.wikidata.org/entity/Q405',
                  },
                },
              },
            }],
          },
        },
      },
    });

    const suggestion = await suggest({ wikidataId: 'Q631696' });
    expect(suggestion).toMatchObject({ source: 'wikidata_direct', wikidataId: 'Q631696' });
    expect(suggestion.coordinates).toBeUndefined();
  });

  it('answers 404 when no layer finds a picture', async () => {
    reply({ entities: { Q603622: { labels: { en: { value: 'Qazan Kremlin' } }, claims: {} } } });
    await expect(suggest({ wikidataId: 'Q603622' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'No image found' });
  });

  it('answers 404 without asking again when the query service throttles the only layer it has', async () => {
    // The spatial layer around the Kazan Kremlin is the one that asks SPARQL.
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    await expect(suggest({ lat: '55.7987', lng: '49.1064' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'No image found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the throttled spatial layer and still finds the place by its name', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    reply({ search: [{ id: 'Q603622', label: 'Kazan Kremlin' }] });
    reply({
      entities: {
        Q603622: {
          labels: { en: { value: 'Qazan Kremlin' } },
          claims: { P18: [{ mainsnak: { datavalue: { value: 'Kazan Kremlin.jpg' } } }] },
        },
      },
    });

    expect(await suggest({ name: 'Kazan Kremlin', lat: '55.7987', lng: '49.1064' }))
      .toMatchObject({ source: 'wikidata_search', wikidataId: 'Q603622' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers 400 when it is given nothing to look for', async () => {
    await expect(suggest({})).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

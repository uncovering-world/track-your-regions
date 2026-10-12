import { afterEach, describe, expect, it, vi } from 'vitest';
import { commonsPicturesNear, NEARBY_SHOWN, readNearby } from './commonsNearby.js';

/**
 * Commons' answer around Paimio Sanatorium (one of Alvar Aalto's works), as
 * the geosearch generator gave it on 2026-10-12, read into the offer (#1341).
 */

const page = (title: string, dist: number | undefined, artist = 'Mikkoau', license = 'CC BY-SA 4.0') => ({
  title,
  ...(dist === undefined ? {} : { coordinates: [{ dist }] }),
  imageinfo: [{ extmetadata: { Artist: { value: `<a href="//commons.wikimedia.org/wiki/User:${artist}">${artist}</a>` }, LicenseShortName: { value: license } } }],
});

describe('the Commons files offered near a point', () => {
  it('keeps the pictures, nearest first, with their credit and the address a pick stores', () => {
    const offer = readNearby([
      page('File:Paimion parantola aula.jpg', 16.4),
      page('File:Paimion parantola ravintola.jpg', 8.2),
      page('File:Paimio sanatorium plan.pdf', 3),
      page('File:Paimio bells.ogg', 4),
      page('File:No coordinate.jpg', undefined),
    ]);
    expect(offer.map(p => p.file)).toEqual(['Paimion parantola ravintola.jpg', 'Paimion parantola aula.jpg']);
    expect(offer[0]).toEqual({
      file: 'Paimion parantola ravintola.jpg',
      url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Paimion%20parantola%20ravintola.jpg',
      distanceM: 8,
      credit: {
        author: 'Mikkoau', license: 'CC BY-SA 4.0', licenseUrl: null,
        detailsUrl: 'https://commons.wikimedia.org/wiki/File:Paimion_parantola_ravintola.jpg',
      },
    });
  });

  it(`shows at most ${NEARBY_SHOWN}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => page(`File:View ${String(i).padStart(2, '0')}.jpg`, 20 - i));
    const offer = readNearby(many);
    expect(offer).toHaveLength(NEARBY_SHOWN);
    expect(offer[0].distanceM).toBe(1);
  });
});

describe('a Commons answer that is no answer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws on a MediaWiki error rather than reading it as nothing nearby', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'ratelimited', info: 'You have exceeded your rate limit.' } }), { status: 200 },
    )));
    await expect(commonsPicturesNear(60.465, 22.7353, 'test-agent')).rejects.toThrow('ratelimited');
  });
});

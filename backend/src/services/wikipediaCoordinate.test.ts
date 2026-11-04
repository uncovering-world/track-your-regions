/**
 * Where a place's Wikipedia article says it stands (#2206): only a link to an
 * article on a Wikipedia is read, its primary coordinate on the Earth is the
 * answer, and an article that states none answers null.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Coordinate from './wikipediaCoordinate.js';

const fetchMock = vi.fn();
let articleOf: typeof Coordinate.articleOf;
let articleCoordinate: typeof Coordinate.articleCoordinate;

const ACHEIROPOIETOS = 'https://en.wikipedia.org/wiki/Church_of_the_Acheiropoietos';
const BRANCUSI = 'https://en.wikipedia.org/wiki/Sculptural_Ensemble_of_Constantin_Br%C3%A2ncu%C8%99i_at_T%C3%A2rgu_Jiu';
const pages = (coordinates?: unknown[]) => new Response(
  JSON.stringify({ query: { pages: [{ title: 't', ...(coordinates ? { coordinates } : {}) }] } }), { status: 200 },
);

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.resetModules();
  ({ articleOf, articleCoordinate } = await import('./wikipediaCoordinate.js'));
});

afterEach(() => vi.unstubAllGlobals());

describe('articleOf', () => {
  it('reads the wiki and the title of an article link, decoded', () => {
    expect(articleOf(BRANCUSI)).toEqual({ wiki: 'en', title: 'Sculptural Ensemble of Constantin Brâncuși at Târgu Jiu' });
    expect(articleOf('https://de.m.wikipedia.org/wiki/K%C3%B6lner_Dom')).toEqual({ wiki: 'de', title: 'Kölner Dom' });
  });

  it('refuses anything that is not a link to an article on a Wikipedia', () => {
    for (const url of [
      'https://en.wikipedia.org.example.com/wiki/Petra',
      'http://en.wikipedia.org/wiki/Petra',
      'https://en.wikivoyage.org/wiki/Petra',
      'https://en.wikipedia.org/w/index.php?title=Petra',
      'https://en.wikipedia.org/wiki/Petra|Jerash',
      'https://en.wikipedia.org/wiki/%E0%A4',
    ]) expect(articleOf(url)).toBeNull();
  });
});

describe('articleCoordinate', () => {
  it('answers the primary coordinate the article states, asked on its own wiki', async () => {
    fetchMock.mockResolvedValue(pages([{ lat: 40.63472222, lon: 22.94777778, primary: true, globe: 'earth' }]));
    expect(await articleCoordinate(ACHEIROPOIETOS)).toEqual({ latitude: 40.63472222, longitude: 22.94777778 });
    const asked = new URL(fetchMock.mock.calls[0][0] as string);
    expect(asked.origin + asked.pathname).toBe('https://en.wikipedia.org/w/api.php');
    expect(asked.searchParams.get('titles')).toBe('Church of the Acheiropoietos');
    expect(asked.searchParams.get('coprimary')).toBe('primary');
  });

  it('answers null for an article that states no coordinate, and keeps that answer', async () => {
    fetchMock.mockResolvedValue(pages());
    expect(await articleCoordinate(BRANCUSI)).toBeNull();
    expect(await articleCoordinate(BRANCUSI)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('draws no point off the Earth', async () => {
    fetchMock.mockResolvedValue(pages([{ lat: 4.5, lon: 137.4, primary: true, globe: 'mars' }]));
    expect(await articleCoordinate('https://en.wikipedia.org/wiki/Gale_(crater)')).toBeNull();
  });

  it('asks nothing for a link that is not an article, and remembers no refusal', async () => {
    expect(await articleCoordinate('https://example.com/wiki/Petra')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // Retry-After: 0, so the process's turn holds nobody back here (#2352).
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }));
    expect(await articleCoordinate(ACHEIROPOIETOS)).toBeNull();
    fetchMock.mockResolvedValueOnce(pages([{ lat: 40.63, lon: 22.94, primary: true }]));
    expect(await articleCoordinate(ACHEIROPOIETOS)).toEqual({ latitude: 40.63, longitude: 22.94 });
  });
});

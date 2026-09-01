/**
 * Tests for what Wikidata knows about a World Heritage site.
 *
 * Every id in here is one the source really carries: `166rev` is the Sydney
 * Opera House, `292`/`292bis` Cologne Cathedral, `1246bis-001f` a component of
 * the Baroque churches of the Philippines, and `sportif` is what somebody typed
 * into a P757 field on a wiki anyone may edit.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SparqlBinding } from './wikidataUtils.js';
import { indexWorldHeritageFacts, factsForSite } from './unescoWikidata.js';

const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/';

function binding(whc: string, facts: { article?: string; image?: string } = {}): SparqlBinding {
  return {
    whc: { value: whc },
    ...(facts.article ? { article: { value: facts.article } } : {}),
    ...(facts.image ? { image: { value: COMMONS + facts.image } } : {}),
  };
}

describe('factsForSite', () => {
  it('answers from the site\'s own id', () => {
    const index = indexWorldHeritageFacts([
      binding('404', { article: 'https://en.wikipedia.org/wiki/Acropolis_of_Athens', image: 'Acropolis.jpg' }),
    ]);

    expect(factsForSite(index, '404')).toEqual({
      article: 'https://en.wikipedia.org/wiki/Acropolis_of_Athens',
      picture: { url: COMMONS + 'Acropolis.jpg', via: 'exact', ref: '404' },
    });
  });

  it('answers from a later numbering of the same site', () => {
    // Wikidata holds the Sydney Opera House only as `166rev`, which is why the
    // catalogue has neither its picture nor its article today.
    const index = indexWorldHeritageFacts([
      binding('166rev', { article: 'https://en.wikipedia.org/wiki/Sydney_Opera_House', image: 'Sydney.jpg' }),
    ]);

    expect(factsForSite(index, '166')).toEqual({
      article: 'https://en.wikipedia.org/wiki/Sydney_Opera_House',
      picture: { url: COMMONS + 'Sydney.jpg', via: 'variant', ref: '166rev' },
    });
  });

  it('prefers the site\'s own id over a later numbering of it', () => {
    // Cologne Cathedral carries both, `292bis` at preferred rank
    const index = indexWorldHeritageFacts([
      binding('292bis', { image: 'Extension.jpg' }),
      binding('292', { image: 'Koelner Dom.jpg' }),
    ]);

    expect(factsForSite(index, '292').picture)
      .toEqual({ url: COMMONS + 'Koelner Dom.jpg', via: 'exact', ref: '292' });
  });

  it('falls back to a component, taking the lowest-numbered one', () => {
    const index = indexWorldHeritageFacts([
      binding('1142-15bis', { image: 'Fifteen.jpg' }),
      binding('1142-01bis', { image: 'One.jpg' }),
      binding('1142-02', { image: 'Two.jpg' }),
    ]);

    expect(factsForSite(index, '1142').picture)
      .toEqual({ url: COMMONS + 'One.jpg', via: 'component', ref: '1142-01bis' });
  });

  it('reads a component of a renumbered site as a component of the site', () => {
    const index = indexWorldHeritageFacts([binding('1246bis-001f', { image: 'Santa Maria.jpg' })]);

    expect(factsForSite(index, '1246').picture)
      .toEqual({ url: COMMONS + 'Santa Maria.jpg', via: 'component', ref: '1246bis-001f' });
  });

  it('never takes a component\'s article for the site\'s', () => {
    // A picture of one component is a picture of the property; an article about
    // one component is an article about that component.
    const index = indexWorldHeritageFacts([
      binding('1142-01bis', { article: 'https://en.wikipedia.org/wiki/One_church', image: 'One.jpg' }),
    ]);

    expect(factsForSite(index, '1142')).toEqual({
      article: null,
      picture: { url: COMMONS + 'One.jpg', via: 'component', ref: '1142-01bis' },
    });
  });

  it('takes each fact from the first candidate of the tier that states it', () => {
    // A row that carries an article and no picture must not end the search for
    // a picture the next component states.
    const index = indexWorldHeritageFacts([
      binding('91-002a'),
      binding('91-004a', { image: 'Fourth.jpg' }),
    ]);

    expect(factsForSite(index, '91').picture)
      .toEqual({ url: COMMONS + 'Fourth.jpg', via: 'component', ref: '91-004a' });
  });

  it('answers the same whatever order the rows arrive in', () => {
    // The endpoint states no order, so a picture that depended on one would
    // change between runs — and on a gated category every change is a card.
    const rows = [
      binding('540-020c', { image: 'C.jpg' }),
      binding('540-003b 16', { image: 'B.jpg' }),
      binding('540-036a', { image: 'A.jpg' }),
    ];

    const forwards = factsForSite(indexWorldHeritageFacts(rows), '540');
    const backwards = factsForSite(indexWorldHeritageFacts([...rows].reverse()), '540');

    expect(forwards.picture?.ref).toBe('540-003b 16');
    expect(backwards).toEqual(forwards);
  });

  it('ignores a value that names no site', () => {
    const index = indexWorldHeritageFacts([
      binding('sportif', { image: 'Whatever.jpg' }),
      binding('RL/02139', { image: 'Whatever.jpg' }),
      binding('№1549вспискеобъектоввсемирногонаследия(en)', { image: 'Whatever.jpg' }),
    ]);

    expect(factsForSite(index, 'sportif')).toEqual({ article: null, picture: null });
    expect(factsForSite(index, '1549')).toEqual({ article: null, picture: null });
  });

  it('answers nothing for a site nobody has stated anything about', () => {
    expect(factsForSite(indexWorldHeritageFacts([]), '1758'))
      .toEqual({ article: null, picture: null });
  });

  it('does not read a longer id as the site it starts with', () => {
    // `1660` is not `166`, and a site is not its neighbour's extension.
    const index = indexWorldHeritageFacts([binding('1660', { image: 'Other.jpg' })]);

    expect(factsForSite(index, '166').picture).toBeNull();
  });

  it('ignores a leading zero rather than matching two sites to one row', () => {
    // The catalogue's ids have no leading zeros, so `0166` is a typo on the wiki
    // rather than a second spelling of the Opera House.
    const index = indexWorldHeritageFacts([binding('0166', { image: 'Typo.jpg' })]);

    expect(factsForSite(index, '166').picture).toBeNull();
  });
});

describe('fetchWorldHeritageFacts', () => {
  it('answers nothing at all, rather than an empty index, when Wikidata did not answer', async () => {
    // An empty index says the properties have no pictures; no answer says
    // nothing about them. A caller reading the two alike would, on a bad
    // afternoon at the query service, take every picture off every site.
    vi.resetModules();
    vi.doMock('./wikidataUtils.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./wikidataUtils.js')>()),
      sparqlQuery: vi.fn(async () => { throw new Error('502 Bad Gateway'); }),
    }));
    const { fetchWorldHeritageFacts } = await import('./unescoWikidata.js');
    const { WaitBudget } = await import('./sourceRetry.js');
    const progress = { cancel: false, statusMessage: '' } as Parameters<typeof fetchWorldHeritageFacts>[0];

    expect(await fetchWorldHeritageFacts(progress, new WaitBudget(1000))).toBeNull();
    vi.doUnmock('./wikidataUtils.js');
  });

  it('lets a cancellation through as itself, not as Wikidata failing', async () => {
    // The retry loop throws when the run is cancelled mid-wait; read as "did
    // not answer", an admin who pressed Cancel would be told to try again later.
    vi.resetModules();
    vi.doMock('./wikidataUtils.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./wikidataUtils.js')>()),
      sparqlQuery: vi.fn(async () => { throw new Error('Sync cancelled'); }),
    }));
    const { fetchWorldHeritageFacts } = await import('./unescoWikidata.js');
    const { WaitBudget } = await import('./sourceRetry.js');
    const progress = { cancel: true, statusMessage: '' } as Parameters<typeof fetchWorldHeritageFacts>[0];

    await expect(fetchWorldHeritageFacts(progress, new WaitBudget(1000))).rejects.toThrow('Sync cancelled');
    vi.doUnmock('./wikidataUtils.js');
  });
});

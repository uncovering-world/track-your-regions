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
import { indexWorldHeritageFacts, factsForSite, resolveComponents } from './unescoWikidata.js';

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
    // change between runs — and on a gated source every change is a card.
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

/** One item's row, as the query answers since it groups by the item. */
function item(
  qid: string, whc: string, label: string, links: number,
  facts: { article?: string; image?: string } = {},
): SparqlBinding {
  return {
    ...binding(whc, {
      article: facts.article ? `https://en.wikipedia.org/wiki/${facts.article}` : undefined,
      image: facts.image,
    }),
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    label: { value: label },
    links: { value: String(links) },
  };
}

describe('factsForSite, where several items carry one id', () => {
  // Every pair below is one Wikidata held on 2026-10-03, with the sitelink
  // counts it had: the id sits on the property's item and on something else.

  it('answers from the item named as the site is named, not from a part that sorts first', () => {
    // The Altes Museum has carried Museum Island's id since 2026-10-01, and
    // "Altes_Museum" sorts before "Museum_Island": run 141 proposed the
    // building's article and picture for the island (#1232).
    const index = indexWorldHeritageFacts([
      item('Q156722', '896', 'Altes Museum', 44, { article: 'Altes_Museum', image: 'Berlin Stare muzeum 4.jpg' }),
      item('Q151963', '896', 'Museum Island', 58, { article: 'Museum_Island', image: 'Berlin Museumsinsel Fernsehturm.jpg' }),
    ]);

    expect(factsForSite(index, '896', 'Museumsinsel (Museum Island), Berlin')).toEqual({
      article: 'https://en.wikipedia.org/wiki/Museum_Island',
      picture: { url: COMMONS + 'Berlin Museumsinsel Fernsehturm.jpg', via: 'exact', ref: '896' },
    });
  });

  it('takes the article and the picture from the same item', () => {
    // One row per id took each fact's alphabetical minimum on its own, so the
    // article could be one item's and the picture another's.
    const index = indexWorldHeritageFacts([
      item('Q12506', '356', 'Hagia Sophia', 152, { article: 'Hagia_Sophia', image: 'Aya Sofya.jpg' }),
      item('Q5773394', '356', 'Historic Areas of Istanbul', 24, { article: 'Historic_Areas_of_Istanbul', image: 'Istanbul.jpg' }),
    ]);

    const facts = factsForSite(index, '356', 'Historic Areas of Istanbul');
    expect(facts.article).toBe('https://en.wikipedia.org/wiki/Historic_Areas_of_Istanbul');
    expect(facts.picture?.url).toBe(COMMONS + 'Istanbul.jpg');
  });

  it('lets the best-known other carrier stand in where the property\'s own item has no article', () => {
    // "Venice and its Lagoon" is an item of its own with no article; the page a
    // reader wants is Venice's.
    const index = indexWorldHeritageFacts([
      item('Q11352141', '394', 'Venice and its Lagoon', 3, { image: 'Lagoon.jpg' }),
      item('Q641', '394', 'Venice', 230, { article: 'Venice', image: 'Venezia.jpg' }),
    ]);

    const facts = factsForSite(index, '394', 'Venice and its Lagoon');
    expect(facts.article).toBe('https://en.wikipedia.org/wiki/Venice');
    // The picture stays the property item's own: it has one.
    expect(facts.picture?.url).toBe(COMMONS + 'Lagoon.jpg');
  });

  it('names no article rather than a little-known part\'s', () => {
    // The only other carrier of Derbent's id is its lighthouse, on 7 sites:
    // no page is better than that one for the citadel and the ancient city.
    const index = indexWorldHeritageFacts([
      item('Q24937319', '1070', 'Derbent Lighthouse', 7, { article: 'Derbent_Lighthouse', image: 'Mayak.jpg' }),
      item('Q64763166', '1070', 'Citadel, Ancient City and Fortress Buildings of Derbent', 3, { image: 'Naryn-Kala.jpg' }),
    ]);

    const facts = factsForSite(index, '1070', 'Citadel, Ancient City and Fortress Buildings of Derbent');
    expect(facts.article).toBeNull();
    expect(facts.picture?.url).toBe(COMMONS + 'Naryn-Kala.jpg');
  });

  it('reads the name by what the label is made of, then by what the two share', () => {
    // Bridgetown is wholly inside the site's name where the Garrison Historic
    // Area is not, though the second shares more words with it.
    const bridgetown = indexWorldHeritageFacts([
      item('Q629210', '1376', 'Garrison Historic Area', 11, { article: 'Garrison_Historic_Area' }),
      item('Q36168', '1376', 'Bridgetown', 145, { article: 'Bridgetown' }),
    ]);
    expect(factsForSite(bridgetown, '1376', 'Historic Bridgetown and its Garrison').article)
      .toBe('https://en.wikipedia.org/wiki/Bridgetown');

    // Stonehenge is wholly inside its site's name too, and so is the
    // property's own item, which shares all of it and has its own article.
    const stonehenge = indexWorldHeritageFacts([
      item('Q39671', '373', 'Stonehenge', 135, { article: 'Stonehenge' }),
      item('Q587584', '373', 'Stonehenge, Avebury and Associated Sites', 17, { article: 'Stonehenge,_Avebury_and_Associated_Sites' }),
    ]);
    expect(factsForSite(stonehenge, '373', 'Stonehenge, Avebury and Associated Sites').article)
      .toBe('https://en.wikipedia.org/wiki/Stonehenge,_Avebury_and_Associated_Sites');
  });

  it('reads a name through the portal\'s markup and a label through its accents', () => {
    const index = indexWorldHeritageFacts([
      item('Q105973249', '362', 'Old Town of Ghadamès', 15, { article: 'Old_town_of_Ghadames' }),
      item('Q192237', '362', 'Ghadames', 69, { article: 'Ghadames' }),
    ]);

    expect(factsForSite(index, '362', 'Old Town of <em>Ghadamès</em>').article)
      .toBe('https://en.wikipedia.org/wiki/Old_town_of_Ghadames');
  });

  it('takes the better-known of two items the name fits alike', () => {
    // Jantar Mantar in Jaipur and in New Delhi carry one id and one label.
    const index = indexWorldHeritageFacts([
      item('Q2045115', '1338', 'Jantar Mantar', 20, { article: 'Jantar_Mantar,_New_Delhi' }),
      item('Q508634', '1338', 'Jantar Mantar', 47, { article: 'Jantar_Mantar,_Jaipur' }),
    ]);

    expect(factsForSite(index, '1338', 'The Jantar Mantar, Jaipur').article)
      .toBe('https://en.wikipedia.org/wiki/Jantar_Mantar,_Jaipur');
  });

  it('answers the same whatever order the items arrive in', () => {
    const rows = [
      item('Q156722', '896', 'Altes Museum', 44, { article: 'Altes_Museum', image: 'A.jpg' }),
      item('Q151963', '896', 'Museum Island', 58, { article: 'Museum_Island', image: 'M.jpg' }),
    ];
    const name = 'Museumsinsel (Museum Island), Berlin';

    expect(factsForSite(indexWorldHeritageFacts([...rows].reverse()), '896', name))
      .toEqual(factsForSite(indexWorldHeritageFacts(rows), '896', name));
  });
});

describe('fetchWorldHeritageFacts', () => {
  it('asks for a row per item, never one per id', async () => {
    // Grouped by the id alone, the row is every carrier folded together, and
    // MIN takes the alphabetically first article and picture across them.
    vi.resetModules();
    const sparqlQuery = vi.fn(async (..._args: unknown[]) => [] as SparqlBinding[]);
    vi.doMock('./wikidataUtils.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./wikidataUtils.js')>()),
      sparqlQuery,
    }));
    const { fetchWorldHeritageFacts } = await import('./unescoWikidata.js');
    const { WaitBudget } = await import('./sourceRetry.js');
    const progress = { cancel: false, statusMessage: '' } as Parameters<typeof fetchWorldHeritageFacts>[0];

    await fetchWorldHeritageFacts(progress, new WaitBudget(1000));

    const query = String(sparqlQuery.mock.calls[0][0]);
    expect(query).toMatch(/GROUP BY \?item \?whc \?label \?links/);
    expect(query).toContain('wikibase:sitelinks ?links');
    vi.doUnmock('./wikidataUtils.js');
  });


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

/**
 * A serial site's components resolved to their own Wikidata items (#1269), on
 * Prehistoric Pile Dwellings around the Alps (1363): one item a component's
 * reference names, a reference no item carries, and one two items carry.
 */
describe('resolving components to their items', () => {
  const binding = (whc: string, item: string) => ({
    whc: { type: 'literal', value: whc }, item: { type: 'uri', value: `http://www.wikidata.org/entity/${item}` },
  });
  const index = indexWorldHeritageFacts([
    binding('1363', 'Q1137099'),
    binding('1363-061', 'Q2108010'),
    binding('1363-070', 'Q31828921'),
    binding('1363-070', 'Q31828922'),
  ] as never);

  it('takes the one item a reference names, folding case and blanks', () => {
    const resolution = resolveComponents(index, '1363', ['1363-061', ' 1363-061 ', '1363-099', '1363-070']);
    expect(resolution.items).toEqual([
      { ref: '1363-061', item: 'Q2108010' },
      { ref: ' 1363-061 ', item: 'Q2108010' },
      { ref: '1363-099', item: null },
      { ref: '1363-070', item: null },
    ]);
    expect(resolution.points).toBe(4);
    expect(resolution.resolved).toBe(2);
    expect(resolution.ambiguous).toEqual([{ ref: '1363-070', items: ['Q31828921', 'Q31828922'] }]);
  });

  it('resolves nothing for a site Wikidata names no component of', () => {
    expect(resolveComponents(index, '1428', ['1428-001']).items).toEqual([{ ref: '1428-001', item: null }]);
  });
});

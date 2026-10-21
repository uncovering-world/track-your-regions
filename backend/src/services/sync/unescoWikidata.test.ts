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
import { componentContents, indexWorldHeritageFacts, factsForSite, resolveComponents, siteItems } from './unescoWikidata.js';

const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/';

function binding(whc: string, facts: { article?: string; image?: string } = {}): SparqlBinding {
  return {
    whc: { value: whc },
    ...(facts.article ? { article: { value: facts.article } } : {}),
    ...(facts.image ? { image: { value: COMMONS + facts.image } } : {}),
  };
}

describe('factsForSite', () => {
  it("carries every picture of the item that gave the site its picture (#1778)", () => {
    // Two pictures at one rank, as the query concatenates them: IRIs, so a space in a
    // file name is `%20` and the separator cannot occur inside one. The first by URL is
    // the site's.
    const index = indexWorldHeritageFacts([{
      ...binding('668', { image: 'Anuradhapura%2002.jpg' }),
      images: { value: `${COMMONS}Ruwanwelisaya.jpg ${COMMONS}Anuradhapura%2002.jpg` },
    }]);

    expect(factsForSite(index, '668').picture?.itemPictures)
      .toEqual([COMMONS + 'Anuradhapura%2002.jpg', COMMONS + 'Ruwanwelisaya.jpg']);
  });

  it('answers from the site\'s own id', () => {
    const index = indexWorldHeritageFacts([
      binding('404', { article: 'https://en.wikipedia.org/wiki/Acropolis_of_Athens', image: 'Acropolis.jpg' }),
    ]);

    expect(factsForSite(index, '404')).toEqual({
      article: 'https://en.wikipedia.org/wiki/Acropolis_of_Athens',
      picture: { url: COMMONS + 'Acropolis.jpg', via: 'exact', ref: '404', itemPictures: [COMMONS + 'Acropolis.jpg'] },
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
      picture: { url: COMMONS + 'Sydney.jpg', via: 'variant', ref: '166rev', itemPictures: [COMMONS + 'Sydney.jpg'] },
    });
  });

  it('prefers the site\'s own id over a later numbering of it', () => {
    // Cologne Cathedral carries both, `292bis` at preferred rank
    const index = indexWorldHeritageFacts([
      binding('292bis', { image: 'Extension.jpg' }),
      binding('292', { image: 'Koelner Dom.jpg' }),
    ]);

    expect(factsForSite(index, '292').picture)
      .toEqual({ url: COMMONS + 'Koelner Dom.jpg', via: 'exact', ref: '292', itemPictures: [COMMONS + 'Koelner Dom.jpg'] });
  });

  it('falls back to a component, taking the lowest-numbered one', () => {
    const index = indexWorldHeritageFacts([
      binding('1142-15bis', { image: 'Fifteen.jpg' }),
      binding('1142-01bis', { image: 'One.jpg' }),
      binding('1142-02', { image: 'Two.jpg' }),
    ]);

    expect(factsForSite(index, '1142').picture)
      .toEqual({ url: COMMONS + 'One.jpg', via: 'component', ref: '1142-01bis', itemPictures: [COMMONS + 'One.jpg'] });
  });

  it('reads a component of a renumbered site as a component of the site', () => {
    const index = indexWorldHeritageFacts([binding('1246bis-001f', { image: 'Santa Maria.jpg' })]);

    expect(factsForSite(index, '1246').picture)
      .toEqual({ url: COMMONS + 'Santa Maria.jpg', via: 'component', ref: '1246bis-001f', itemPictures: [COMMONS + 'Santa Maria.jpg'] });
  });

  it('never takes a component\'s article for the site\'s', () => {
    // A picture of one component is a picture of the property; an article about
    // one component is an article about that component.
    const index = indexWorldHeritageFacts([
      binding('1142-01bis', { article: 'https://en.wikipedia.org/wiki/One_church', image: 'One.jpg' }),
    ]);

    expect(factsForSite(index, '1142')).toEqual({
      article: null,
      picture: { url: COMMONS + 'One.jpg', via: 'component', ref: '1142-01bis', itemPictures: [COMMONS + 'One.jpg'] },
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
      .toEqual({ url: COMMONS + 'Fourth.jpg', via: 'component', ref: '91-004a', itemPictures: [COMMONS + 'Fourth.jpg'] });
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
      picture: { url: COMMONS + 'Berlin Museumsinsel Fernsehturm.jpg', via: 'exact', ref: '896', itemPictures: [COMMONS + 'Berlin Museumsinsel Fernsehturm.jpg'] },
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

  it("resolves nothing from a reference that differs only by the inscription's variant (#1344)", () => {
    // Getbol: the list says 1591bis-004 for Gochang's tidal flat; Wikidata's
    // 1591-004 is Boseong's — an extension renumbered the parts, so the bare
    // number is not an identity. The finder proposes such an item; this does not.
    const getbol = indexWorldHeritageFacts([binding('1591-004', 'Q66311160')] as never);
    expect(resolveComponents(getbol, '1591', ['1591bis-004']).items).toEqual([{ ref: '1591bis-004', item: null }]);
  });

  it("resolves a reference the list pads with a leading zero, and never folds Wikidata's (#1393)", () => {
    // Thebes: the list says 087-001 for the Temple of Karnak; Karnak Temple
    // Complex carries 87-001. A Wikidata value of 087-002 is a typo on the wiki.
    const thebes = indexWorldHeritageFacts([binding('87-001', 'Q522862'), binding('087-002', 'Q319841')] as never);
    expect(resolveComponents(thebes, '87', ['087-001', '87-001', '087-002']).items).toEqual([
      { ref: '087-001', item: 'Q522862' },
      { ref: '87-001', item: 'Q522862' },
      { ref: '087-002', item: null },
    ]);
  });

  it('resolves nothing for a site Wikidata names no component of', () => {
    expect(resolveComponents(index, '1428', ['1428-001']).items).toEqual([{ ref: '1428-001', item: null }]);
  });

  it('takes no item from a statement that is only deprecated, and leaves the other carrier unambiguous', () => {
    const deprecated = { ...binding('1363-070', 'Q31828922'), rank: { type: 'literal', value: 'http://wikiba.se/ontology#DeprecatedRank' } };
    const ranked = indexWorldHeritageFacts([binding('1363-070', 'Q31828921'), deprecated] as never);
    expect(resolveComponents(ranked, '1363', ['1363-070']).items).toEqual([{ ref: '1363-070', item: 'Q31828921' }]);
    expect(resolveComponents(indexWorldHeritageFacts([deprecated] as never), '1363', ['1363-070']).items)
      .toEqual([{ ref: '1363-070', item: null }]);
  });
});

/** What a component's item says about it (#1270): its picture and its description. */
describe("a component's picture and description", () => {
  const binding = (whc: string, item: string, image: string | null, description: string | null) => ({
    whc: { type: 'literal', value: whc }, item: { type: 'uri', value: `http://www.wikidata.org/entity/${item}` },
    ...(image ? { image: { type: 'uri', value: image } } : {}),
    ...(description ? { description: { type: 'literal', value: description } } : {}),
  });
  const RIESI = 'http://commons.wikimedia.org/wiki/Special:FilePath/Riesi.jpg';
  const index = indexWorldHeritageFacts([
    binding('1363-002', 'Q2108011', RIESI, 'prehistoric pile dwelling in Switzerland'),
    binding('1363-061', 'Q2108010', null, null),
  ] as never);

  it("gives a resolved component its item's picture and description, and an unresolved one neither", () => {
    const resolution = resolveComponents(index, '1363', ['1363-002', '1363-061', '1363-099']);
    expect(componentContents(index, '1363', resolution.items)).toEqual([
      { ref: '1363-002', image: RIESI, description: 'prehistoric pile dwelling in Switzerland' },
      { ref: '1363-061', image: null, description: null },
      { ref: '1363-099', image: null, description: null },
    ]);
  });
});

/** A site's own items (#1248, ADR-0088): the property tier, else a later numbering, never a component's. */
describe("a World Heritage site's items", () => {
  const binding = (whc: string, item: string) => ({
    whc: { type: 'literal', value: whc }, item: { type: 'uri', value: `http://www.wikidata.org/entity/${item}` },
  });

  it('reads the property tier, and a component never', () => {
    const index = indexWorldHeritageFacts([binding('81', 'Q180274'), binding('81-001', 'Q999')] as never);
    expect(siteItems(index, '81')).toEqual(['Q180274']);
  });

  it('falls back to a later numbering where no item carries the property number', () => {
    const index = indexWorldHeritageFacts([binding('292bis', 'Q4176')] as never);
    expect(siteItems(index, '292')).toEqual(['Q4176']);
  });

  it('names every item where several carry the number', () => {
    const index = indexWorldHeritageFacts([binding('394', 'Q641'), binding('394', 'Q2366479')] as never);
    expect(siteItems(index, '394')).toEqual(['Q2366479', 'Q641']);
  });

  it('leaves out an item that carries the number only in deprecated statements', () => {
    const deprecated = { ...binding('896', 'Q157043'), rank: { type: 'literal', value: 'http://wikiba.se/ontology#DeprecatedRank' } };
    const index = indexWorldHeritageFacts([binding('896', 'Q4176'), deprecated] as never);
    expect(siteItems(index, '896')).toEqual(['Q4176']);
    expect(siteItems(indexWorldHeritageFacts([deprecated] as never), '896')).toEqual([]);
  });

  it('falls back to a later numbering where every item of the property tier is deprecated', () => {
    const deprecated = { ...binding('292', 'Q999'), rank: { type: 'literal', value: 'http://wikiba.se/ontology#DeprecatedRank' } };
    const index = indexWorldHeritageFacts([deprecated, binding('292bis', 'Q4176')] as never);
    expect(siteItems(index, '292')).toEqual(['Q4176']);
  });
});

/**
 * The item named as the property, whichever numbering it carries (#1373).
 * Every pair is one Wikidata held on 2026-10-12.
 */
describe("a World Heritage site's items, where one is named as the property", () => {
  it('takes the whole over a part that carries only the first number', () => {
    const index = indexWorldHeritageFacts([
      item('Q12506', '356', 'Hagia Sophia', 152),
      item('Q5773394', '356', 'Historic Areas of Istanbul', 24),
      item('Q5773394', '356bis', 'Historic Areas of Istanbul', 24),
    ]);
    expect(siteItems(index, '356', 'Historic Areas of Istanbul')).toEqual(['Q5773394']);
  });

  it("takes the extended inscription's item over the earlier inscription's", () => {
    const index = indexWorldHeritageFacts([
      item('Q3197288', '1468', 'Christiansfeld', 60),
      item('Q128009257', '1468bis', 'Moravian Church Settlements', 3),
    ]);
    expect(siteItems(index, '1468', 'Moravian Church Settlements')).toEqual(['Q128009257']);
  });

  it('reads a plural and its singular as one word (#1403)', () => {
    // The 1998 inscription is the Côa Valley alone; the property since 2010 adds Siega Verde.
    const index = indexWorldHeritageFacts([
      item('Q552106', '866', 'Prehistoric Rock Art Sites in the Côa Valley', 30),
      item('Q39258498', '866bis', 'Prehistoric Rock-Art Site of the Côa Valley and Siega Verde', 10),
    ]);
    expect(siteItems(index, '866', 'Prehistoric Rock Art Sites in the Côa Valley and Siega Verde')).toEqual(['Q39258498']);
  });

  it('keeps every item named alike', () => {
    const index = indexWorldHeritageFacts([
      item('Q38095', '1', 'Galápagos Islands', 140),
      item('Q117188122', '1', 'Galápagos Islands', 2),
    ]);
    expect(siteItems(index, '1', 'Galápagos Islands')).toEqual(['Q117188122', 'Q38095']);
  });

  it('reads the tiers as before where no label lies wholly in the name', () => {
    const index = indexWorldHeritageFacts([item('Q189417', '1708', 'Appian Way', 70)]);
    expect(siteItems(index, '1708', 'Via Appia. <em>Regina Viarum</em>')).toEqual(['Q189417']);
  });
});

describe('factsForSite, where an extension renumbered the property (#1373)', () => {
  it("answers from the item named as the property, not from the first inscription's", () => {
    // Bagrati Cathedral left the property in 2017; Gelati Monastery is `710bis`.
    const index = indexWorldHeritageFacts([
      item('Q16147548', '710', 'Bagrati Cathedral and Gelati Monastery', 12, { image: 'Kutaisi, Bagrati Cathedral.jpg' }),
      item('Q679979', '710bis', 'Gelati Monastery', 40, { article: 'Gelati_Monastery', image: 'Gelati Monastery 1.jpg' }),
    ]);
    expect(factsForSite(index, '710', 'Gelati Monastery')).toEqual({
      article: 'https://en.wikipedia.org/wiki/Gelati_Monastery',
      picture: { url: COMMONS + 'Gelati Monastery 1.jpg', via: 'variant', ref: '710bis', itemPictures: [COMMONS + 'Gelati Monastery 1.jpg'] },
    });
  });

  it("asks the components before a carrier that hardly answers to the name, where the property's item has no picture", () => {
    // Cavernas do Peruaçu carries the Cerrado's `1035`; its cave is 600 km from either park.
    const index = indexWorldHeritageFacts([
      item('Q1051873', '1035', 'Cavernas do Peruaçu National Park', 30, { image: 'Caverna Janelão.jpg' }),
      item('Q137787234', '1035bis', 'Cerrado Protected Areas: Chapada dos Veadeiros and Emas National Parks', 2),
      binding('1035-001', { image: 'Vale do Rio Preto.jpg' }),
    ]);
    expect(factsForSite(index, '1035', 'Cerrado Protected Areas: Chapada dos Veadeiros and Emas National Parks').picture)
      .toEqual({ url: COMMONS + 'Vale do Rio Preto.jpg', via: 'component', ref: '1035-001', itemPictures: [COMMONS + 'Vale do Rio Preto.jpg'] });
  });

  it("takes no little-known carrier's article where the property's item has none, its own number's first one included", () => {
    // Christiansfeld's sitelinks put under the bar, to stand for a little-known part.
    const index = indexWorldHeritageFacts([
      item('Q3197288', '1468', 'Christiansfeld', 4, { article: 'Christiansfeld' }),
      item('Q128009257', '1468bis', 'Moravian Church Settlements', 3),
    ]);
    expect(factsForSite(index, '1468', 'Moravian Church Settlements').article).toBeNull();
  });

  it('lets the best-known carrier stand in for the article, not the one named most nearly', () => {
    // Sitelinks set to put the partly named carrier below the unnamed one.
    const index = indexWorldHeritageFacts([
      item('Q3197288', '1468', 'Christiansfeld Moravian Settlement', 15, { article: 'Christiansfeld' }),
      item('Q165140', '1468', 'Herrnhut', 200, { article: 'Herrnhut' }),
      item('Q128009257', '1468bis', 'Moravian Church Settlements', 3),
    ]);
    expect(factsForSite(index, '1468', 'Moravian Church Settlements').article).toBe('https://en.wikipedia.org/wiki/Herrnhut');
  });

  it('still takes such a carrier\'s picture where nothing else has one', () => {
    const index = indexWorldHeritageFacts([
      item('Q129503044', '1708', 'Via Appia. Regina Viarum', 3),
      item('Q189417', '1708', 'Appian Way', 70, { image: 'Appian Way.jpg' }),
    ]);
    expect(factsForSite(index, '1708', 'Via Appia. <em>Regina Viarum</em>').picture?.url).toBe(COMMONS + 'Appian Way.jpg');
  });
});

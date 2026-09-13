/**
 * Tests for the walk down an English Wikipedia category tree.
 *
 * What these pin is the shape of the tree, which is editorial and not a
 * taxonomy: a country category sits beside siblings about other kinds, the same
 * category is reachable by two parents, and an article may be about no Wikidata
 * item at all. A walk that took every child would fill this kind with another
 * one's museums; one that read a category twice would pay for the whole tree
 * twice; one that guessed an id from a title would invent a museum.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';

const NATURE = /^Archaeological museums (in|of) /;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A tree of categories: the articles filed under each, and the subcategories of each. */
interface Tree {
  /** Category title → article title → the Wikidata item it is about, or null for none. */
  pages: Record<string, Record<string, string | null>>;
  /** Category title → the subcategory titles it holds. */
  subcats?: Record<string, string[]>;
}

/**
 * English Wikipedia as the walk asks it: one answer per question, built off the
 * tree. A category with no articles answers with no `query` at all, which is
 * what the live API does and not a refusal.
 */
function wikipedia(tree: Tree) {
  const sent: URLSearchParams[] = [];
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = new URLSearchParams(String(init?.body));
    sent.push(body);
    seen.push({ url: String(url), init });
    if (body.get('list') === 'categorymembers') {
      const titles = tree.subcats?.[body.get('cmtitle') ?? ''] ?? [];
      return json({ query: { categorymembers: titles.map((title) => ({ ns: 14, title })) } });
    }
    const pages = tree.pages[body.get('gcmtitle') ?? ''];
    if (!pages) return json({ batchcomplete: true });
    return json({
      query: {
        pages: Object.entries(pages).map(([title, qid], i) => ({
          pageid: i + 1, ns: 0, title, ...(qid ? { pageprops: { wikibase_item: qid } } : {}),
        })),
      },
    });
  };
  const asked = (kind: 'pages' | 'subcats') => sent
    .filter((body) => (kind === 'pages' ? body.has('gcmtitle') : body.has('cmtitle')))
    .map((body) => body.get(kind === 'pages' ? 'gcmtitle' : 'cmtitle'));
  return { fetchImpl, sent, seen, asked };
}

const ROOT = 'Category:Archaeological museums by country';

describe('fetchCategoryMembers', () => {
  it('answers with the Wikidata item each article is about', async () => {
    // The Bardo is `museum` on Wikidata and `Archaeological museums in Tunisia`
    // on its article: without this walk it reaches no pool at all.
    const { fetchImpl } = wikipedia({
      pages: {
        'Category:Archaeological museums in Tunisia': {
          'Bardo National Museum (Tunis)': 'Q1429003',
          'Carthage National Museum': 'Q1961849',
        },
      },
    });

    const got = await fetchCategoryMembers('Category:Archaeological museums in Tunisia', {
      userAgent: 'test', fetchImpl, recurseInto: NATURE,
    });

    expect([...got]).toEqual([
      ['Bardo National Museum (Tunis)', 'Q1429003'],
      ['Carthage National Museum', 'Q1961849'],
    ]);
  });

  it('follows only the subcategories the caller\'s rule names', async () => {
    // Greece nests `Archaeological museums in Crete` beside `Byzantine museums
    // in Greece` and `Archaeological collections in Greece`, which belong to
    // other kinds. A walk that took every child would collect them.
    const { fetchImpl, asked } = wikipedia({
      pages: {
        'Category:Archaeological museums in Crete': { 'Heraklion Archaeological Museum': 'Q1543941' },
        'Category:Byzantine museums in Greece': { 'Byzantine and Christian Museum': 'Q1001296' },
      },
      subcats: {
        [ROOT]: ['Category:Archaeological museums in Greece'],
        'Category:Archaeological museums in Greece': [
          'Category:Archaeological museums in Crete',
          'Category:Byzantine museums in Greece',
          'Category:Archaeological collections in Greece',
        ],
      },
    });

    const got = await fetchCategoryMembers(ROOT, { userAgent: 'test', fetchImpl, recurseInto: NATURE });

    expect([...got.values()]).toEqual(['Q1543941']);
    expect(asked('pages')).toEqual([
      ROOT,
      'Category:Archaeological museums in Greece',
      'Category:Archaeological museums in Crete',
    ]);
  });

  it('walks no deeper than it was told to', async () => {
    const { fetchImpl, asked } = wikipedia({
      pages: { 'Category:Archaeological museums in Crete': { 'Heraklion Archaeological Museum': 'Q1543941' } },
      subcats: {
        [ROOT]: ['Category:Archaeological museums in Greece'],
        'Category:Archaeological museums in Greece': ['Category:Archaeological museums in Crete'],
      },
    });

    const got = await fetchCategoryMembers(ROOT, {
      userAgent: 'test', fetchImpl, recurseInto: NATURE, maxDepth: 1,
    });

    expect([...got.values()]).toEqual([]);
    // The root is depth 0 and Greece depth 1: Greece is read, and the walk asks
    // nothing about what it holds below.
    expect(asked('pages')).toEqual([ROOT, 'Category:Archaeological museums in Greece']);
    expect(asked('subcats')).toEqual([ROOT]);
  });

  it('reads a category once however many parents lead to it', async () => {
    // Wikipedia's categories are a graph, not a tree: a category can be filed
    // under two parents, and two of them under each other.
    const { fetchImpl, asked } = wikipedia({
      pages: { 'Category:Archaeological museums in Italy': { 'Museo Nazionale Romano': 'Q1954237' } },
      subcats: {
        [ROOT]: ['Category:Archaeological museums in Italy', 'Category:Archaeological museums in Lazio'],
        'Category:Archaeological museums in Italy': ['Category:Archaeological museums in Lazio'],
        'Category:Archaeological museums in Lazio': ['Category:Archaeological museums in Italy'],
      },
    });

    const got = await fetchCategoryMembers(ROOT, { userAgent: 'test', fetchImpl, recurseInto: NATURE });

    expect([...got.values()]).toEqual(['Q1954237']);
    expect(asked('pages')).toEqual([
      ROOT,
      'Category:Archaeological museums in Italy',
      'Category:Archaeological museums in Lazio',
    ]);
  });

  it('keeps asking while the answer carries a continuation', async () => {
    const answers = [
      json({
        continue: { gcmcontinue: 'page|2', continue: 'gcmcontinue||' },
        query: { pages: [{ title: 'Bardo National Museum (Tunis)', pageprops: { wikibase_item: 'Q1429003' } }] },
      }),
      json({
        query: { pages: [{ title: 'Sousse Archaeological Museum', pageprops: { wikibase_item: 'Q3329457' } }] },
      }),
    ];
    const sent: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(String(init?.body));
      return answers.shift() ?? json({ query: { categorymembers: [] } });
    };

    const got = await fetchCategoryMembers('Category:Archaeological museums in Tunisia', {
      userAgent: 'test', fetchImpl, recurseInto: NATURE,
    });

    expect([...got.values()]).toEqual(['Q1429003', 'Q3329457']);
    expect(sent[0]).not.toContain('gcmcontinue');
    expect(sent[1]).toContain('gcmcontinue=page%7C2');
  });

  it('keeps asking while a subcategory listing carries a continuation', async () => {
    // Five hundred subcategories to an answer is far past any country, but a
    // listing read only to its first page loses whole countries in silence —
    // and this walk is what brings those countries' museums in at all.
    const answers = [
      json({
        continue: { cmcontinue: 'subcat|2', continue: '-||' },
        query: { categorymembers: [{ ns: 14, title: 'Category:Archaeological museums in Tunisia' }] },
      }),
      json({
        query: { categorymembers: [{ ns: 14, title: 'Category:Archaeological museums in Turkey' }] },
      }),
    ];
    const pages: Record<string, Record<string, string>> = {
      'Category:Archaeological museums in Tunisia': { 'Bardo National Museum (Tunis)': 'Q1429003' },
      'Category:Archaeological museums in Turkey': { 'Zeugma Mosaic Museum': 'Q196982' },
    };
    const sent: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      sent.push(String(init?.body));
      if (body.get('list') === 'categorymembers') return answers.shift() ?? json({ query: { categorymembers: [] } });
      const found = pages[body.get('gcmtitle') ?? ''];
      if (!found) return json({ batchcomplete: true });
      return json({
        query: {
          pages: Object.entries(found).map(([title, qid]) => ({
            title, pageprops: { wikibase_item: qid },
          })),
        },
      });
    };

    const got = await fetchCategoryMembers(ROOT, { userAgent: 'test', fetchImpl, recurseInto: NATURE });

    expect([...got.values()].sort()).toEqual(['Q1429003', 'Q196982']);
    expect(sent.some((body) => body.includes('cmcontinue=subcat%7C2'))).toBe(true);
  });

  it('counts the articles that are about no Wikidata item, and says how many', async () => {
    // A title is not an id, so such an article is skipped rather than guessed
    // at — and the count is said out loud, because a category filled with
    // redirects would otherwise go unnoticed.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetchImpl } = wikipedia({
      pages: {
        'Category:Archaeological museums in Tunisia': {
          'Bardo National Museum (Tunis)': 'Q1429003',
          'List of museums in Tunisia': null,
        },
      },
    });

    const got = await fetchCategoryMembers('Category:Archaeological museums in Tunisia', {
      userAgent: 'test', fetchImpl, recurseInto: NATURE,
    });

    expect([...got.values()]).toEqual(['Q1429003']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 article'));
    log.mockRestore();
  });

  it('takes a category with no articles for an empty one, not a refusal', async () => {
    // The live API answers a generator that matched nothing with no `query` at
    // all, and the root category itself is one: every museum is in a country.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetchImpl } = wikipedia({
      pages: { 'Category:Archaeological museums in Tunisia': { 'Bardo National Museum (Tunis)': 'Q1429003' } },
      subcats: { [ROOT]: ['Category:Archaeological museums in Tunisia'] },
    });

    const got = await fetchCategoryMembers(ROOT, { userAgent: 'test', fetchImpl, recurseInto: NATURE });

    expect([...got.values()]).toEqual(['Q1429003']);
    // And the line counts in English: one subcategory is not "1 subcategories".
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`0 pages, 1 subcategory under "${ROOT}"`));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('1 page, 0 subcategories under "Category:Archaeological museums in Tunisia"'),
    );
    log.mockRestore();
  });

  it('throws, naming the category, when the API refuses it', async () => {
    // Swallowed, a lost category is every museum in a country silently missing
    // from the catalogue on a run whose log said success.
    const fetchImpl = async () => new Response('not today', { status: 400 });
    await expect(fetchCategoryMembers(ROOT, { userAgent: 'test', fetchImpl, recurseInto: NATURE }))
      .rejects.toThrow(new RegExp(ROOT));
  });

  it('asks the right question, the right way, and says who is asking', async () => {
    const { fetchImpl, sent, seen } = wikipedia({
      pages: { [ROOT]: {} },
      subcats: { [ROOT]: [] },
    });

    await fetchCategoryMembers(ROOT, {
      userAgent: 'a-caller/1.0 (contact@example.org)', fetchImpl, recurseInto: NATURE,
    });

    expect(seen[0].url).toBe('https://en.wikipedia.org/w/api.php');
    expect(seen[0].init?.method).toBe('POST');
    expect((seen[0].init?.headers as Record<string, string>)['User-Agent'])
      .toBe('a-caller/1.0 (contact@example.org)');
    const pages = sent[0];
    expect(pages.get('generator')).toBe('categorymembers');
    expect(pages.get('gcmtitle')).toBe(ROOT);
    expect(pages.get('gcmtype')).toBe('page');
    expect(pages.get('ppprop')).toBe('wikibase_item');
    // The whole page of members a request may carry: a listing asked in
    // tens is the same country lost, one continuation at a time.
    expect(pages.get('gcmlimit')).toBe('max');
    expect(sent[1].get('list')).toBe('categorymembers');
    expect(sent[1].get('cmtype')).toBe('subcat');
    expect(sent[1].get('cmlimit')).toBe('max');
  });
});

/**
 * An article named the way OpenStreetMap names one — `lang:Title` — resolved
 * to the Wikidata item it is about, through that wiki's own API (#895).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveWikipediaArticles } from './wikipediaArticles.js';

interface Asked { url: string; body: URLSearchParams }

/** What the site matrix says exists: the Wikipedias these tests may name. */
const EDITIONS = ['en', 'tr', 'sr', 'el', 'de', 'es'];

/**
 * A wiki that answers with the item of every page it was asked about, under
 * the title it holds — listing what it normalised (`Nemrut_Dağı` to
 * `Nemrut Dağı`) and what it redirected (`Gerasa` to `Jerash`) apart, as the
 * API does.
 */
function wiki(
  items: Record<string, string>, redirects: Record<string, string> = {}, normalized: Record<string, string> = {},
) {
  const asked: Asked[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = new URLSearchParams(String(init?.body));
    asked.push({ url: String(input), body });
    if (body.get('action') === 'sitematrix') {
      return new Response(JSON.stringify({ sitematrix: {
        count: EDITIONS.length,
        ...Object.fromEntries(EDITIONS.map((code, i) => [String(i), { code, site: [{ code: 'wiki', url: `https://${code}.wikipedia.org` }] }])),
      } }), { status: 200 });
    }
    const titles = (body.get('titles') ?? '').split('|');
    const hops = (by: Record<string, string>) => (from: string) => (by[from] ? [{ from, to: by[from] }] : []);
    const tidied = titles.flatMap(hops(normalized));
    const moved = titles.map((t) => normalized[t] ?? t).flatMap(hops(redirects));
    const pages = titles.map((title, i) => {
      const tidy = normalized[title] ?? title;
      const held = redirects[tidy] ?? tidy;
      return items[held]
        ? { pageid: i + 1, title: held, pageprops: { wikibase_item: items[held] } }
        : { title: held, missing: true };
    });
    return new Response(JSON.stringify({ query: { normalized: tidied, redirects: moved, pages } }), { status: 200 });
  };
  return { asked, fetchImpl };
}

describe('resolveWikipediaArticles', () => {
  it('asks each language\'s own wiki, and answers under the name the map used', async () => {
    const { asked, fetchImpl } = wiki({ 'Nemrut Dağı': 'Q207917', 'Gamzigrad': 'Q904128', 'Jerash': 'Q31565' });
    const got = await resolveWikipediaArticles(
      ['tr:Nemrut Dağı', 'en:Jerash', 'sr:Gamzigrad', 'en:Jerash'],
      { userAgent: 'test', fetchImpl },
    );
    expect(got).toEqual(new Map([
      ['tr:Nemrut Dağı', 'Q207917'], ['en:Jerash', 'Q31565'], ['sr:Gamzigrad', 'Q904128'],
    ]));
    // The site matrix once, then each language's own wiki.
    expect(asked.filter((a) => a.body.get('action') === 'sitematrix')).toHaveLength(1);
    expect(asked.filter((a) => a.body.get('action') !== 'sitematrix').map((a) => a.url).sort()).toEqual([
      'https://en.wikipedia.org/w/api.php', 'https://sr.wikipedia.org/w/api.php', 'https://tr.wikipedia.org/w/api.php',
    ]);
    const en = asked.find((a) => a.url.startsWith('https://en.') && a.body.get('action') !== 'sitematrix')!;
    expect(en.body.get('prop')).toBe('pageprops');
    expect(en.body.get('ppprop')).toBe('wikibase_item');
    expect(en.body.get('redirects')).toBe('1');
    // Asked once, however many objects named it.
    expect(en.body.get('titles')).toBe('Jerash');
  });

  it('follows a redirect back to the name the map used', async () => {
    const { fetchImpl } = wiki({ 'Aigai (Macedonia)': 'Q16963755' }, { Vergina: 'Aigai (Macedonia)' });
    const got = await resolveWikipediaArticles(['el:Vergina'], { userAgent: 'test', fetchImpl });
    expect(got.get('el:Vergina')).toBe('Q16963755');
  });

  it('leaves out an article no item is about, and a name that is not a wiki', async () => {
    const { asked, fetchImpl } = wiki({});
    const got = await resolveWikipediaArticles(
      ['en:Nothing here', 'https://en.wikipedia.org/wiki/Jerash', 'Jerash', 'en!:Jerash'],
      { userAgent: 'test', fetchImpl },
    );
    expect(got.size).toBe(0);
    expect(asked.filter((a) => a.body.get('action') !== 'sitematrix')).toHaveLength(1);
  });

  it('refuses a title carrying a pipe, which the API reads as two', async () => {
    // `en:Foo|Bar` joined into a batch of fifty is fifty-one values and a
    // `toomanyvalues` that ends the run; below the limit it is an object filed
    // under nothing. No MediaWiki title contains one.
    const { asked, fetchImpl } = wiki({ Jerash: 'Q31565' });
    const got = await resolveWikipediaArticles(['en:Foo|Bar', 'en:Jerash'], { userAgent: 'test', fetchImpl });
    expect(got).toEqual(new Map([['en:Jerash', 'Q31565']]));
    const titles = asked.filter((a) => a.body.get('action') !== 'sitematrix').map((a) => a.body.get('titles'));
    expect(titles).toEqual(['Jerash']);
  });

  it('leaves out a tag that names a section: the object is a part of what the article is about', async () => {
    // Fuerte Ballenar's node carries `es:Antuco#Historia` (2026-09-15): the
    // fort is told in a section of the town's article, and the town's item
    // is not what the mapper linked. Resolved, Antuco — a Chilean town Wikidata
    // counts no people in — walked in as a dig on dry run 137. 229 of the
    // run's 2,027 article-only objects name a section.
    const { asked, fetchImpl } = wiki({ Antuco: 'Q3619' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const got = await resolveWikipediaArticles(['es:Antuco#Historia'], { userAgent: 'test', fetchImpl });
      expect(got).toEqual(new Map());
      expect(asked.filter((a) => a.body.get('action') !== 'sitematrix')).toHaveLength(0);
      // Counted on the run, so the `N of M resolved` line and the map's own
      // count of tagged articles still reconcile.
      expect(log.mock.calls.map((c) => String(c[0]))).toContainEqual(
        expect.stringContaining('1 tagged article(s) name a section of an article, left out'),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('never asks a wiki the site matrix does not list', async () => {
    // `zz:` is a code no Wikipedia answers to; asked, the door would retry a
    // host that does not exist and end the run on one mapper's tag.
    const { asked, fetchImpl } = wiki({ Jerash: 'Q31565' });
    const got = await resolveWikipediaArticles(['zz:Ruins of Nowhere', 'en:Jerash'], { userAgent: 'test', fetchImpl });
    expect(got).toEqual(new Map([['en:Jerash', 'Q31565']]));
    expect(asked.map((a) => a.url)).not.toContain('https://zz.wikipedia.org/w/api.php');
  });

  it('fails the batch when a wiki answers without a query, rather than resolving nothing', async () => {
    // A 200 with no `query` at all — a wiki in read-only, an error page cached
    // upstream — read as "no article resolves" would drop fifty tags quietly,
    // and the rows they named would be refused on the next run as rows the
    // map does not carry. The category reader throws on it; so does this one.
    const { fetchImpl: matrixOnly } = wiki({});
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('action') === 'sitematrix') return matrixOnly(input, init);
      return new Response(JSON.stringify({ batchcomplete: true }), { status: 200 });
    };
    await expect(resolveWikipediaArticles(['en:Jerash'], { userAgent: 'test', fetchImpl }))
      .rejects.toThrow(/answered without a query/);
  });

  it('answers under the tag exactly as the map wrote it, spaces and all', async () => {
    // The pool looks the answer up by the raw `wikipedia` tag; a tag written
    // with a space after the colon is asked for trimmed and answered under
    // itself, or the object is filed under nothing while the count says resolved.
    const { fetchImpl } = wiki({ 'Nemrut Dağı': 'Q207917' });
    const got = await resolveWikipediaArticles(['de: Nemrut Dağı', 'de:Nemrut Dağı '], { userAgent: 'test', fetchImpl });
    expect(got).toEqual(new Map([['de: Nemrut Dağı', 'Q207917'], ['de:Nemrut Dağı ', 'Q207917']]));
  });

  it('answers every tag that reaches one page, when two normalise together', async () => {
    // `de:Nemrut_Dağı` and `de:Nemrut Dağı` are two tags and one page: the
    // API normalises the first onto the second and answers once, and both
    // objects are filed under the item.
    const { fetchImpl } = wiki({ 'Nemrut Dağı': 'Q207917' }, {}, { 'Nemrut_Dağı': 'Nemrut Dağı' });
    const got = await resolveWikipediaArticles(['de:Nemrut_Dağı', 'de:Nemrut Dağı'], { userAgent: 'test', fetchImpl });
    expect(got).toEqual(new Map([['de:Nemrut_Dağı', 'Q207917'], ['de:Nemrut Dağı', 'Q207917']]));
  });
});

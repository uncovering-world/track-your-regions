/**
 * Where a Wikidata id can take a curator.
 *
 * The id is the one identifier every catalogue row carries, and the two pages it
 * opens are built here and nowhere else: the item, and the article Wikidata's own
 * redirect resolves for it. Both are built only from an id that *is* a QID — a
 * template literal over `external_id` would send a UNESCO row's `738` to
 * `wikidata.org/wiki/738`, which is not a page.
 */

import { describe, it, expect } from 'vitest';
import { wikidataItemUrl, wikipediaArticleTitle, wikipediaArticleUrl } from './wikidataLinks';

describe('wikidataItemUrl', () => {
  it('opens the item for a QID', () => {
    expect(wikidataItemUrl('Q1662392')).toBe('https://www.wikidata.org/wiki/Q1662392');
  });

  it('answers nothing for an id that is not a QID', () => {
    // A World Heritage id, a curator-created row's id, an empty value: none of them
    // is a Wikidata page, and a link to `wikidata.org/wiki/738` would be a dead end.
    for (const id of ['738', 'manual-12', 'q12', 'Q12a', '', ' Q12', undefined, null]) {
      expect(wikidataItemUrl(id), String(id)).toBeNull();
    }
  });
});

describe('wikipediaArticleUrl', () => {
  it('asks Wikidata to resolve the English article by default', () => {
    // Checked on 2026-09-05: this address answers 302 to en.wikipedia.org/wiki/Pera_Museum.
    expect(wikipediaArticleUrl('Q1662392'))
      .toBe('https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q1662392');
  });

  it('takes the language it is given', () => {
    expect(wikipediaArticleUrl('Q1370397', 'et'))
      .toBe('https://www.wikidata.org/wiki/Special:GoToLinkedPage/etwiki/Q1370397');
  });

  it('answers nothing for an id that is not a QID, or a language that is not a code', () => {
    expect(wikipediaArticleUrl('738')).toBeNull();
    expect(wikipediaArticleUrl(null)).toBeNull();
    // The language is a path segment of a URL we build; only a wiki language code may
    // become one, so a value that is not one answers nothing rather than a broken address.
    expect(wikipediaArticleUrl('Q1662392', 'en/../')).toBeNull();
    expect(wikipediaArticleUrl('Q1662392', '')).toBeNull();
  });
});

describe('wikipediaArticleTitle', () => {
  it('reads the title a reader names the article by (#1975)', () => {
    expect(wikipediaArticleTitle('https://en.wikipedia.org/wiki/Statue_of_Liberty')).toBe('Statue of Liberty');
    expect(wikipediaArticleTitle('https://en.wikipedia.org/wiki/Cavernas_do_Perua%C3%A7u_Environmental_Protection_Area'))
      .toBe('Cavernas do Peruaçu Environmental Protection Area');
  });

  it('gives back an address that names no article as it is', () => {
    expect(wikipediaArticleTitle('https://en.wikipedia.org/w/index.php?curid=1')).toBe('https://en.wikipedia.org/w/index.php?curid=1');
    expect(wikipediaArticleTitle('not a url')).toBe('not a url');
  });
});

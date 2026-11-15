import { describe, expect, it } from 'vitest';
import { editionLanguage, wikivoyageArticleUrl } from './articleUrl.js';

/**
 * A kept article's address (#2520), on titles the editions write: Mantineia
 * in German Wikivoyage, the Old Town of Brest in Russian, a district of
 * London as a subpage, and titles that hold a question mark, an ampersand or a
 * percent sign.
 */

describe('editionLanguage', () => {
  it("names an edition's language as its host does", () => {
    expect(editionLanguage('dewikivoyage')).toBe('de');
    expect(editionLanguage('enwikivoyage')).toBe('en');
    expect(editionLanguage('shnwikivoyage')).toBe('shn');
  });
});

describe('wikivoyageArticleUrl', () => {
  it("opens the article on its edition's own host, spaces as underscores", () => {
    expect(wikivoyageArticleUrl('dewikivoyage', 'Mantineia')).toBe('https://de.wikivoyage.org/wiki/Mantineia');
    expect(wikivoyageArticleUrl('itwikivoyage', 'Arcadia (Grecia)')).toBe('https://it.wikivoyage.org/wiki/Arcadia_(Grecia)');
  });

  it('encodes a title outside ASCII as UTF-8', () => {
    expect(wikivoyageArticleUrl('ruwikivoyage', 'Старый Брест'))
      .toBe('https://ru.wikivoyage.org/wiki/%D0%A1%D1%82%D0%B0%D1%80%D1%8B%D0%B9_%D0%91%D1%80%D0%B5%D1%81%D1%82');
    expect(wikivoyageArticleUrl('frwikivoyage', 'Île-de-France')).toBe('https://fr.wikivoyage.org/wiki/%C3%8Ele-de-France');
    expect(wikivoyageArticleUrl('zhwikivoyage', '北京')).toBe('https://zh.wikivoyage.org/wiki/%E5%8C%97%E4%BA%AC');
  });

  it('keeps a subpage slash and a colon readable', () => {
    expect(wikivoyageArticleUrl('enwikivoyage', 'London/Westminster')).toBe('https://en.wikivoyage.org/wiki/London/Westminster');
    expect(wikivoyageArticleUrl('enwikivoyage', 'Rome: Vatican, Borgo')).toBe('https://en.wikivoyage.org/wiki/Rome:_Vatican,_Borgo');
  });

  it('encodes what would end the path early or read as an escape', () => {
    expect(wikivoyageArticleUrl('enwikivoyage', 'Why? & How')).toBe('https://en.wikivoyage.org/wiki/Why%3F_%26_How');
    expect(wikivoyageArticleUrl('enwikivoyage', '100% Pure #1')).toBe('https://en.wikivoyage.org/wiki/100%25_Pure_%231');
  });
});

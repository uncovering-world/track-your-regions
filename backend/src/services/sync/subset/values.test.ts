import { describe, expect, it } from 'vitest';
import { articleUrl, bestStatements, pictureUrl, standingStatements, wktOf, yearOf } from './values.js';

/** The values the syncs compare, spelled as WDQS spells them (#1459); the expected spellings are WDQS's own, from the run cache. */

describe('values spelled as the live service spells them (#1459)', () => {
  it('escapes a picture file as WDQS does', () => {
    expect(pictureUrl('"Havis Amanda", la statue de la fontaine de Vallgren (Helsinki) (2744386193).jpg')).toBe(
      'http://commons.wikimedia.org/wiki/Special:FilePath/%22Havis%20Amanda%22%2C%20la%20statue%20de%20la%20fontaine%20de%20Vallgren%20%28Helsinki%29%20%282744386193%29.jpg',
    );
    expect(pictureUrl('Budapest Gellért socha svobody 1.jpg')).toBe(
      'http://commons.wikimedia.org/wiki/Special:FilePath/Budapest%20Gell%C3%A9rt%20socha%20svobody%201.jpg',
    );
  });

  it('escapes an English article as WDQS does', () => {
    expect(articleUrl('Pietà (Michelangelo)')).toBe('https://en.wikipedia.org/wiki/Piet%C3%A0_(Michelangelo)');
    expect(articleUrl('Colonne Vendôme')).toBe('https://en.wikipedia.org/wiki/Colonne_Vend%C3%B4me');
    expect(articleUrl("St. Peter's Basilica")).toBe('https://en.wikipedia.org/wiki/St._Peter%27s_Basilica');
  });

  it('writes a coordinate on Earth bare and one elsewhere with its globe', () => {
    expect(wktOf({ latitude: 48.861, longitude: 2.3358, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2' }))
      .toBe('Point(2.3358 48.861)');
    expect(wktOf({ latitude: 3.66, longitude: 0.67, globe: 'http://www.wikidata.org/entity/Q405' }))
      .toBe('<http://www.wikidata.org/entity/Q405> Point(0.67 3.66)');
  });

  it('reads a year, before the common era negative', () => {
    expect(yearOf({ time: '+1890-00-00T00:00:00Z' })).toBe(1890);
    // Yazılıkaya (Q529923) is dated -1300 in the dump, and WDQS's YEAR() answered -1300 for it: no shift.
    expect(yearOf({ time: '-1300-00-00T00:00:00Z' })).toBe(-1300);
  });

  it('reads the best statements and the ones that still stand', () => {
    const louvre = { id: 'a', value: 'Q19675' };
    const ended = { id: 'b', value: 'Q1075988', qualifiers: { P582: [{ time: '+2009-00-00T00:00:00Z' }] } };
    const deprecated = { id: 'c', value: 'Q90', rank: 'deprecated' as const };
    expect(bestStatements([louvre, ended, deprecated])).toEqual([louvre, ended]);
    expect(standingStatements([louvre, ended, deprecated])).toEqual([louvre]);
    const preferred = { id: 'd', value: 'Q1', rank: 'preferred' as const };
    expect(bestStatements([louvre, preferred])).toEqual([preferred]);
  });
});

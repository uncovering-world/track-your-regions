import { describe, expect, it } from 'vitest';
import { addDaily, decodeTitle, parsePageviewLine, siteOf } from './pageviewLine.js';

describe('a pageview line (ADR-0055)', () => {
  it('reads an edition, title, access method, total and daily counts from the end of the line', () => {
    expect(parsePageviewLine('en.wikipedia Cologne_Cathedral 6127 mobile-web 41267 A1328B1290')).toEqual({
      wiki: 'en.wikipedia', rawTitle: 'Cologne_Cathedral', access: 'mobile-web', views: 41267, daily: 'A1328B1290',
    });
    // A row with no page id has five columns (Wikimedia's readme).
    expect(parsePageviewLine('de.wikipedia Kölner_Dom desktop 9 C9')).toMatchObject({ rawTitle: 'Kölner_Dom', views: 9, access: 'desktop' });
  });

  it('reads no other project and no malformed line', () => {
    expect(parsePageviewLine('aa.wikibooks Administrator null desktop 1 Y1')).toBeNull();
    expect(parsePageviewLine('en.wikipedia Paris null tablet 3 A3')).toBeNull();
    expect(parsePageviewLine('en.wikipedia Paris null desktop many A3')).toBeNull();
    expect(parsePageviewLine('en.wikipedia')).toBeNull();
  });

  it('reads the three spellings of one title as one title, with spaces for underscores', () => {
    expect(decodeTitle('Иван_Грозный')).toBe('Иван Грозный');
    expect(decodeTitle('%D0%98%D0%B2%D0%B0%D0%BD_%D0%93%D1%80%D0%BE%D0%B7%D0%BD%D1%8B%D0%B9')).toBe('Иван Грозный');
    expect(decodeTitle('%u0418%u0432%u0430%u043D_%u0413%u0440%u043E%u0437%u043D%u044B%u0439')).toBe('Иван Грозный');
    expect(decodeTitle('Caf%C3%A9_de_Flore')).toBe('Café de Flore');
  });

  it('joins a UTF-16 surrogate pair into one character and reads a lone surrogate as unreadable', () => {
    expect(decodeTitle('%uD83D%uDE00_face')).toBe('😀 face');
    expect(decodeTitle('%uD800x')).toBe('�x');
    // A byte sequence that is not UTF-8 is unreadable too, never a failure.
    expect(decodeTitle('%FFabc')).toBe('�abc');
  });

  it('names an edition by the site code Wikidata gives its sitelinks', () => {
    expect(siteOf('en.wikipedia')).toBe('enwiki');
    expect(siteOf('zh-min-nan.wikipedia')).toBe('zh_min_nanwiki');
    expect(siteOf('simple.wikipedia')).toBe('simplewiki');
  });

  it('adds the encoded daily counts by day, the 31st written as an underscore', () => {
    const days = new Array(31).fill(0);
    addDaily(days, 'A19B20_7');
    addDaily(days, 'A1');
    expect(days[0]).toBe(20);
    expect(days[1]).toBe(20);
    expect(days[30]).toBe(7);
    const september = new Array(30).fill(0);
    addDaily(september, '_5');
    expect(september.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

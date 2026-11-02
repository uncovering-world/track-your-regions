import { describe, expect, it } from 'vitest';
import { browserReadingLanguages, languageName, readingOrder } from './readingLanguages';

describe('the languages a visitor reads Wikipedia in (#2209)', () => {
  it('reads a browser\'s languages by their first part, each once, in the browser\'s order', () => {
    expect(browserReadingLanguages(['ru-RU', 'ru', 'de-AT', 'en-GB', 'fr'])).toEqual(['ru', 'de']);
    // A bilingual reader whose browser puts English first reads English: Russian is never reached.
    expect(browserReadingLanguages(['en-US', 'ru'])).toEqual([]);
    expect(browserReadingLanguages(Array.from({ length: 12 }, (_, i) => `l${String.fromCharCode(97 + i)}`))).toHaveLength(10);
    expect(browserReadingLanguages(['zh-CN', 'x-pig-latin', '*'])).toEqual(['zh']);
    expect(browserReadingLanguages(undefined)).toEqual([]);
  });

  it('reads the visitor\'s own list where there is one, and always ends in English', () => {
    expect(readingOrder(['de', 'ru'], ['fr'])).toEqual(['de', 'ru', 'en']);
    expect(readingOrder(null, ['fr'])).toEqual(['fr', 'en']);
    expect(readingOrder([], ['ru'])).toEqual(['en']);
  });

  it('names a language as a reader does', () => {
    expect(languageName('ru')).toBe('Russian');
    expect(languageName('de')).toBe('German');
  });
});

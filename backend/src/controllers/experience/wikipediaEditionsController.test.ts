/**
 * Which edition each English article opens in for a reader's languages
 * (#2209), worded from the Altes Museum's item as Wikidata links it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { editionUrl, getWikipediaEditions, wikiOfLanguage } from './wikipediaEditionsController.js';
import { wikipediaEditionsQuerySchema } from '../../types/index.js';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const ALTES = 'https://en.wikipedia.org/wiki/Altes_Museum';
const ALTAR = 'https://en.wikipedia.org/wiki/Pergamon_Altar';

beforeEach(() => {
  query.mockReset();
});

describe('getWikipediaEditions', () => {
  it('answers each article with the first of the reader\'s languages its item has, and leaves out one with none', async () => {
    query.mockResolvedValue({ rows: [
      { english: 'Altes Museum', wiki: 'dewiki', title: 'Altes Museum' },
      { english: 'Altes Museum', wiki: 'ruwiki', title: 'Старый музей' },
    ] });
    const answer = await getWikipediaEditions({ query: { articles: [ALTES, ALTAR], languages: ['ru', 'de'] } });

    expect(answer.editions).toEqual([{
      article: ALTES,
      url: 'https://ru.wikipedia.org/wiki/%D0%A1%D1%82%D0%B0%D1%80%D1%8B%D0%B9_%D0%BC%D1%83%D0%B7%D0%B5%D0%B9',
      language: 'ru',
    }]);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['Altes Museum', 'Pergamon Altar'], ['ruwiki', 'dewiki']]);
  });

  it('asks only the languages ahead of English, and nothing for a reader who reads English first', async () => {
    query.mockResolvedValue({ rows: [] });
    await getWikipediaEditions({ query: { articles: [ALTES], languages: ['de', 'en', 'ru'] } });
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([['Altes Museum'], ['dewiki']]);

    query.mockReset();
    expect(await getWikipediaEditions({ query: { articles: [ALTES], languages: ['en', 'ru'] } })).toEqual({ editions: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('reads only English Wikipedia articles, never another address', async () => {
    expect(await getWikipediaEditions({
      query: { articles: ['https://de.wikipedia.org/wiki/Altes_Museum', 'https://example.com/wiki/Altes_Museum'], languages: ['ru'] },
    })).toEqual({ editions: [] });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('two spellings of one article', () => {
  it('answers each spelling the reader\'s links carry', async () => {
    query.mockResolvedValue({ rows: [{ english: 'Altes Museum', wiki: 'ruwiki', title: 'Старый музей' }] });
    const spaced = 'https://en.wikipedia.org/wiki/Altes%20Museum';
    const answer = await getWikipediaEditions({ query: { articles: [ALTES, spaced], languages: ['ru'] } });
    expect(answer.editions.map(edition => edition.article)).toEqual([ALTES, spaced]);
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([['Altes Museum'], ['ruwiki']]);
  });
});

describe('the edition a language names', () => {
  it('follows Wikidata\'s sitelinks, the two languages written otherwise included', () => {
    expect(wikiOfLanguage('ru')).toBe('ruwiki');
    expect(wikiOfLanguage('zh-classical')).toBe('zh_classicalwiki');
    expect(wikiOfLanguage('nb')).toBe('nowiki');
    expect(wikiOfLanguage('be-tarask')).toBe('be_x_oldwiki');
    expect(editionUrl('zh_classicalwiki', '長城')).toBe('https://zh-classical.wikipedia.org/wiki/%E9%95%B7%E5%9F%8E');
    expect(editionUrl('be_x_oldwiki', 'Мінск')).toBe('https://be-tarask.wikipedia.org/wiki/%D0%9C%D1%96%D0%BD%D1%81%D0%BA');
  });
});

describe('wikipediaEditionsQuerySchema', () => {
  it('takes one article or many, and languages as a comma list of codes', () => {
    expect(wikipediaEditionsQuerySchema.parse({ articles: ALTES, languages: 'ru,de' }))
      .toEqual({ articles: [ALTES], languages: ['ru', 'de'] });
    expect(wikipediaEditionsQuerySchema.safeParse({ articles: [ALTES], languages: 'ru,<script>' }).success).toBe(false);
    expect(wikipediaEditionsQuerySchema.safeParse({ articles: Array(101).fill(ALTES), languages: 'ru' }).success).toBe(false);
  });
});

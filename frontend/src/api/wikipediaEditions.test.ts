import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEditions } = vi.hoisted(() => ({ getEditions: vi.fn() }));
vi.mock('./client.generated', () => ({ getExperiencesWikipediaEditions: getEditions }));

import { fetchReaderEdition } from './wikipediaEditions';

const ALTES = 'https://en.wikipedia.org/wiki/Altes_Museum';
const ALTAR = 'https://en.wikipedia.org/wiki/Pergamon_Altar';

beforeEach(() => {
  getEditions.mockReset();
});

describe('fetchReaderEdition (#2209)', () => {
  it('asks once for the links of one render, and answers each with its own edition or none', async () => {
    getEditions.mockResolvedValue({ editions: [{ article: ALTES, url: 'https://ru.wikipedia.org/wiki/x', language: 'ru' }] });
    const [altes, altar] = await Promise.all([fetchReaderEdition(ALTES, ['ru', 'de']), fetchReaderEdition(ALTAR, ['ru', 'de'])]);

    expect(getEditions).toHaveBeenCalledTimes(1);
    expect(getEditions).toHaveBeenCalledWith({ articles: [ALTES, ALTAR], languages: 'ru,de' });
    expect(altes).toEqual({ url: 'https://ru.wikipedia.org/wiki/x', language: 'ru' });
    expect(altar).toBeNull();
  });

  it('sends a list of more than a hundred articles in batches', async () => {
    getEditions.mockResolvedValue({ editions: [] });
    // Short titles, so the count closes each batch before the length does.
    await Promise.all(Array.from({ length: 150 }, (_, i) => fetchReaderEdition(`https://en.wikipedia.org/wiki/A${i}`, ['ru'])));
    expect(getEditions).toHaveBeenCalledTimes(2);
    expect(getEditions.mock.calls[0][0].articles).toHaveLength(100);
  });

  it('closes a batch before its query passes what a server reads, however long the titles (#2526)', async () => {
    getEditions.mockResolvedValue({ editions: [] });
    // A Russian title percent-encodes to six characters a letter: a hundred of these would be some 33 kB.
    const longTitles = Array.from({ length: 100 }, (_, i) => `https://en.wikipedia.org/wiki/${'Пергамский_алтарь_'.repeat(3)}${i}`);
    const answers = await Promise.all(longTitles.map(article => fetchReaderEdition(article, ['ru'])));

    expect(answers.every(answer => answer === null)).toBe(true);
    expect(getEditions.mock.calls.length).toBeGreaterThan(1);
    const sent = getEditions.mock.calls.flatMap(([query]) => query.articles as string[]);
    expect(sent).toEqual(longTitles);
    for (const [query] of getEditions.mock.calls) {
      const length = new URLSearchParams((query.articles as string[]).map(article => ['articles', article])).toString().length;
      expect(length).toBeLessThanOrEqual(7000);
    }
  });

  it('asks for an article once however many links show it, and answers every one of them', async () => {
    getEditions.mockResolvedValue({ editions: [{ article: ALTES, url: 'https://ru.wikipedia.org/wiki/x', language: 'ru' }] });
    const answers = await Promise.all([fetchReaderEdition(ALTES, ['ru']), fetchReaderEdition(ALTES, ['ru'])]);
    expect(getEditions).toHaveBeenCalledWith({ articles: [ALTES], languages: 'ru' });
    expect(answers).toEqual([{ url: 'https://ru.wikipedia.org/wiki/x', language: 'ru' }, { url: 'https://ru.wikipedia.org/wiki/x', language: 'ru' }]);
  });

  it('lets a failure reach the link, which keeps its English article', async () => {
    getEditions.mockRejectedValue(new Error('429'));
    await expect(fetchReaderEdition(ALTES, ['ru'])).rejects.toThrow('429');
  });
});

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
    await Promise.all(Array.from({ length: 150 }, (_, i) => fetchReaderEdition(`${ALTES}_${i}`, ['ru'])));
    expect(getEditions).toHaveBeenCalledTimes(2);
    expect(getEditions.mock.calls[0][0].articles).toHaveLength(100);
  });

  it('lets a failure reach the link, which keeps its English article', async () => {
    getEditions.mockRejectedValue(new Error('429'));
    await expect(fetchReaderEdition(ALTES, ['ru'])).rejects.toThrow('429');
  });
});

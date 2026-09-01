/**
 * Tests for what a run offers back when Wikidata did not answer.
 *
 * The run keeps what the rows already hold rather than proposing to take a
 * thousand pictures and links away, and the shape it keeps them in is the
 * index Wikidata's answer takes, so `transformRecord` has one path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { factsForSite } from './unescoWikidata.js';
import { indexOfWhatIsStored } from './unescoSyncService.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/Sydney%20Opera%20House%20Sails.jpg';

describe('indexOfWhatIsStored', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('offers a site its own stored picture and article back', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [
      { external_id: '166', image_url: COMMONS, article: 'https://en.wikipedia.org/wiki/Sydney_Opera_House' },
    ] });

    const facts = factsForSite(await indexOfWhatIsStored(), '166');

    expect(facts.article).toBe('https://en.wikipedia.org/wiki/Sydney_Opera_House');
    expect(facts.picture?.url).toBe(COMMONS);
  });

  it('does not offer back a picture the writer would refuse', async () => {
    // A row still carrying the portal's photograph, on a database the repair
    // has not been run on: offered back, the run would propose it and the
    // writer would refuse it; left out, the run proposes nothing about it.
    mockedQuery.mockResolvedValueOnce({ rows: [
      { external_id: '1501', image_url: 'https://whc.unesco.org/document/141884', article: null },
    ] });

    expect(factsForSite(await indexOfWhatIsStored(), '1501')).toEqual({ article: null, picture: null });
  });
});

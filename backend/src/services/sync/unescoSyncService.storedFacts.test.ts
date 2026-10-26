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

    const facts = factsForSite((await indexOfWhatIsStored()).facts, '166');

    expect(facts.article).toBe('https://en.wikipedia.org/wiki/Sydney_Opera_House');
    expect(facts.picture?.url).toBe(COMMONS);
  });

  it("offers back the article UNESCO's view reported, never the place's (#1975)", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ external_id: '307', image_url: null, article: null }] });

    expect(factsForSite((await indexOfWhatIsStored()).facts, '307').article).toBeNull();
    expect(mockedQuery.mock.calls[0][0]).toContain('sm.reported_wikipedia_url AS article');
  });

  it("offers back the picture UNESCO's view reported, never the place's (#2049)", async () => {
    // Monte San Giorgio (WHC 1090): the place shows a Pachypleurosaurus fossil,
    // while UNESCO's view reports the lake. The row the query answers is the view's.
    const lake = 'http://commons.wikimedia.org/wiki/Special:FilePath/Lake%20Lugano.jpg';
    const fossil = 'http://commons.wikimedia.org/wiki/Special:FilePath/Pachypleurosaurus%20edwardsii.jpg';
    const lakeCredit = { author: 'A photographer', license: 'CC BY-SA 4.0' };
    mockedQuery.mockResolvedValueOnce({ rows: [
      { external_id: '1090', image_url: lake, image_credit: lakeCredit, place_image_url: fossil, article: null },
    ] });

    const { facts, credits } = await indexOfWhatIsStored();
    const picture = factsForSite(facts, '1090').picture;
    expect(picture?.url).toBe(lake);
    expect(mockedQuery.mock.calls[0][0]).toContain('sm.reported_image_url AS image_url');
    // The place's picture is another picture of the item, as an answered run
    // sends it, so the run keeps the fossil on the card rather than swapping in
    // the lake (`keepsItsPicture`).
    expect(picture?.itemPictures).toEqual([fossil, lake].sort());
    // And the lake keeps the credit the view recorded for it.
    expect(credits.get(lake)).toEqual(lakeCredit);
    expect(credits.has(fossil)).toBe(false);
  });

  it('does not offer back a picture the writer would refuse', async () => {
    // A row still carrying the portal's photograph, on a database the repair
    // has not been run on: offered back, the run would propose it and the
    // writer would refuse it; left out, the run proposes nothing about it.
    mockedQuery.mockResolvedValueOnce({ rows: [
      { external_id: '1501', image_url: 'https://whc.unesco.org/document/141884', article: null },
    ] });

    expect(factsForSite((await indexOfWhatIsStored()).facts, '1501')).toEqual({ article: null, picture: null });
  });
});

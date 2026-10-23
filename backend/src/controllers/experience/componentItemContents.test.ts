import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/sync/componentItemQueries.js', () => ({ contentsOf: vi.fn() }));
vi.mock('../../services/sync/imageCredit.js', () => ({ fetchCommonsCredits: vi.fn() }));

import { contentsOf } from '../../services/sync/componentItemQueries.js';
import { fetchCommonsCredits } from '../../services/sync/imageCredit.js';
import { readItemContents } from './componentItemController.js';

/**
 * The content an accepted candidate gives its point (#1272), read strictly for
 * the catalogue's own pass (#1839, ADR-0141): a picture whose credit Commons
 * did not give is a failed read there, and only there.
 */

const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Nagatsuka%20Kofun.jpg';
const mockedContents = contentsOf as unknown as ReturnType<typeof vi.fn>;
const mockedCredits = fetchCommonsCredits as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedContents.mockReset();
  mockedCredits.mockReset();
  mockedContents.mockResolvedValue(new Map([['Q98391', { image: PICTURE, description: 'Kofun in Sakai, Japan' }]]));
});

describe("an accepted candidate's content", () => {
  it('gives the picture with its credit', async () => {
    const credit = { author: 'A photographer', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };
    mockedCredits.mockResolvedValue(new Map([[PICTURE, credit]]));
    expect(await readItemContents(['Q98391'], { strict: true }))
      .toEqual(new Map([['Q98391', { imageUrl: PICTURE, credit, description: 'Kofun in Sakai, Japan' }]]));
  });

  it("leaves out of a strict read an item whose picture Commons gave no credit for, and gives a save what it has", async () => {
    // Commons' failures are swallowed upstream: a credit missing is all that shows.
    mockedCredits.mockResolvedValue(new Map());
    expect(await readItemContents(['Q98391'], { strict: true })).toEqual(new Map());
    expect((await readItemContents(['Q98391'])).get('Q98391')).toMatchObject({ imageUrl: PICTURE, credit: null });
  });

  it('fails a strict read Wikidata did not answer, and gives the save nothing', async () => {
    mockedContents.mockRejectedValue(new Error('Wikidata answered 429'));
    await expect(readItemContents(['Q98391'], { strict: true })).rejects.toThrow(/429/);
    expect(await readItemContents(['Q98391'])).toEqual(new Map());
  });
});

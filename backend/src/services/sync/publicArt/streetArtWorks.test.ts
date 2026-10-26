/**
 * What an admitted street-art place holds (#2055), on the East Side Gallery:
 * Vrubel's kiss and *Es geschah im November* are murals with a picture; a
 * mural with no picture, one that is gone (`P576`) and a street the wall names
 * as a part are not shown; and the kiss, which the run also admits as a place
 * of its own, is still on the wall's card.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolWork } from '../museum/queries.js';
import type { WorkDetails } from '../museum/venueSideQueries.js';
import type { ProcessedContent, SyncProgress, WikidataLandmark } from '../types.js';
import type { SyncRunContext } from '../syncContract.js';
import type { SparqlFn } from '../wikidataQueries.js';

const mocks = vi.hoisted(() => ({
  readPreviousPlacements: vi.fn(),
  upsertVenueTreasures: vi.fn(),
  fetchWorksByIds: vi.fn(),
  withEnglishArticles: vi.fn(),
  readershipDoorFor: vi.fn(),
  readStoredTreasureCredits: vi.fn(),
  fetchStreetArtHoldings: vi.fn(),
  fetchRootsOfClasses: vi.fn(),
  fetchStreetArtMarks: vi.fn(),
}));
vi.mock('../museumSyncService.js', () => ({ readPreviousPlacements: mocks.readPreviousPlacements }));
vi.mock('../museum/treasureWriter.js', () => ({ upsertVenueTreasures: mocks.upsertVenueTreasures }));
vi.mock('../museum/venueSideQueries.js', () => ({ fetchWorksByIds: mocks.fetchWorksByIds }));
vi.mock('../museum/worksCollector.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../museum/worksCollector.js')>(),
  withEnglishArticles: mocks.withEnglishArticles,
}));
vi.mock('../readershipDoor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../readershipDoor.js')>(),
  readershipDoorFor: mocks.readershipDoorFor,
}));
vi.mock('../imageCredit.js', () => ({ readStoredTreasureCredits: mocks.readStoredTreasureCredits }));
vi.mock('./streetArtQueries.js', () => ({
  fetchStreetArtHoldings: mocks.fetchStreetArtHoldings,
  fetchRootsOfClasses: mocks.fetchRootsOfClasses,
  fetchStreetArtMarks: mocks.fetchStreetArtMarks,
}));

import { isShownWork, streetArtContents, worksByPlace } from './streetArtWorks.js';
import { ICONIC_SITELINKS } from '../museum/tier1.js';

const ESG = 'Q313746';
const KISS = 'Q2410932';
const NOVEMBER = 'Q3057616';
const NO_PICTURE = 'Q141302881';
const GONE = 'Q205503';
const STREET = 'Q205507';
const STATUE = 'Q205508';
const MURAL = 'Q219423';
const ROAD = 'Q34442';

const work = (qid: string, label: string, sitelinks: number, imageUrl: string | null = `https://commons.wikimedia.org/wiki/Special:FilePath/${qid}.jpg`): PoolWork => ({
  qid, label, sitelinks, imageUrl, creators: [], year: 1990, type: 'mural', typeQid: MURAL,
});
const details = (w: PoolWork, classes: string[] = [MURAL]): WorkDetails => ({ work: w, classes: new Map(classes.map((c) => [c, c])) });
const content = (qid: string, name: string, sitelinksCount: number): ProcessedContent => ({
  externalId: qid, name, treasureType: 'mural', artists: [], year: null, imageUrl: null, sitelinksCount,
});
const landmark = (qid: string, label: string, type: string): WikidataLandmark =>
  ({ qid, label, type, lat: 52.5, lon: 13.44 }) as unknown as WikidataLandmark;

const sparql = vi.fn<SparqlFn>(async () => []);
const progress = { cancel: false, statusMessage: '' } as unknown as SyncProgress;
const context: SyncRunContext = { dryRun: false, syncLogId: 412, onLocationsChanged: () => {}, withdrawalSkippedReason: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.readPreviousPlacements.mockResolvedValue({});
  mocks.readStoredTreasureCredits.mockResolvedValue(new Map());
  mocks.readershipDoorFor.mockResolvedValue(undefined);
  mocks.fetchStreetArtHoldings.mockResolvedValue([
    { place: ESG, work: NOVEMBER }, { place: ESG, work: KISS }, { place: ESG, work: NO_PICTURE },
    { place: ESG, work: GONE }, { place: ESG, work: STREET }, { place: ESG, work: STATUE },
  ]);
  mocks.fetchWorksByIds.mockImplementation(async (_door: unknown, qids: string[]) => new Map([
    details(work(KISS, 'My God, Help Me to Survive This Deadly Love', 29)),
    details(work(NOVEMBER, 'Es geschah im November', 2)),
    details(work(NO_PICTURE, 'Worlds People', 1, null)),
    details(work(GONE, 'A painted-over mural', 3)),
    details(work(STREET, 'Mühlenstraße', 12), [ROAD]),
  ].filter((d) => qids.includes(d.work.qid)).map((d) => [d.work.qid, d])));
  mocks.fetchRootsOfClasses.mockResolvedValue(new Map([[MURAL, ['Q838948']]]));
  mocks.fetchStreetArtMarks.mockResolvedValue(new Map([[GONE, { atlasObscura: false, ended: true }]]));
  mocks.upsertVenueTreasures.mockResolvedValue({ added: [], withdrawn: [], returned: [], changed: [] });
});

describe('which works a street-art place shows (#2055)', () => {
  it('puts each place\'s works most famous first, by name among equals, once each', () => {
    const kiss = content(KISS, 'My God, Help Me to Survive This Deadly Love', 29);
    const november = content(NOVEMBER, 'Es geschah im November', 2);
    const vaterland = content('Q124036766', 'Vaterland', 2);
    const byPlace = worksByPlace(
      [{ place: ESG, work: vaterland.externalId }, { place: ESG, work: NOVEMBER }, { place: ESG, work: KISS },
        { place: ESG, work: KISS }, { place: ESG, work: STREET }],
      new Map([[KISS, kiss], [NOVEMBER, november], [vaterland.externalId, vaterland]]),
    );
    expect(byPlace.get(ESG)?.map((c) => c.name)).toEqual(['My God, Help Me to Survive This Deadly Love', 'Es geschah im November', 'Vaterland']);
  });

  it('shows a work of art with a picture that is still there, and nothing else', () => {
    const art = new Set([MURAL]);
    expect(isShownWork(details(work(KISS, 'kiss', 29)), art, false)).toBe(true);
    expect(isShownWork(details(work(KISS, 'kiss', 29, null)), art, false)).toBe(false);
    expect(isShownWork(details(work(KISS, 'kiss', 29)), art, true)).toBe(false);
    expect(isShownWork(details(work(STREET, 'street', 12), [ROAD]), art, false)).toBe(false);
  });
});

describe('the works a run of Public art reads and writes (#2055)', () => {
  const items = [
    landmark(ESG, 'East Side Gallery', 'street-art'),
    // A mural the run admits on its own, typed street art as the wall is.
    landmark(KISS, 'My God, Help Me to Survive This Deadly Love', 'street-art'),
    landmark(STATUE, 'A statue', 'statue'),
    landmark('Q205509', 'A sculpture', 'sculpture'),
  ];

  it('reads the street-art places alone, keeps what a card shows and names their pictures', async () => {
    const contents = streetArtContents(3, '[Landmark Sync]');
    const read = await contents.read(items, sparql, progress);
    expect(mocks.fetchStreetArtHoldings).toHaveBeenCalledWith(sparql, [ESG, KISS]);
    // The kiss is a place of this run too, and still asked about as the wall's work.
    expect(mocks.fetchWorksByIds.mock.calls[0][1]).toEqual([NOVEMBER, KISS, NO_PICTURE, GONE, STREET, STATUE]);
    expect(mocks.fetchRootsOfClasses).toHaveBeenCalledWith(sparql, [MURAL, ROAD], ['Q838948']);
    expect(mocks.readershipDoorFor).toHaveBeenCalledWith(3, ICONIC_SITELINKS, '[Landmark Sync]');
    expect(read).toEqual({
      withdrawalSkippedReason: null,
      imageUrls: [KISS, NOVEMBER].map((qid) => `https://commons.wikimedia.org/wiki/Special:FilePath/${qid}.jpg`),
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('East Side Gallery 2 (My God'));
  });

  it('marks a work the readership door opened for as Iconic below the line', async () => {
    mocks.readershipDoorFor.mockResolvedValue(async () => ({
      opened: new Map([[NOVEMBER, { views: 300_000, burst: false }]]), bar: 250_000, exit: 200_000,
    }));
    const contents = streetArtContents(3, '[Landmark Sync]');
    await contents.read(items, sparql, progress);
    await contents.write(6285, ESG, context, new Map());
    const written: ProcessedContent[] = mocks.upsertVenueTreasures.mock.calls[0][1];
    expect(written.map((c) => [c.externalId, c.readIconic ?? false])).toEqual([[KISS, false], [NOVEMBER, true]]);
  });

  it('writes a place\'s works through the treasure writer, placed by the source, at the art museums\' line', async () => {
    const contents = streetArtContents(3, '[Landmark Sync]');
    await contents.read(items, sparql, progress);
    const fetched = new Map();
    await contents.write(6285, ESG, { ...context, withdrawalSkippedReason: 'below the floor' }, fetched);
    const [experienceId, written, credits, run, elsewhere] = mocks.upsertVenueTreasures.mock.calls[0];
    expect(experienceId).toBe(6285);
    expect(written.map((c: ProcessedContent) => c.externalId)).toEqual([KISS, NOVEMBER]);
    expect(credits.fetched).toBe(fetched);
    // No line of its own: the writer's default is the art museums' (ICONIC_SITELINKS).
    expect(run).toEqual({ syncLogId: 412, withdrawalSkippedReason: 'below the floor', sourceId: 3 });
    expect(elsewhere).toEqual([]);
  });

  it('writes nothing for a place that holds nothing and held nothing, and reconciles one that held works', async () => {
    mocks.readPreviousPlacements.mockResolvedValue({ Q205510: ['Q205509'] });
    const contents = streetArtContents(3, '[Landmark Sync]');
    await contents.read(items, sparql, progress);
    expect(await contents.write(9001, STATUE, context, new Map())).toBeUndefined();
    await contents.write(9002, 'Q205509', context, new Map());
    expect(mocks.upsertVenueTreasures).toHaveBeenCalledTimes(1);
    expect(mocks.upsertVenueTreasures.mock.calls[0].slice(0, 2)).toEqual([9002, []]);
    expect(mocks.upsertVenueTreasures.mock.calls[0][4]).toEqual([KISS, NOVEMBER]);
  });

  it('skips withdrawals when the run placed again too few of the works the catalogue offers', async () => {
    mocks.readPreviousPlacements.mockResolvedValue({ Q205511: [ESG], Q205512: [ESG], Q205513: [ESG] });
    const read = await streetArtContents(3, '[Landmark Sync]').read(items, sparql, progress);
    expect(read.withdrawalSkippedReason).toContain('placed 0 of the 3 works');
  });
});

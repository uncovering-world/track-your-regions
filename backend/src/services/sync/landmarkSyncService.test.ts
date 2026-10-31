/**
 * How the landmark run wires the public-art collection to the orchestrator,
 * as a member of the place pass (`places/placePass.ts`).
 *
 * The collection is a pure pipeline with its own test and the orchestrator's
 * handling of refusals and the sweep has one too. What neither can see is the
 * join: that the run reads what the source already admits before asking,
 * hands the collection's refusals back as the run's `filtered`, declares that
 * it recomputes its membership and that belonging is the badge, keeps its
 * answers unless told to refresh, and writes what the rule read onto the row.
 *
 * Everything around the join is mocked: the pipeline, Wikidata, Commons, the
 * upserts, the admission read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('./syncOrchestrator.js', () => ({
  orchestrateSync: vi.fn().mockResolvedValue(undefined),
  getSyncStatus: vi.fn(),
  cancelSync: vi.fn(),
}));
vi.mock('./locationWriter.js', () => ({ writeExperienceLocations: vi.fn() }));
vi.mock('./syncUtils.js', () => ({
  upsertExperienceRecord: vi.fn(),
  upsertSingleLocation: vi.fn(),
}));
vi.mock('./wikidataCache.js', () => ({
  pruneExpired: vi.fn().mockResolvedValue(0),
  withCache: vi.fn((door: unknown) => door),
}));
vi.mock('./publicArt/pipeline.js', () => ({
  classifyPublicArt: vi.fn(),
  PUBLIC_ART_KIND: { name: 'public art' },
  ENTER_SITELINKS: 22,
  STAY_SITELINKS: 18,
  openArtworkDoor: vi.fn(),
  streetArtCandidates: vi.fn(),
  guideDoorCandidates: vi.fn(() => []),
}));
// The guide door reads the gate and the Wikivoyage usage build (ADR-0167); its own spec is places/guideDoor.test.ts.
vi.mock('./places/guideDoor.js', () => ({ readGuideDoor: vi.fn(async () => new Set<string>()) }));
// The regional tier is its own module's (`regionalTier.test.ts`); here it brings nothing.
vi.mock('./places/regionalTier.js', async (importOriginal) => ({
  mergeRegional: (await importOriginal<typeof import('./places/regionalTier.js')>()).mergeRegional,
  regionalReader: vi.fn(() => ({ arrivals: vi.fn(async () => ({ items: [], filtered: [] })) })),
}));
vi.mock('./places/regionalPool.js', () => ({ readRegionalPool: vi.fn(async () => ({ rows: new Map(), around: new Map(), seconds: 0 })) }));
// The museum tree joins the pool's classes (ADR-0171); the spec asks Wikidata nothing.
vi.mock('./wikidataQueries.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./wikidataQueries.js')>()), fetchClassTree: vi.fn(async () => new Set<string>()) }));
// The marks door reads the gate, the year, the marks and the works under the floor (ADR-0169); its own spec is publicArt/marksDoor.test.ts.
vi.mock('./publicArt/marksDoor.js', () => ({
  shareWithMarksDoor: vi.fn(async (_source: number, share: unknown) => ({ share, marks: null })),
}));
// What the street-art rule reads (#2035); its own spec is streetArtPlaces.test.ts.
vi.mock('./publicArt/streetArtPlaces.js', () => ({ readStreetArt: vi.fn() }));
/** What a street-art place holds (#2055): one reader and writer per run of Public art. */
const placeContents = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('./publicArt/streetArtWorks.js', () => ({ streetArtContents: vi.fn(() => placeContents) }));
// The readership door reads the year and the source's gate (#2033); its own spec is readershipDoor.test.ts.
vi.mock('./readershipDoor.js', () => ({ artworkReadershipDoorFor: vi.fn() }));
vi.mock('./worship/places.js', () => ({ WORSHIP_KIND: { name: 'places of worship' } }));
vi.mock('./places/gather.js', () => ({
  gatherPlaces: vi.fn(),
  shareOf: (gathered: { shares: Map<unknown, unknown> }, kind: unknown) => gathered.shares.get(kind),
}));
// The pass's third and fourth members, whose own specs are
// worshipSyncService.test.ts and archaeologySyncService.test.ts.
vi.mock('./worshipSyncService.js', () => ({
  WORSHIP_SOURCE_ID: 4,
  worshipSource: vi.fn(() => ({ sourceId: 4 })),
}));
vi.mock('./archaeologySyncService.js', () => ({ archaeologySource: vi.fn(() => ({ sourceId: 5 })) }));
vi.mock('./archaeology/sites.js', () => ({ ARCHAEOLOGY_SITE_KIND: { name: 'archaeological sites' } }));
vi.mock('./archaeology/runDoors.js', () => ({ ARCHAEOLOGY_SOURCE_ID: 5 }));
// The pass's fifth to seventh members, whose rules and lines are
// towers/*.test.ts', bridges/*.test.ts' and squares/*.test.ts'.
vi.mock('./towers/kind.js', () => ({
  TOWERS_SOURCE_ID: 7,
  TOWERS_KIND: { name: 'towers' },
  TOWERS_CLASSIFIER: { classify: vi.fn(), types: ['bell-tower', 'tower'], tag: 'tower' },
}));
vi.mock('./bridges/kind.js', () => ({
  BRIDGES_SOURCE_ID: 8,
  BRIDGES_KIND: { name: 'bridges and engineering works' },
  BRIDGES_CLASSIFIER: { classify: vi.fn(), types: ['bridge', 'dam'], tag: 'engineering' },
}));
vi.mock('./squares/kind.js', () => ({
  SQUARES_SOURCE_ID: 9,
  SQUARES_KIND: { name: 'squares and streets' },
  SQUARES_CLASSIFIER: { classify: vi.fn(), types: ['square', 'street'], tag: 'square' },
}));
vi.mock('./pinQuestion.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pinQuestion.js')>()),
  // The run's questions about a curator's pin read and write the database (#1367).
  pinnedRows: vi.fn().mockResolvedValue([]),
  writePinQuestions: vi.fn().mockResolvedValue(undefined),
}));

// What other kinds handed over (ADR-0102): none here, and nothing recorded.
vi.mock('./handOvers.js', () => ({
  recordHandOvers: vi.fn().mockResolvedValue(0),
  readHandOvers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('./admission.js', () => ({ admittedExternalIds: vi.fn() }));
vi.mock('./shownElsewhere.js', () => ({ placesOtherSourcesOffer: vi.fn().mockResolvedValue(new Set(['Q19675'])) }));
vi.mock('./subset/reader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./subset/reader.js')>()),
  wikidataReaderOf: vi.fn().mockResolvedValue('live'),
}));
vi.mock('../dumps/wikidata/subsetTables.js', () => ({
  latestSubset: vi.fn().mockResolvedValue(null),
  entitiesAreHeld: vi.fn().mockResolvedValue(true),
}));
vi.mock('./wikidataUtils.js', () => ({
  delay: vi.fn(),
  WaitBudget: class WaitBudget {},
  SPARQL_DELAY_MS: 0,
  SPARQL_WAIT_BUDGET_MS: 0,
  waitMessage: vi.fn(),
  WIKIDATA_USER_AGENT: 'test',
  wikidataDoor: vi.fn(() => vi.fn()),
}));
vi.mock('./imageCredit.js', () => ({
  fetchCommonsCredits: vi.fn().mockResolvedValue(new Map()),
  readStoredCredits: vi.fn().mockResolvedValue(new Map()),
  creditToWrite: vi.fn().mockReturnValue({}),
}));

import { pool } from '../../db/index.js';
import { orchestrateSync } from './syncOrchestrator.js';
import type { SyncServiceConfig, SyncRunContext } from './syncContract.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { writeExperienceLocations } from './locationWriter.js';
import { withCache } from './wikidataCache.js';
import { classifyPublicArt, openArtworkDoor, PUBLIC_ART_KIND, streetArtCandidates } from './publicArt/pipeline.js';
import { readStreetArt } from './publicArt/streetArtPlaces.js';
import { artworkReadershipDoorFor } from './readershipDoor.js';
import { WORSHIP_KIND } from './worship/places.js';
import { ARCHAEOLOGY_SITE_KIND } from './archaeology/sites.js';
import { gatherPlaces } from './places/gather.js';
import { admittedExternalIds } from './admission.js';
import { placesOtherSourcesOffer } from './shownElsewhere.js';
import { syncPlacePass } from './places/placePass.js';
import { TOWERS_CLASSIFIER, TOWERS_KIND } from './towers/kind.js';
import { BRIDGES_KIND } from './bridges/kind.js';
import { SQUARES_KIND } from './squares/kind.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE } from './publicArt/kindRules.js';
import type { SyncProgress, WikidataLandmark } from './types.js';

const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedGather = gatherPlaces as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = classifyPublicArt as unknown as ReturnType<typeof vi.fn>;
/** Public art's share of the gather; the classification is what the tests say. */
const SHARE = { trees: {}, pool: new Map(), facts: new Map(), containers: new Map() };
const GATHERED = {
  shares: new Map<unknown, unknown>([
    [PUBLIC_ART_KIND, SHARE], [WORSHIP_KIND, SHARE], [ARCHAEOLOGY_SITE_KIND, SHARE], [TOWERS_KIND, SHARE], [BRIDGES_KIND, SHARE], [SQUARES_KIND, SHARE],
  ]),
  pooled: 0, classes: new Set<string>() };
/** What the street-art rule read of its candidates: the Lennon Wall in Prague, with an Atlas Obscura entry. */
const STREET_ART_READ = {
  marks: new Map([['Q1630131', { atlasObscura: true, ended: false }]]), guided: new Set<string>(), readers: null, roots: new Map(),
};
const mockedAdmitted = admittedExternalIds as unknown as ReturnType<typeof vi.fn>;
const mockedWithCache = withCache as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>;

function landmark(over: Partial<WikidataLandmark> = {}): WikidataLandmark {
  return {
    qid: 'Q337179', label: 'Freedom Monument', description: 'monument in Riga', lat: 56.95, lon: 24.11,
    imageUrl: null, itemPictures: [], creators: ['Kārlis Zāle'], year: 1935, sitelinks: 41, countryLabel: 'Latvia',
    type: 'monument', classes: ['Q4989906'], artwork: false, articleUrl: null, website: null, ...over,
  };
}

const progress = () => ({ cancel: false, statusMessage: '' } as unknown as SyncProgress);

async function configOf(options: { dryRun?: boolean; refreshCache?: boolean } = {}, sourceId = 3) {
  await syncPlacePass(1, options);
  // The newest pass's run of this source: each pass makes its own gather, and
  // an earlier one's may have failed.
  return mockedOrchestrate.mock.calls.map((call) => call[0] as SyncServiceConfig<WikidataLandmark>)
    .filter((config) => config.sourceId === sourceId).at(-1)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmitted.mockResolvedValue(new Set(['Q337179']));
  mockedGather.mockResolvedValue(GATHERED);
  mockedCollect.mockReturnValue({ items: [landmark()], fetched: 1, filtered: [] });
  vi.mocked(artworkReadershipDoorFor).mockResolvedValue(undefined);
  vi.mocked(openArtworkDoor).mockResolvedValue(null);
  vi.mocked(streetArtCandidates).mockReturnValue(['Q1630131']);
  vi.mocked(readStreetArt).mockResolvedValue(STREET_ART_READ);
  placeContents.read.mockResolvedValue({ withdrawalSkippedReason: null, imageUrls: [] });
  placeContents.write.mockResolvedValue(undefined);
  mockedUpsert.mockResolvedValue({
    experienceId: 7, changeSet: { changeType: 'unchanged' }, nameSnapshot: 'Freedom Monument', returnedFromMissing: false,
  });
  (upsertSingleLocation as unknown as ReturnType<typeof vi.fn>)
    .mockResolvedValue({ needsAssignment: [], unoffered: 0, delta: {} });
});

describe('public art in the place pass', () => {
  it('recomputes its membership every run, and belonging is the badge', async () => {
    const config = await configOf();
    expect(config.sourceId).toBe(3);
    expect(config.sourceCompleteness).toBe('ranked');
    expect(config.recomputesMembership).toBe(true);
    // Belonging is the badge for the world tier alone: a row the regional tier admits carries none (ADR-0048).
    const badges = config.badgesAdmitted as (item: { tier?: 'regional' }) => boolean;
    expect(badges({})).toBe(true);
    expect(badges({ tier: 'regional' })).toBe(false);
  });

  it('hands the collection what the source already admits, and its refusals back', async () => {
    const refusal = { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' };
    mockedCollect.mockReturnValue({ items: [landmark()], fetched: 5, filtered: [refusal] });

    const config = await configOf();
    const fetched = await config.fetchItems(progress(), []);

    expect(mockedAdmitted).toHaveBeenCalledWith(3, undefined, 'world');
    // Every kind's admitted rows, the pass's other members' too, asked for by id.
    expect(mockedGather.mock.calls[0][1]).toEqual([
      { kind: PUBLIC_ART_KIND, admitted: new Set(['Q337179']) },
      { kind: WORSHIP_KIND, admitted: new Set(['Q337179']) },
      { kind: ARCHAEOLOGY_SITE_KIND, admitted: new Set(['Q337179']) },
      { kind: TOWERS_KIND, admitted: new Set(['Q337179']) },
      { kind: BRIDGES_KIND, admitted: new Set(['Q337179']) },
      { kind: SQUARES_KIND, admitted: new Set(['Q337179']) },
    ]);
    // Archaeology's sites, not its museums: its museum door asks after its own.
    expect(mockedAdmitted).toHaveBeenCalledWith(5, 'site');
    expect(mockedCollect.mock.calls[0][0]).toBe(SHARE);
    expect(mockedCollect.mock.calls[0][1]).toBe(PUBLIC_ART_RULE);
    expect(mockedCollect.mock.calls[0][2]).toEqual(new Set(['Q337179']));
    // And the places another kind offers, so a work outdoors on a venue no
    // kind offers stays public art (#1444).
    expect(mockedCollect.mock.calls[0][3]).toEqual(new Set(['Q19675']));
    // And the readership door over its share, at its own line (#2033).
    expect(vi.mocked(artworkReadershipDoorFor)).toHaveBeenCalledWith(3, 22, '[Landmark Sync]');
    expect(vi.mocked(openArtworkDoor)).toHaveBeenCalledWith(undefined, SHARE, new Set(['Q337179']), PUBLIC_ART_RULE, new Set(['Q19675']));
    expect(mockedCollect.mock.calls[0][4]).toBeNull();
    // And what the street-art rule reads of the candidates it decides (#2035),
    // asked through the gather's own door.
    expect(vi.mocked(streetArtCandidates)).toHaveBeenCalledWith(SHARE, PUBLIC_ART_RULE);
    expect(vi.mocked(readStreetArt)).toHaveBeenCalledWith(expect.any(Function), ['Q1630131'], SHARE.facts);
    expect(mockedCollect.mock.calls[0][5]).toBe(STREET_ART_READ);
    expect(fetched.fetchedCount).toBe(5);
    expect(fetched.filtered).toEqual([refusal]);
    expect(fetched.items.map((i) => i.qid)).toEqual(['Q337179']);
  });

  it('runs Monuments & memorials beside Public art, each by its kind\'s rule, from one gather (#1807)', async () => {
    const art = await configOf();
    const monuments = await configOf({}, 6);
    vi.clearAllMocks();
    mockedAdmitted.mockResolvedValue(new Set());
    mockedCollect.mockReturnValue({ items: [], fetched: 0, filtered: [] });
    await monuments.fetchItems(progress(), []);
    expect(mockedAdmitted).toHaveBeenCalledWith(6, undefined, 'world');
    expect(mockedCollect.mock.calls[0][1]).toBe(MONUMENTS_RULE);
    // Monuments & memorials opens no readership door (#2033), and holds no
    // street-art place (#2035).
    expect(vi.mocked(artworkReadershipDoorFor)).not.toHaveBeenCalled();
    expect(vi.mocked(readStreetArt)).not.toHaveBeenCalled();
    expect(mockedCollect.mock.calls[0][5]).toBeNull();
    expect(vi.mocked(openArtworkDoor)).toHaveBeenCalledWith(undefined, SHARE, new Set(), MONUMENTS_RULE, expect.any(Set));
    // A place its sibling offers is not another kind's (#1444).
    expect(vi.mocked(placesOtherSourcesOffer)).toHaveBeenCalledWith([3, 6]);
    expect(art.sourceId).toBe(3);
  });

  it('runs Places of worship, Archaeology, Towers, Bridges and Squares after the public-art kinds, from the one gather they read (#1820, #1854, #1860, #1867)', async () => {
    await syncPlacePass(1, {});
    expect(mockedOrchestrate.mock.calls.map((call) => (call[0] as { sourceId: number }).sourceId)).toEqual([3, 6, 4, 5, 7, 8, 9]);

    const { worshipSource } = await import('./worshipSyncService.js');
    const gather = vi.mocked(worshipSource).mock.calls[0][0];
    await (mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<WikidataLandmark>).fetchItems(progress(), []);
    await gather(progress());
    expect(mockedGather).toHaveBeenCalledTimes(1);
  });

  it('decides Towers by its own classifier, over what its source admits (#1854)', async () => {
    const towers = await configOf({}, 7);
    vi.clearAllMocks();
    mockedAdmitted.mockResolvedValue(new Set(['Q91274']));
    vi.mocked(TOWERS_CLASSIFIER.classify).mockResolvedValue({
      items: [landmark({ qid: 'Q91274', label: 'Galata Tower', type: 'tower', classes: ['Q12518'] })], fetched: 1, filtered: [],
    });
    const fetched = await towers.fetchItems(progress(), []);
    // The world tier's rows alone: a regional row is never held to the world line (#2178).
    expect(mockedAdmitted).toHaveBeenCalledWith(7, undefined, 'world');
    expect(vi.mocked(TOWERS_CLASSIFIER.classify).mock.calls[0][1]).toEqual(new Set(['Q91274']));
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(fetched.items.map((i) => i.qid)).toEqual(['Q91274']);
  });

  it('keeps its answers by default and asks the source afresh when told to', async () => {
    const config = await configOf({ refreshCache: true });
    await config.fetchItems(progress(), []);
    expect(mockedWithCache.mock.calls[0][1]).toMatchObject({ sourceId: 3, enabled: false });

    vi.clearAllMocks();
    mockedAdmitted.mockResolvedValue(new Set());
    mockedCollect.mockReturnValue({ items: [], fetched: 0, filtered: [] });
    const plain = await configOf();
    await plain.fetchItems(progress(), []);
    expect(mockedWithCache.mock.calls[0][1]).toMatchObject({ sourceId: 3, enabled: true });
  });

  it('reads the local subset when the source is switched to it, through a door that asks the live service nothing (#1459)', async () => {
    const { wikidataReaderOf, readsSubset } = await import('./subset/reader.js');
    const { latestSubset } = await import('../dumps/wikidata/subsetTables.js');
    vi.mocked(wikidataReaderOf).mockResolvedValue('subset');
    vi.mocked(latestSubset).mockResolvedValue(null);
    await expect((await configOf()).fetchItems(progress(), [])).rejects.toThrow(/not built/);

    vi.mocked(latestSubset).mockResolvedValue({ dumpDate: '2026-10-05', swappedAt: new Date(), needs: 'nothing' });
    mockedCollect.mockReturnValue({ items: [], fetched: 0, filtered: [] });
    // A row whose item the subset does not keep: left as it is, and named (#1462).
    const unread = [{ externalId: 'Q130000001', name: 'A statue newer than the dump' }];
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: unread } as never);
    const result = await (await configOf()).fetchItems(progress(), []);
    expect(result.unread).toEqual(unread);
    const door = mockedGather.mock.calls.at(-1)![0].sparql;
    expect(readsSubset(door)).toBe(true);
    await expect(door('SELECT ?x WHERE {}', { kind: 'pool', label: 'a pool' })).rejects.toThrow(/asked the live service: a pool/);
    expect(mockedWithCache).not.toHaveBeenCalled();
    vi.mocked(wikidataReaderOf).mockResolvedValue('live');
  });

  it('writes what the rule read onto the row', async () => {
    const config = await configOf();
    await config.fetchItems(progress(), []);
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 9, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    await config.processItem(landmark({ classes: ['Q4989906', 'Q893745'], type: 'monument', artwork: false }), progress(), context);

    const params = mockedUpsert.mock.calls[0][0];
    expect(params.type).toBe('monument');
    // A work standing in one place is no edition, and says so (ADR-0145 decision 5).
    expect(params.castPoints).toBe(false);
    // Once, in the column: the key that duplicated it in metadata is gone (#814).
    expect(params.metadata).not.toHaveProperty('type');
    expect(params.tags).toEqual(['outdoor', 'monument']);
    expect(params.metadata).toMatchObject({
      wikidataQid: 'Q337179',
      wikidataClasses: ['Q4989906', 'Q893745'],
      wikidataArtwork: false,
      creators: ['Kārlis Zāle'],
      sitelinksCount: 41,
    });
  });

  it('reads and writes what a street-art place holds in Public art alone, its pictures credited (#2055)', async () => {
    const vrubel = 'https://commons.wikimedia.org/wiki/Special:FilePath/Vrubel.jpg';
    placeContents.read.mockResolvedValue({ withdrawalSkippedReason: 'placed 0 of the 7 works', imageUrls: [vrubel] });
    const works = { added: [], withdrawn: [], returned: [], changed: [] };
    placeContents.write.mockResolvedValue(works);
    const { fetchCommonsCredits } = await import('./imageCredit.js');
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 9, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    const config = await configOf();
    const fetched = await config.fetchItems(progress(), []);
    expect(placeContents.read).toHaveBeenCalledWith(fetched.items, expect.any(Function), expect.anything());
    expect(vi.mocked(fetchCommonsCredits).mock.calls[0][0]).toContain(vrubel);
    expect(fetched.withdrawalSkippedReason).toBe('placed 0 of the 7 works');
    const result = await config.processItem(landmark(), progress(), context);
    expect(placeContents.write).toHaveBeenCalledWith(7, 'Q337179', context, expect.any(Map));
    expect(result.contents).toEqual({ locations: {}, treasures: works });

    vi.clearAllMocks();
    const monuments = await configOf({}, 6);
    await monuments.fetchItems(progress(), []);
    await monuments.processItem(landmark(), progress(), context);
    expect(placeContents.read).not.toHaveBeenCalled();
    expect(placeContents.write).not.toHaveBeenCalled();
  });

  it('writes the readership door\'s question for Public art\'s membership, and none where the line admits (#2033)', async () => {
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 9, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };
    const note = 'Admitted below the sitelinks line, read 193,801 times this year in every counted edition, '
      + "over the readership door's bar of 115,121. Can a visitor see it there now?";
    const kelpies = landmark({ qid: 'Q16988858', label: 'The Kelpies', sitelinks: 17, readershipNote: note });

    await (await configOf()).processItem(kelpies, progress(), context);
    expect(mockedUpsert.mock.calls[0][0].metadata.admissionNote).toBe(note);
    // Absent where the line admitted the work: the kind's facts are written
    // whole (`kindFacts.ts`), so a question answered once does not linger.
    await (await configOf()).processItem(landmark(), progress(), context);
    expect(mockedUpsert.mock.calls[1][0].metadata).not.toHaveProperty('admissionNote');
    // A Monuments & memorials item the line admits carries no door's question
    // (its guide door asks one only under the line, ADR-0167); and what it
    // writes lands on its own membership, never on Public art's, so it could
    // not clear Public art's question either.
  });

  it('writes an edition as one place with a point at every cast, told to be at the most central one (#880)', async () => {
    const mockedWrite = writeExperienceLocations as unknown as ReturnType<typeof vi.fn>;
    mockedWrite.mockResolvedValue({ unchanged: 0, needsAssignment: [1, 2, 3, 4], unoffered: 0, delta: {} });
    const config = await configOf();
    await config.fetchItems(progress(), []);
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 9, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };
    // Maman: the kept point is Minato's, the casts stand on three continents.
    // Ottawa is listed first and Bilbao is the most central, so the anchor
    // below is the medoid's and not the first cast's.
    const maman = landmark({
      qid: 'Q180887', label: 'Maman', description: 'sculpture by Louise Bourgeois', lat: 35.6610104, lon: 139.7296602,
      countryLabel: 'Japan', type: 'sculpture',
      casts: [
        { name: 'Ottawa', lat: 45.429333, lon: -75.697277, countryLabel: 'Canada' },
        { name: 'Bilbao', lat: 43.269189, lon: -2.932958, countryLabel: 'Spain' },
        { name: 'London', lat: 51.507694, lon: -0.099333, countryLabel: 'United Kingdom' },
        { name: 'Minato', lat: 35.6610104, lon: 139.7296602, countryLabel: 'Japan' },
      ],
    });

    await config.processItem(maman, progress(), context);

    const params = mockedUpsert.mock.calls.at(-1)![0];
    // The anchor is a cast, the most central one, written past the gate; the countries are every cast's.
    expect(params.locationIsAnchor).toBe(true);
    // Its points are casts of one work, which a visit to any marks seen (ADR-0145 decision 5).
    expect(params.castPoints).toBe(true);
    expect([params.lat, params.lon]).toEqual([43.269189, -2.932958]);
    // Every cast's country, the anchor's first: a reader showing one country shows the anchor's.
    expect(params.countryNames).toEqual(['Spain', 'Canada', 'United Kingdom', 'Japan']);
    // Every cast is a point of the one place, named for where it stands, under the work's own reference.
    expect(upsertSingleLocation).not.toHaveBeenCalled();
    const [experienceId, offered, run] = mockedWrite.mock.calls.at(-1)!;
    expect(experienceId).toBe(7);
    expect(offered).toEqual([
      { name: 'Ottawa', externalRef: 'Q180887', lon: -75.697277, lat: 45.429333 },
      { name: 'Bilbao', externalRef: 'Q180887', lon: -2.932958, lat: 43.269189 },
      { name: 'London', externalRef: 'Q180887', lon: -0.099333, lat: 51.507694 },
      { name: 'Minato', externalRef: 'Q180887', lon: 139.7296602, lat: 35.6610104 },
    ]);
    expect(run).toEqual({ syncLogId: 9, sourceId: 3 });
    expect(context.onLocationsChanged).toHaveBeenCalled();
  });

  it('writes the one surviving cast at its own named point and country rather than the group coordinate', async () => {
    const mockedWrite = writeExperienceLocations as unknown as ReturnType<typeof vi.fn>;
    mockedWrite.mockResolvedValue({ unchanged: 0, needsAssignment: [], unoffered: 0, delta: {} });
    const config = await configOf();
    await config.fetchItems(progress(), []);
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 9, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };
    await config.processItem(landmark({
      qid: 'Q978987', label: 'The Burghers of Calais', lat: 50.9524, lon: 1.8533, countryLabel: 'France',
      casts: [{ name: 'Stanford University', lat: 37.428, lon: -122.1699, countryLabel: 'United States' }],
    }), progress(), context);

    expect(mockedUpsert.mock.calls.at(-1)![0]).toMatchObject({
      lat: 37.428, lon: -122.1699, countryNames: ['United States'], locationIsAnchor: true,
    });
    expect(mockedWrite.mock.calls.at(-1)?.[1]).toEqual([
      { name: 'Stanford University', externalRef: 'Q978987', lon: -122.1699, lat: 37.428 },
    ]);
    expect(upsertSingleLocation).not.toHaveBeenCalled();
  });
});

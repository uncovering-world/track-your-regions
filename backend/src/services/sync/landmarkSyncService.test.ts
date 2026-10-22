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
vi.mock('./syncUtils.js', () => ({
  upsertExperienceRecord: vi.fn(),
  upsertSingleLocation: vi.fn(),
}));
vi.mock('./wikidataCache.js', () => ({
  pruneExpired: vi.fn().mockResolvedValue(0),
  withCache: vi.fn((door: unknown) => door),
}));
vi.mock('./publicArt/pipeline.js', () => ({ classifyPublicArt: vi.fn(), PUBLIC_ART_KIND: { name: 'public art' } }));
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
import { withCache } from './wikidataCache.js';
import { classifyPublicArt, PUBLIC_ART_KIND } from './publicArt/pipeline.js';
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
  pooled: 0,
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
    expect(config.badgesAdmitted).toBe(true);
  });

  it('hands the collection what the source already admits, and its refusals back', async () => {
    const refusal = { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' };
    mockedCollect.mockReturnValue({ items: [landmark()], fetched: 5, filtered: [refusal] });

    const config = await configOf();
    const fetched = await config.fetchItems(progress(), []);

    expect(mockedAdmitted).toHaveBeenCalledWith(3);
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
    expect(mockedAdmitted).toHaveBeenCalledWith(6);
    expect(mockedCollect.mock.calls[0][1]).toBe(MONUMENTS_RULE);
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
    expect(mockedAdmitted).toHaveBeenCalledWith(7);
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

  it('tells two landmarks of one name apart by where the description puts them', async () => {
    mockedCollect.mockReturnValue({
      items: [
        landmark({ qid: 'Q1', label: 'Victoria Memorial', description: 'memorial in London' }),
        landmark({ qid: 'Q2', label: 'Victoria Memorial', description: 'monument in Kolkata, India' }),
      ],
      fetched: 2, filtered: [],
    });
    const config = await configOf();
    const { items } = await config.fetchItems(progress(), []);
    expect(items.map((i) => i.label)).toEqual(['Victoria Memorial (London)', 'Victoria Memorial (Kolkata)']);
  });
});

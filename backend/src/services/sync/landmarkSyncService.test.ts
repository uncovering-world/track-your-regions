/**
 * How the landmark run wires the public-art collection to the orchestrator.
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
vi.mock('./publicArt/pipeline.js', () => ({ gatherPublicArt: vi.fn(), classifyPublicArt: vi.fn() }));
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
import { classifyPublicArt, gatherPublicArt } from './publicArt/pipeline.js';
import { admittedExternalIds } from './admission.js';
import { syncLandmarks } from './landmarkSyncService.js';
import type { SyncProgress, WikidataLandmark } from './types.js';

const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedGather = gatherPublicArt as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = classifyPublicArt as unknown as ReturnType<typeof vi.fn>;
/** What the gather hands the classification; the classification is what the tests say. */
const GATHERED = { trees: {}, pool: new Map(), facts: new Map(), containers: new Map() };
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

async function configOf(options: { dryRun?: boolean; refreshCache?: boolean } = {}) {
  await syncLandmarks(1, options);
  return mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<WikidataLandmark>;
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

describe('syncLandmarks', () => {
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
    expect(mockedGather.mock.calls[0][1]).toEqual(new Set(['Q337179']));
    expect(mockedCollect.mock.calls[0][0]).toBe(GATHERED);
    expect(mockedCollect.mock.calls[0][1]).toEqual(new Set(['Q337179']));
    // And the places another kind offers, so a work outdoors on a venue no
    // kind offers stays public art (#1444).
    expect(mockedCollect.mock.calls[0][2]).toEqual(new Set(['Q19675']));
    expect(fetched.fetchedCount).toBe(5);
    expect(fetched.filtered).toEqual([refusal]);
    expect(fetched.items.map((i) => i.qid)).toEqual(['Q337179']);
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

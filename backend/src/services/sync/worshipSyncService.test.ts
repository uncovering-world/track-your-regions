/**
 * How the run around the worship collector wires the parts it does not own.
 *
 * The collector has its own tests, the coverage floor has one, and so does the
 * writer the works go to. What none of them can see is the join: that the line
 * comes off the source row before a single query is sent, that the floor is
 * measured over the placements the run read *before* writing and reaches the
 * works writer with this source's id, and that a place is written with the
 * classes and the sitelinks the run learned about it rather than with the
 * bookkeeping it keeps to itself.
 *
 * Everything around the join is mocked: the pipeline, Wikidata, Commons, the
 * upserts. The two things under test are the shape of `fetchItems`'s answer and
 * the arguments `processItem` hands the two writers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  db: {},
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
  withCache: vi.fn((door: unknown) => door),
}));
vi.mock('./pictureRepair.js', () => ({ writeFoundPicture: vi.fn() }));
vi.mock('./worship/pipeline.js', () => ({ collectPlacesOfWorship: vi.fn() }));
vi.mock('./museum/pipeline.js', () => ({ collectTier1Museums: vi.fn() }));
vi.mock('./museum/queries.js', () => ({ fetchEntityDetails: vi.fn(), isQid: vi.fn() }));
vi.mock('./admission.js', () => ({ admittedExternalIds: vi.fn().mockResolvedValue(new Set()) }));
vi.mock('./wikidataUtils.js', () => ({
  delay: vi.fn(),
  WaitBudget: class WaitBudget {},
  SPARQL_DELAY_MS: 0,
  SPARQL_WAIT_BUDGET_MS: 0,
  waitMessage: vi.fn(),
  WIKIDATA_USER_AGENT: 'test',
  wikidataDoor: vi.fn(() => vi.fn()),
}));
vi.mock('./museum/treasureWriter.js', () => ({
  upsertVenueTreasures: vi.fn().mockResolvedValue({
    added: [], withdrawn: [], returned: [], changed: [],
  }),
}));
vi.mock('./imageCredit.js', () => ({
  fetchCommonsCredits: vi.fn().mockResolvedValue(new Map()),
  readStoredCredits: vi.fn().mockResolvedValue(new Map()),
  readStoredTreasureCredits: vi.fn().mockResolvedValue(new Map()),
  creditToWrite: vi.fn().mockReturnValue({}),
}));

import { pool } from '../../db/index.js';
import { orchestrateSync, type SyncServiceConfig, type SyncRunContext } from './syncOrchestrator.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { admittedExternalIds } from './admission.js';
import { collectPlacesOfWorship, type CollectedPlaceOfWorship } from './worship/pipeline.js';
import { upsertVenueTreasures } from './museum/treasureWriter.js';
import { syncPlacesOfWorship } from './worshipSyncService.js';
import type { SyncProgress } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = collectPlacesOfWorship as unknown as ReturnType<typeof vi.fn>;
const mockedAdmitted = admittedExternalIds as unknown as ReturnType<typeof vi.fn>;
const mockedWriter = upsertVenueTreasures as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>;
const mockedLocation = upsertSingleLocation as unknown as ReturnType<typeof vi.fn>;

/** Cologne Cathedral, whose Shrine of the Three Kings is what the works door names. */
const COLOGNE = 'Q4176';
const SHRINE = 'Q693472';
/** Ten treasures the catalogue offers at the cathedral, as `readPreviousPlacements` answers. */
const STORED = Array.from({ length: 10 }, (_, i) => ({ work: `Q${1000 + i}`, venue: COLOGNE }));

function place(overrides: Partial<CollectedPlaceOfWorship> = {}): CollectedPlaceOfWorship {
  return {
    qid: COLOGNE,
    label: 'Cologne Cathedral',
    description: 'cathedral in Cologne, Germany',
    lat: 50.9413,
    lon: 6.958,
    imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Cologne.jpg',
    sitelinks: 96,
    countryLabel: 'Germany',
    articleUrl: 'https://en.wikipedia.org/wiki/Cologne_Cathedral',
    website: 'https://www.koelner-dom.de/',
    type: 'cathedral',
    classes: ['Q2977', 'Q16970'],
    artworks: [{
      externalId: SHRINE, name: 'Shrine of the Three Kings', treasureType: 'reliquary',
      artists: ['Nicholas of Verdun'], year: 1225, imageUrl: null, sitelinksCount: 17,
    }],
    admittedFor: { qid: SHRINE, label: 'Shrine of the Three Kings' },
    door: 'both',
    ...overrides,
  };
}

function progress(): SyncProgress {
  return {
    cancel: false, kind: 'sync', status: 'fetching', statusMessage: '', progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0,
    filtered: 0, errors: 0, currentItem: '', logId: 51, dryRun: false,
  };
}

/** The source row's own line (ADR-0052), as the seed writes it. */
function lineRow(): { rows: { api_config: unknown }[] } {
  return { rows: [{ api_config: { enterSitelinks: 22, staySitelinks: 18 } }] };
}

/** The config the run hands the orchestrator, captured rather than run. */
async function configOf(): Promise<SyncServiceConfig<CollectedPlaceOfWorship>> {
  await syncPlacesOfWorship(1);
  return mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<CollectedPlaceOfWorship>;
}

/** A collection that admits `items`, with nothing refused and nothing moved. */
function collected(items: CollectedPlaceOfWorship[], fetched = 1200): void {
  mockedCollect.mockResolvedValueOnce({
    items, fetched, filtered: [], diff: { moved: [], gained: [], lost: [], dropped: [] },
  });
}

function wrote(experienceId = 7301): void {
  mockedUpsert.mockResolvedValue({
    experienceId,
    changeSet: {
      changeType: 'unchanged', changedFields: [], significance: null,
      curatedConflicts: [], heldFields: [],
    },
    nameSnapshot: 'Cologne Cathedral',
    returnedFromMissing: false,
  });
  mockedLocation.mockResolvedValue({
    unchanged: [1], needsAssignment: [], unoffered: 0,
    delta: { added: [], withdrawn: [], returned: [], changed: [] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmitted.mockResolvedValue(new Set<string>());
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('what the worship run fetches', () => {
  it('reads the line off the source row before collecting, and hands it to the collector', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    mockedAdmitted.mockResolvedValue(new Set([COLOGNE]));
    collected([place()]);

    const result = await (await configOf()).fetchItems(progress(), []);

    // The line is the source's, not the pipeline's: a run that used a constant
    // would admit a different catalogue than the panel says it does (ADR-0052).
    const [lineSql, lineParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(lineSql).toContain('api_config');
    expect(lineParams).toEqual([4]);
    const deps = mockedCollect.mock.calls[0][0];
    expect(deps.line).toEqual({ enterSitelinks: 22, staySitelinks: 18 });
    // What the source already admits, so the stay line has something to hold.
    expect(deps.admitted).toEqual(new Set([COLOGNE]));
    expect(result.fetchedCount).toBe(1200);
  });

  it('measures the works floor over what it read before writing, and answers with the verdict', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    // One of the ten offered treasures placed again: run 42's shape.
    collected([place({ artworks: [{
      externalId: 'Q1000', name: 'Q1000', treasureType: 'reliquary', artists: [], year: null,
      imageUrl: null, sitelinksCount: 30,
    }] })]);

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toContain('1 of the 10 works');
    // The floor and the placement diff are measured against the same map, so
    // they cannot disagree about what the last run left.
    expect(mockedCollect.mock.calls[0][0].previousPlacements).toEqual(
      Object.fromEntries(STORED.map(({ work }) => [work, [COLOGNE]])),
    );
  });

  it('vouches for a run that placed the treasures again', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    collected([place({ artworks: STORED.map(({ work }) => ({
      externalId: work, name: work, treasureType: 'reliquary', artists: [], year: null,
      imageUrl: null, sitelinksCount: 30,
    })) })]);

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toBeNull();
  });
});

describe('what the worship run writes', () => {
  it('writes the place with its type, its tags and the run notes about it', async () => {
    wrote();
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 51, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    await (await configOf()).processItem(place(), progress(), context);

    const params = mockedUpsert.mock.calls[0][0];
    expect(params).toMatchObject({
      categoryId: 4,
      externalId: COLOGNE,
      name: 'Cologne Cathedral',
      // A reader browses the kind and filters by the word (ADR-0045): the type
      // is the column, and the tag beside `worship` is the same word.
      type: 'cathedral',
      tags: ['worship', 'cathedral'],
      // The reason this membership exists, nameable: the treasure that admitted it.
      admittedFor: { qid: SHRINE, label: 'Shrine of the Three Kings' },
    });
    expect(params.metadata).toMatchObject({
      wikidataQid: COLOGNE,
      wikidataClasses: ['Q2977', 'Q16970'],
      sitelinksCount: 96,
      artworkCount: 1,
      totalArtworkSitelinks: 17,
      website: 'https://www.koelner-dom.de/',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Cologne_Cathedral',
    });
    // Which door admitted it is the run's own bookkeeping, and `admitted_for`
    // already says whether a treasure opened one. A metadata key nothing reads
    // is a proposal a curator can be asked about.
    expect(params.metadata).not.toHaveProperty('door');
  });

  it('tags a place its classes name no word for with the kind alone', async () => {
    wrote();
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 51, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    await (await configOf()).processItem(
      place({ type: null, admittedFor: undefined, door: 'place' }), progress(), context,
    );

    const params = mockedUpsert.mock.calls[0][0];
    expect(params.type).toBeNull();
    expect(params.tags).toEqual(['worship']);
    // A place through door one is admitted for its own fame, and no work names it.
    expect(params.admittedFor).toBeNull();
  });

  it('hands the treasures to the shared writer with this source and the run', async () => {
    wrote();
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 51, onLocationsChanged: vi.fn(),
      withdrawalSkippedReason: 'this run placed 1 of the 10 works',
    };

    await (await configOf()).processItem(place(), progress(), context);

    // The reason and the id travel together: a writer told the id and not the
    // verdict would mark links on a run nothing vouched for (ADR-0044).
    expect(mockedWriter).toHaveBeenCalledWith(
      7301,
      [expect.objectContaining({ externalId: SHRINE })],
      expect.anything(),
      {
        syncLogId: 51, withdrawalSkippedReason: 'this run placed 1 of the 10 works', categoryId: 4,
      },
      expect.anything(),
    );
  });

  it('tells each place which treasures the run places elsewhere, from the proposal it read up front', async () => {
    // The Shrine stays at Cologne; Q1001 goes to the Basilica. At Cologne's turn
    // the Basilica may not have been written yet, so the writer is told from the
    // proposal rather than left to find the new link (ADR-0044 decision 5).
    const BASILICA = 'Q42887';
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    const cologne = place();
    const basilica = place({
      qid: BASILICA, label: 'Basilica of Saint-Denis', artworks: ['Q1001', 'Q1002'].map((work) => ({
        externalId: work, name: work, treasureType: 'tomb', artists: [], year: null,
        imageUrl: null, sitelinksCount: 25,
      })),
    });
    collected([cologne, basilica]);
    wrote();
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 51, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    const config = await configOf();
    await config.fetchItems(progress(), []);
    await config.processItem(cologne, progress(), context);

    const placedElsewhere = mockedWriter.mock.calls[0][4] as string[];
    expect([...placedElsewhere].sort()).toEqual(['Q1001', 'Q1002']);
  });

  it('writes no point and no treasures on a preview', async () => {
    mockedUpsert.mockResolvedValue({
      experienceId: 0,
      changeSet: {
        changeType: 'created', changedFields: [], significance: null,
        curatedConflicts: [], heldFields: [],
      },
      nameSnapshot: 'Cologne Cathedral',
      returnedFromMissing: false,
    });
    const context: SyncRunContext = {
      dryRun: true, syncLogId: 51, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    const result = await (await configOf()).processItem(place(), progress(), context);

    expect(mockedLocation).not.toHaveBeenCalled();
    expect(mockedWriter).not.toHaveBeenCalled();
    // Undefined rather than an empty delta: a preview never asked the question
    // (ADR-0026), and 0 is the upsert's stand-in for a row that does not exist.
    expect(result.contents).toEqual({ locations: undefined, treasures: undefined });
    expect(result.experienceId).toBeNull();
  });
});

describe('what the worship run tells the orchestrator', () => {
  it('is a ranked source that recomputes its membership and badges what it admits', async () => {
    const config = await configOf();

    expect(config.categoryId).toBe(4);
    expect(config.sourceCompleteness).toBe('ranked');
    expect(config.recomputesMembership).toBe(true);
    // Both doors are the world tier (ADR-0045 decision 5): a place clears the
    // source's own fame line, or holds a treasure that clears it.
    expect(config.badgesAdmitted).toBe(true);
    expect(config.getItemName(place())).toBe('Cologne Cathedral');
    expect(config.getItemId(place())).toBe(COLOGNE);
  });
});

/**
 * How the museum run wires the works coverage floor (ADR-0044).
 *
 * The floor itself is a pure function with its own test, and the orchestrator's
 * handling of a verdict has one too. What neither can see is the join between
 * them: that the run measures the floor over the placements it read *before*
 * writing, from the proposal it is about to write, and that the verdict the
 * orchestrator hands back reaches the works writer with the run's own id. A
 * floor computed and then forgotten is run 42 with a withdrawal arm.
 *
 * Everything around the join is mocked: the pipeline, Wikidata, Commons, the
 * upserts. The two things under test are the shape of `fetchItems`'s answer
 * and the arguments `processItem` hands the writer.
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
vi.mock('./museum/pipeline.js', () => ({ collectTier1Museums: vi.fn() }));
vi.mock('./museum/queries.js', () => ({ fetchEntityDetails: vi.fn(), isQid: vi.fn() }));
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
  upsertMuseumTreasures: vi.fn().mockResolvedValue({
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
import { collectTier1Museums } from './museum/pipeline.js';
import { upsertMuseumTreasures } from './museum/treasureWriter.js';
import { syncMuseums } from './museumSyncService.js';
import type { CollectedMuseum, SyncProgress } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = collectTier1Museums as unknown as ReturnType<typeof vi.fn>;
const mockedWriter = upsertMuseumTreasures as unknown as ReturnType<typeof vi.fn>;

const LOUVRE = 'Q19675';
/** Ten works the catalogue offers at the Louvre, as `readPreviousPlacements` answers. */
const STORED = Array.from({ length: 10 }, (_, i) => ({ work: `Q${1000 + i}`, venue: LOUVRE }));

function museum(qid: string, works: string[]): CollectedMuseum {
  return {
    qid,
    label: 'Louvre Museum',
    admittedFor: { qid: works[0], label: 'Mona Lisa' },
    artworks: works.map((externalId) => ({
      externalId, name: externalId, treasureType: 'painting', artists: [], year: null,
      imageUrl: null, sitelinksCount: 30,
    })),
    details: {
      museumQid: qid, museumLabel: 'Louvre Museum', description: null, lat: 48.86, lon: 2.34,
      countryLabel: 'France', imageUrl: null, website: null, articleUrl: null,
    },
  };
}

function progress(): SyncProgress {
  return {
    cancel: false, kind: 'sync', status: 'fetching', statusMessage: '', progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0,
    filtered: 0, errors: 0, currentItem: '', logId: 42, dryRun: false,
  };
}

/** The config the run hands the orchestrator, captured rather than run. */
async function configOf(): Promise<SyncServiceConfig<CollectedMuseum>> {
  await syncMuseums(1);
  return mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<CollectedMuseum>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('the museum run and its floor', () => {
  it('measures what it read before writing against what it is about to write, and answers with the verdict', async () => {
    // A sixth of the works: run 42's shape. The placements are read once, up
    // front, and the proposal is the pipeline's; nothing in between has written.
    mockedQuery.mockResolvedValueOnce({ rows: STORED });
    mockedCollect.mockResolvedValueOnce({
      items: [museum(LOUVRE, ['Q1000'])], fetched: 291, filtered: [],
      diff: { moved: [], gained: [], lost: [], dropped: [] },
    });

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toContain('1 of the 10 works');
    expect(result.withdrawalSkippedReason).toContain('1 museums');
    expect(result.fetchedCount).toBe(291);
    // What the pipeline was measured against is what it was told the last run
    // left — the same map, so the diff and the floor cannot disagree.
    expect(mockedCollect.mock.calls[0][0].previousPlacements).toEqual(
      Object.fromEntries(STORED.map(({ work }) => [work, [LOUVRE]])),
    );
  });

  it('vouches for a run that placed the works again', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: STORED });
    mockedCollect.mockResolvedValueOnce({
      items: [museum(LOUVRE, STORED.map(({ work }) => work))], fetched: 2536, filtered: [],
      diff: { moved: [], gained: [], lost: [], dropped: [] },
    });

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toBeNull();
  });

  it('hands the verdict the orchestrator carried back to the works writer, with the run', async () => {
    (upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      experienceId: 6184,
      changeSet: {
        changeType: 'unchanged', changedFields: [], significance: null,
        curatedConflicts: [], heldFields: [],
      },
      nameSnapshot: 'Louvre Museum',
      returnedFromMissing: false,
    });
    (upsertSingleLocation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      unchanged: [1], needsAssignment: [], unoffered: 0,
      delta: { added: [], withdrawn: [], returned: [], changed: [] },
    });
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 42, onLocationsChanged: vi.fn(),
      withdrawalSkippedReason: 'this run placed 1 of the 10 works',
    };

    await (await configOf()).processItem(museum(LOUVRE, ['Q1000']), progress(), context);

    // The reason and the id travel together: a writer told the id and not the
    // verdict would mark links on a run nothing vouched for.
    expect(mockedWriter).toHaveBeenCalledWith(
      6184, expect.anything(), expect.anything(),
      { syncLogId: 42, withdrawalSkippedReason: 'this run placed 1 of the 10 works' },
      expect.anything(),
    );
  });

  it('tells each museum which works the run places elsewhere, from the proposal it read up front', async () => {
    // The Louvre loses Q1001 to the Prado and keeps Q1000; the Prado gains it.
    // At the Louvre's turn the Prado may not have been written yet, so the
    // writer is told from the proposal rather than left to find the new link in
    // the table (ADR-0044 decision 5).
    const PRADO = 'Q160112';
    mockedQuery.mockResolvedValueOnce({ rows: STORED });
    const louvre = museum(LOUVRE, ['Q1000']);
    const prado = museum(PRADO, ['Q1001', 'Q1002']);
    mockedCollect.mockResolvedValueOnce({
      items: [louvre, prado], fetched: 2536, filtered: [],
      diff: { moved: [], gained: [], lost: [], dropped: [] },
    });
    (upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      experienceId: 6184,
      changeSet: {
        changeType: 'unchanged', changedFields: [], significance: null,
        curatedConflicts: [], heldFields: [],
      },
      nameSnapshot: 'Louvre Museum',
      returnedFromMissing: false,
    });
    (upsertSingleLocation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      unchanged: [1], needsAssignment: [], unoffered: 0,
      delta: { added: [], withdrawn: [], returned: [], changed: [] },
    });
    const context: SyncRunContext = {
      dryRun: false, syncLogId: 42, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
    };

    const config = await configOf();
    await config.fetchItems(progress(), []);
    await config.processItem(louvre, progress(), context);

    // Everything placed at another admitted museum and not here — the writer's
    // SQL narrows it to the works actually linked here.
    const placedElsewhere = mockedWriter.mock.calls[0][4] as string[];
    expect([...placedElsewhere].sort()).toEqual(['Q1001', 'Q1002']);
  });
});

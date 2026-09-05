/**
 * How the landmark run wires the public-art collection to the orchestrator.
 *
 * The collection is a pure pipeline with its own test and the orchestrator's
 * handling of refusals and the sweep has one too. What neither can see is the
 * join: that the run reads what the category already admits before asking,
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
vi.mock('./publicArt/pipeline.js', () => ({ collectPublicArt: vi.fn() }));
vi.mock('./admission.js', () => ({ admittedExternalIds: vi.fn() }));
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

import { orchestrateSync, type SyncServiceConfig, type SyncRunContext } from './syncOrchestrator.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { withCache } from './wikidataCache.js';
import { collectPublicArt } from './publicArt/pipeline.js';
import { admittedExternalIds } from './admission.js';
import { syncLandmarks } from './landmarkSyncService.js';
import type { SyncProgress, WikidataLandmark } from './types.js';

const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = collectPublicArt as unknown as ReturnType<typeof vi.fn>;
const mockedAdmitted = admittedExternalIds as unknown as ReturnType<typeof vi.fn>;
const mockedWithCache = withCache as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>;

function landmark(over: Partial<WikidataLandmark> = {}): WikidataLandmark {
  return {
    qid: 'Q337179', label: 'Freedom Monument', description: 'monument in Riga', lat: 56.95, lon: 24.11,
    imageUrl: null, creators: ['Kārlis Zāle'], year: 1935, sitelinks: 41, countryLabel: 'Latvia',
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
  mockedCollect.mockResolvedValue({ items: [landmark()], fetched: 1, filtered: [] });
  mockedUpsert.mockResolvedValue({
    experienceId: 7, changeSet: { changeType: 'unchanged' }, nameSnapshot: 'Freedom Monument', returnedFromMissing: false,
  });
  (upsertSingleLocation as unknown as ReturnType<typeof vi.fn>)
    .mockResolvedValue({ needsAssignment: [], unoffered: 0, delta: {} });
});

describe('syncLandmarks', () => {
  it('recomputes its membership every run, and belonging is the badge', async () => {
    const config = await configOf();
    expect(config.categoryId).toBe(3);
    expect(config.sourceCompleteness).toBe('ranked');
    expect(config.recomputesMembership).toBe(true);
    expect(config.badgesAdmitted).toBe(true);
  });

  it('hands the collection what the category already admits, and its refusals back', async () => {
    const refusal = { externalId: 'Q1499912', name: 'Segovia Cathedral', reason: 'a place of worship, not public art' };
    mockedCollect.mockResolvedValue({ items: [landmark()], fetched: 5, filtered: [refusal] });

    const config = await configOf();
    const fetched = await config.fetchItems(progress(), []);

    expect(mockedAdmitted).toHaveBeenCalledWith(3);
    expect(mockedCollect.mock.calls[0][1]).toEqual(new Set(['Q337179']));
    expect(fetched.fetchedCount).toBe(5);
    expect(fetched.filtered).toEqual([refusal]);
    expect(fetched.items.map((i) => i.qid)).toEqual(['Q337179']);
  });

  it('keeps its answers by default and asks the source afresh when told to', async () => {
    const config = await configOf({ refreshCache: true });
    await config.fetchItems(progress(), []);
    expect(mockedWithCache.mock.calls[0][1]).toMatchObject({ categoryId: 3, enabled: false });

    vi.clearAllMocks();
    mockedAdmitted.mockResolvedValue(new Set());
    mockedCollect.mockResolvedValue({ items: [], fetched: 0, filtered: [] });
    const plain = await configOf();
    await plain.fetchItems(progress(), []);
    expect(mockedWithCache.mock.calls[0][1]).toMatchObject({ categoryId: 3, enabled: true });
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
    mockedCollect.mockResolvedValue({
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

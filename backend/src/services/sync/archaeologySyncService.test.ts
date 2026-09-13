/**
 * How the run around the archaeology collector wires the parts it does not own.
 *
 * The collector has its own tests, the rule that reads a museum's nature has
 * one, and so does the writer the finds go to. What none of them can see is the
 * join: that both lines come off the source row before a single query is sent,
 * that English Wikipedia is asked through the one door and a batch it cannot
 * read is allowed to end the run, that the floor is measured over the
 * placements the run read *before* writing, and that a museum is written with
 * the nature and the categories the run learned about it.
 *
 * Everything around the join is mocked: the pipeline, Wikidata, Wikipedia,
 * Commons, the upserts. The two things under test are the shape of
 * `fetchItems`'s answer and the arguments `processItem` hands the two writers.
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
vi.mock('./archaeology/pipeline.js', () => ({ collectArchaeologyMuseums: vi.fn() }));
vi.mock('./museum/pipeline.js', () => ({ collectTier1Museums: vi.fn() }));
vi.mock('./museum/queries.js', () => ({ fetchEntityDetails: vi.fn(), isQid: vi.fn() }));
vi.mock('./admission.js', () => ({ admittedExternalIds: vi.fn().mockResolvedValue(new Set()) }));
vi.mock('./wikidataUtils.js', () => ({
  delay: vi.fn(),
  WaitBudget: class WaitBudget {},
  SPARQL_DELAY_MS: 0,
  SPARQL_WAIT_BUDGET_MS: 0,
  waitMessage: vi.fn(),
  // Never the real one: a test must not send this repo's name to a wiki if a
  // mock ever stops standing between the two.
  WIKIDATA_USER_AGENT: 'test',
  wikidataDoor: vi.fn(() => vi.fn()),
}));
vi.mock('./wikipediaCategories.js', () => ({
  fetchWikipediaCategories: vi.fn().mockResolvedValue(new Map()),
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
import {
  collectArchaeologyMuseums, type CollectedArchaeologyMuseum,
} from './archaeology/pipeline.js';
import { fetchWikipediaCategories } from './wikipediaCategories.js';
import { upsertVenueTreasures } from './museum/treasureWriter.js';
import { syncArchaeology } from './archaeologySyncService.js';
import type { ProcessedContent, SyncProgress } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = collectArchaeologyMuseums as unknown as ReturnType<typeof vi.fn>;
const mockedCategories = fetchWikipediaCategories as unknown as ReturnType<typeof vi.fn>;
const mockedAdmitted = admittedExternalIds as unknown as ReturnType<typeof vi.fn>;
const mockedWriter = upsertVenueTreasures as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>;
const mockedLocation = upsertSingleLocation as unknown as ReturnType<typeof vi.fn>;

/** The British Museum, which Wikidata types no archaeology and Wikipedia files as it. */
const BRITISH_MUSEUM = 'Q6373';
/** The Rosetta Stone, shown in London and found at Fort Julien. */
const ROSETTA = 'Q48584';
/** The Hermitage: an antiquities department inside a museum of everything. */
const HERMITAGE = 'Q132783';
/** Ten finds the catalogue offers in London, as `readPreviousPlacements` answers. */
const STORED = Array.from({ length: 10 }, (_, i) => ({ work: `Q${1000 + i}`, venue: BRITISH_MUSEUM }));

function rosetta(overrides: Partial<ProcessedContent> = {}): ProcessedContent {
  return {
    externalId: ROSETTA,
    name: 'Rosetta Stone',
    treasureType: 'stele',
    artists: [],
    year: null,
    imageUrl: null,
    sitelinksCount: 90,
    foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
    ...overrides,
  };
}

function museum(overrides: Partial<CollectedArchaeologyMuseum> = {}): CollectedArchaeologyMuseum {
  return {
    qid: BRITISH_MUSEUM,
    label: 'British Museum',
    description: 'national museum in London, United Kingdom',
    lat: 51.5194,
    lon: -0.1269,
    imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/British%20Museum.jpg',
    sitelinks: 93,
    countryLabel: 'United Kingdom',
    articleUrl: 'https://en.wikipedia.org/wiki/British_Museum',
    website: 'https://www.britishmuseum.org/',
    type: 'museum',
    classes: ['Q3329412', 'Q33506'],
    categories: ['Archaeological museums in London'],
    nature: 'archaeological',
    natureWhy: 'category: Archaeological museums in London',
    admissionNote: null,
    treasures: [rosetta()],
    ...overrides,
  };
}

function progress(): SyncProgress {
  return {
    cancel: false, kind: 'sync', status: 'fetching', statusMessage: '', progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0,
    filtered: 0, errors: 0, currentItem: '', logId: 62, dryRun: false,
  };
}

/** The source row's own two lines: one for museums, one for finds (ADR-0058 decision 5). */
function lineRow(): { rows: { api_config: unknown }[] } {
  return {
    rows: [{
      api_config: {
        enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
      },
    }],
  };
}

/** The config the run hands the orchestrator, captured rather than run. */
async function configOf(): Promise<SyncServiceConfig<CollectedArchaeologyMuseum>> {
  await syncArchaeology(1);
  return mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<CollectedArchaeologyMuseum>;
}

/** A collection that admits `items`, with nothing refused and nothing moved. */
function collected(items: CollectedArchaeologyMuseum[], fetched = 900): void {
  mockedCollect.mockResolvedValueOnce({
    items, fetched, filtered: [], diff: { moved: [], gained: [], lost: [], dropped: [] },
  });
}

function wrote(experienceId = 8104): void {
  mockedUpsert.mockResolvedValue({
    experienceId,
    changeSet: {
      changeType: 'unchanged', changedFields: [], significance: null,
      curatedConflicts: [], heldFields: [],
    },
    nameSnapshot: 'British Museum',
    returnedFromMissing: false,
  });
  mockedLocation.mockResolvedValue({
    unchanged: [1], needsAssignment: [], unoffered: 0,
    delta: { added: [], withdrawn: [], returned: [], changed: [] },
  });
}

function writing(): SyncRunContext {
  return {
    dryRun: false, syncLogId: 62, onLocationsChanged: vi.fn(), withdrawalSkippedReason: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmitted.mockResolvedValue(new Set<string>());
  mockedQuery.mockResolvedValue({ rows: [] });
  mockedCategories.mockResolvedValue(new Map());
});

describe('what the archaeology run fetches', () => {
  it('reads both lines off the source row before collecting, and hands them to the collector', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    mockedAdmitted.mockResolvedValue(new Set([BRITISH_MUSEUM]));
    collected([museum()]);

    const result = await (await configOf()).fetchItems(progress(), []);

    // The lines are the source's, not the pipeline's (ADR-0052), and the
    // finds' pair travels with them: a run that judged finds by the museums'
    // line would lose the museums a famous find carries (ADR-0058 decision 5).
    const [lineSql, lineParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(lineSql).toContain('api_config');
    expect(lineParams).toEqual([5]);
    const deps = mockedCollect.mock.calls[0][0];
    expect(deps.line).toEqual({
      enterSitelinks: 22,
      staySitelinks: 18,
      find: { enterSitelinks: 18, staySitelinks: 15 },
    });
    // What the source already admits, so the stay line has something to hold.
    expect(deps.admitted).toEqual(new Set([BRITISH_MUSEUM]));
    expect(result.fetchedCount).toBe(900);
  });

  it('asks English Wikipedia through the one door, with the run\'s own agent', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([museum()]);

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];
    await deps.categories(['British Museum', 'Hermitage Museum']);

    // The pipeline is handed a function rather than the client, so it neither
    // knows how Wikipedia is asked nor needs it asked at all in a test.
    expect(mockedCategories).toHaveBeenCalledWith(
      ['British Museum', 'Hermitage Museum'],
      expect.objectContaining({ userAgent: 'test' }),
    );
  });

  it('lets a batch Wikipedia could not answer end the run', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([museum()]);
    mockedCategories.mockRejectedValueOnce(new Error('[Wikipedia] the batch of 50 could not be read'));

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];

    // Swallowed, it would be fifty museums read as category-less — which is
    // fifty museums this kind refuses — on a run whose log said success.
    await expect(deps.categories(['British Museum'])).rejects.toThrow('could not be read');
  });

  it('measures the finds floor over what it read before writing, and answers with the verdict', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    // One of the ten offered finds placed again.
    collected([museum({ treasures: [rosetta({ externalId: 'Q1000', name: 'Q1000' })] })]);

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toContain('1 of the 10 works');
    // The floor and the placement diff are measured against the same map, so
    // they cannot disagree about what the last run left.
    expect(mockedCollect.mock.calls[0][0].previousPlacements).toEqual(
      Object.fromEntries(STORED.map(({ work }) => [work, [BRITISH_MUSEUM]])),
    );
  });

  it('vouches for a run that placed the finds again', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    collected([museum({ treasures: STORED.map(({ work }) => rosetta({
      externalId: work, name: work,
    })) })]);

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toBeNull();
  });
});

describe('what the archaeology run writes', () => {
  it('writes the museum with its kind, its tags and the run notes about it', async () => {
    wrote();

    await (await configOf()).processItem(museum(), progress(), writing());

    const params = mockedUpsert.mock.calls[0][0];
    expect(params).toMatchObject({
      sourceId: 5,
      externalId: BRITISH_MUSEUM,
      name: 'British Museum',
      // This kind's other door is the site (ADR-0058 decision 1); a museum is
      // the word a reader filters by, and the column and the tag are that word.
      type: 'museum',
      tags: ['archaeology', 'museum'],
      countryNames: ['United Kingdom'],
      // Admitted for its own fame: no find carried it over the line.
      admittedFor: null,
    });
    expect(params.metadata).toMatchObject({
      wikidataQid: BRITISH_MUSEUM,
      wikidataClasses: ['Q3329412', 'Q33506'],
      // Both halves of the nature rule: what English Wikipedia files the
      // article under, and the answer the rule read off it (ADR-0058 decision 2).
      wikipediaCategories: ['Archaeological museums in London'],
      archaeologyNature: 'archaeological',
      admissionNote: null,
      sitelinksCount: 93,
      artworkCount: 1,
      totalArtworkSitelinks: 90,
      website: 'https://www.britishmuseum.org/',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/British_Museum',
    });
  });

  it('carries a held museum\'s question to its card', async () => {
    wrote();
    const note = 'an antiquities department (category: Egyptological collections in Russia); '
      + 'is the exposition substantially archaeology?';

    await (await configOf()).processItem(museum({
      qid: HERMITAGE,
      label: 'State Hermitage Museum',
      nature: 'department',
      natureWhy: 'category: Egyptological collections in Russia',
      admissionNote: note,
    }), progress(), writing());

    // A department arrives held rather than refused, and the sentence the rule
    // wrote is the question a curator answers (ADR-0058 decision 2).
    expect(mockedUpsert.mock.calls[0][0].metadata.admissionNote).toBe(note);
    expect(mockedUpsert.mock.calls[0][0].metadata.archaeologyNature).toBe('department');
  });

  it('names the find that admitted a museum below the line', async () => {
    wrote();

    await (await configOf()).processItem(museum({
      qid: 'Q636928',
      label: 'Archaeological Museum of Delphi',
      sitelinks: 15,
      admittedFor: { qid: 'Q1230882', label: 'Charioteer of Delphi' },
    }), progress(), writing());

    // The reason this membership exists, nameable: Delphi is in the catalogue
    // because the Charioteer is, and the card says so.
    expect(mockedUpsert.mock.calls[0][0].admittedFor)
      .toEqual({ qid: 'Q1230882', label: 'Charioteer of Delphi' });
  });

  it('hands the finds to the shared writer with this source, the run and where each was found', async () => {
    wrote();

    await (await configOf()).processItem(museum(), progress(), {
      ...writing(), withdrawalSkippedReason: 'this run placed 1 of the 10 works',
    });

    // The reason and the id travel together: a writer told the id and not the
    // verdict would mark links on a run nothing vouched for (ADR-0044). And the
    // find spot rides on the treasure, which is what lets the card say the
    // Rosetta Stone was found at Fort Julien rather than that it is in London.
    expect(mockedWriter).toHaveBeenCalledWith(
      8104,
      [expect.objectContaining({
        externalId: ROSETTA, foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
      })],
      expect.anything(),
      {
        syncLogId: 62, withdrawalSkippedReason: 'this run placed 1 of the 10 works', sourceId: 5,
      },
      expect.anything(),
    );
  });

  it('tells each museum which finds the run places elsewhere, from the proposal it read up front', async () => {
    // The Rosetta Stone stays in London; Q1001 goes to Cairo. At London's turn
    // Cairo may not have been written yet, so the writer is told from the
    // proposal rather than left to find the new link (ADR-0044 decision 5).
    const CAIRO = 'Q191952';
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    const london = museum();
    const cairo = museum({
      qid: CAIRO, label: 'Egyptian Museum', treasures: ['Q1001', 'Q1002'].map((work) => rosetta({
        externalId: work, name: work,
      })),
    });
    collected([london, cairo]);
    wrote();

    const config = await configOf();
    await config.fetchItems(progress(), []);
    await config.processItem(london, progress(), writing());

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
      nameSnapshot: 'British Museum',
      returnedFromMissing: false,
    });

    const result = await (await configOf()).processItem(museum(), progress(), {
      ...writing(), dryRun: true,
    });

    expect(mockedLocation).not.toHaveBeenCalled();
    expect(mockedWriter).not.toHaveBeenCalled();
    // Undefined rather than an empty delta: a preview never asked the question
    // (ADR-0026), and 0 is the upsert's stand-in for a row that does not exist.
    expect(result.contents).toEqual({ locations: undefined, treasures: undefined });
    expect(result.experienceId).toBeNull();
  });
});

describe('what the archaeology run tells the orchestrator', () => {
  it('is a ranked source that recomputes its membership and badges what it admits', async () => {
    const config = await configOf();

    expect(config.sourceId).toBe(5);
    expect(config.sourceCompleteness).toBe('ranked');
    expect(config.recomputesMembership).toBe(true);
    // Both doors are the world tier (ADR-0045 decision 5): a museum clears the
    // source's own fame line, or holds a find that clears the finds' line.
    expect(config.badgesAdmitted).toBe(true);
    expect(config.getItemName(museum())).toBe('British Museum');
    expect(config.getItemId(museum())).toBe(BRITISH_MUSEUM);
  });
});

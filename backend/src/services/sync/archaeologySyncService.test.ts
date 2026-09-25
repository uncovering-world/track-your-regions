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

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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
  withCache: vi.fn((door: unknown) => door),
  clearCache: vi.fn().mockResolvedValue(0),
}));
vi.mock('./pictureRepair.js', () => ({ writeFoundPicture: vi.fn() }));
vi.mock('./archaeology/pipeline.js', () => ({ collectArchaeology: vi.fn() }));
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
  // Read at import time by the pool queries, which the site door pulls in since
  // the run learned to catch its floor error (#581): a mock that omits it turns
  // an unrelated module's top-level template string into a suite that does not
  // load at all.
  LABEL_LANGS: 'en',
}));
vi.mock('./wikipediaCategories.js', () => ({
  fetchWikipediaCategories: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('./wikipediaCategoryMembers.js', () => ({
  fetchCategoryMembers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('./osm/qleverOsm.js', () => ({
  qleverOsmDoor: vi.fn(() => ({ name: 'qlever', question: vi.fn(), send: vi.fn() })),
}));
vi.mock('./osm/overpassOsm.js', () => ({
  overpassOsmDoor: vi.fn(() => ({ name: 'overpass', question: vi.fn(), send: vi.fn() })),
}));
vi.mock('./osm/readOsmObjects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./osm/readOsmObjects.js')>()),
  readOsmObjects: vi.fn().mockResolvedValue(new Map()),
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
import { orchestrateSync } from './syncOrchestrator.js';
import type { SyncServiceConfig, SyncRunContext } from './syncContract.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { admittedExternalIds } from './admission.js';
import {
  collectArchaeology,
  type CollectedArchaeologyItem,
  type CollectedArchaeologyMuseum,
} from './archaeology/pipeline.js';
import type { CollectedArchaeologySite } from './archaeology/proposal.js';
import { qleverOsmDoor } from './osm/qleverOsm.js';
import { overpassOsmDoor } from './osm/overpassOsm.js';
import { readOsmObjects } from './osm/readOsmObjects.js';
import { clearCache, withCache } from './wikidataCache.js';
import { fetchWikipediaCategories } from './wikipediaCategories.js';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';
import { NATURE_CATEGORY } from './archaeology/classes.js';
import { OsmAnswerFloorError } from './archaeology/sites.js';
import { OsmEmptyEnumerationError } from './osm/readOsmObjects.js';
import { upsertVenueTreasures } from './museum/treasureWriter.js';
import { syncArchaeology } from './archaeologySyncService.js';
import type { ProcessedContent, SyncProgress } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedOrchestrate = orchestrateSync as unknown as ReturnType<typeof vi.fn>;
const mockedCollect = collectArchaeology as unknown as ReturnType<typeof vi.fn>;
const mockedCategories = fetchWikipediaCategories as unknown as ReturnType<typeof vi.fn>;
const mockedMembers = fetchCategoryMembers as unknown as ReturnType<typeof vi.fn>;
const mockedAdmitted = admittedExternalIds as unknown as ReturnType<typeof vi.fn>;
const mockedWriter = upsertVenueTreasures as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertExperienceRecord as unknown as ReturnType<typeof vi.fn>;
const mockedLocation = upsertSingleLocation as unknown as ReturnType<typeof vi.fn>;
const mockedOsmDoor = qleverOsmDoor as unknown as ReturnType<typeof vi.fn>;
const mockedOverpassDoor = overpassOsmDoor as unknown as ReturnType<typeof vi.fn>;
const mockedReadOsm = readOsmObjects as unknown as ReturnType<typeof vi.fn>;
const mockedWithCache = withCache as unknown as ReturnType<typeof vi.fn>;
const mockedClearCache = clearCache as unknown as ReturnType<typeof vi.fn>;

/** The British Museum, which Wikidata types no archaeology and Wikipedia files as it. */
const BRITISH_MUSEUM = 'Q6373';
/** The Rosetta Stone, shown in London and found at Fort Julien. */
const ROSETTA = 'Q48584';
/** The Hermitage: an antiquities department inside a museum of everything. */
const HERMITAGE = 'Q132783';
/** The Bardo, in the catalogue on its own 35 articles and holding no famous find. */
const BARDO = 'Q1429003';
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
    // The Rosetta Stone is one find above the finds' line, which is what the
    // badge reads (ADR-0045 decision 5).
    findsAboveLine: 1,
    ...overrides,
  };
}

/** Troy, which every class tree calls an archaeological site and OSM draws. */
const TROY = 'Q22647';

function site(overrides: Partial<CollectedArchaeologySite> = {}): CollectedArchaeologySite {
  return {
    qid: TROY,
    label: 'Troy',
    description: 'ancient city in Anatolia',
    lat: 39.9575,
    lon: 26.238889,
    imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Troy.jpg',
    sitelinks: 96,
    countryLabel: 'Turkey',
    articleUrl: 'https://en.wikipedia.org/wiki/Troy',
    website: null,
    type: 'site',
    classes: ['Q839954'],
    osm: {
      verdict: 'ruin',
      object: 'way/423938794',
      tag: 'historic=archaeological_site',
      extentFrom: 'way/423938794',
      readAt: '2026-09-14T00:00:00.000Z',
    },
    extentWkt: 'POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.96,26.23 39.95))',
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
async function configOf(): Promise<SyncServiceConfig<CollectedArchaeologyItem>> {
  await syncArchaeology(1);
  return mockedOrchestrate.mock.calls[0][0] as SyncServiceConfig<CollectedArchaeologyItem>;
}

/**
 * The config with the run already past its fetch, which is the only order the
 * orchestrator ever uses: the source row read, the lines in hand, the
 * collection answered. A writer test needs it because the finds' line reaches
 * the treasure writer from there and the run refuses to write without it —
 * asked of a config that never fetched, each of these would pass or fail by
 * whatever an earlier test happened to leave in module state.
 */
async function afterFetch(
  items: CollectedArchaeologyItem[] = [museum()],
): Promise<SyncServiceConfig<CollectedArchaeologyItem>> {
  mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
  collected(items);
  const config = await configOf();
  await config.fetchItems(progress(), []);
  return config;
}

/** A collection that admits `items`, with nothing refused and nothing moved. */
function collected(items: CollectedArchaeologyItem[], fetched = 900): void {
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
  mockedMembers.mockResolvedValue(new Map());
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
    // What the source already admits, so the stay line has something to hold —
    // asked by door, so neither judges the other's rows.
    expect(mockedAdmitted).toHaveBeenCalledWith(5, 'museum');
    expect(mockedAdmitted).toHaveBeenCalledWith(5, 'site');
    expect(deps.admittedMuseums).toEqual(new Set([BRITISH_MUSEUM]));
    expect(deps.admittedSites).toEqual(new Set([BRITISH_MUSEUM]));
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

  it('walks the archaeological-museum categories through the one door, with the run\'s own agent', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([museum()]);

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];
    await deps.categoryMembers();

    // The root of the walk and the rule that says which subcategories it
    // follows are the kind's own (`archaeology/classes.ts`), so the door that
    // sends the requests knows nothing about archaeology.
    expect(mockedMembers).toHaveBeenCalledWith(
      'Category:Archaeological museums by country',
      expect.objectContaining({ userAgent: 'test', recurseInto: NATURE_CATEGORY }),
    );
  });

  it('lets a category walk it could not finish end the run', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([museum()]);
    mockedMembers.mockRejectedValueOnce(
      new Error('[Wikipedia] the pages of "Category:Archaeological museums in Iraq" could not be read'),
    );

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];

    // Swallowed, it would be every museum of a country quietly missing from
    // the candidate set on a run whose log said success — the Bardo, the Museo
    // del Oro and the National Museum of Iraq are in the catalogue by this
    // walk alone.
    await expect(deps.categoryMembers()).rejects.toThrow('could not be read');
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

  /**
   * A send the cache mock returns for the OSM door and nothing else, so an
   * assertion on it fails if the door's own send bypassed the cache. The
   * mock's default hands a door back unchanged, which the Wikidata door
   * (`collectingSparql`, composed first) relies on and which would let the
   * bypass pass unnoticed.
   */
  function cachedOsmSend(): ReturnType<typeof vi.fn> {
    const cached = vi.fn();
    mockedWithCache
      .mockImplementationOnce((door: unknown) => door)
      .mockImplementationOnce(() => cached);
    return cached;
  }

  it('asks OpenStreetMap through the mirror door, behind this source\'s own cache', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([site()]);
    const cached = cachedOsmSend();
    const keep = { historic: ['archaeological_site'], manMade: [], boundary: [] };
    const run = { phase: vi.fn(), step: vi.fn() };

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];
    await deps.osm([TROY], keep, run);

    // The pipeline is handed a function rather than the reader, and the reader
    // is handed the door with the cache composed over its send: this file
    // knows whether the run may remember an answer, and `readOsmObjects` knows
    // how to ask for one.
    const door = mockedOsmDoor.mock.results[0].value as { send: unknown };
    expect(mockedWithCache).toHaveBeenCalledWith(
      door.send,
      expect.objectContaining({ sourceId: 5, enabled: true }),
    );
    // The keep rule travels from `collectSitesByFame`, which owns it: which
    // geometries are worth the wire is the kind's line through OSM's keys, and
    // a door that chose its own would have the mirror send the administrative
    // outline of every city in the pool.
    expect(mockedReadOsm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'qlever', send: cached }),
      [TROY], keep, run,
    );
  });

  it('lets a batch OpenStreetMap could not answer end the run', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    collected([site()]);
    mockedReadOsm.mockRejectedValueOnce(new Error('[OSM] the mirror is not answering'));

    await (await configOf()).fetchItems(progress(), []);
    const deps = mockedCollect.mock.calls[0][0];

    // Swallowed, a lost answer says "no OSM object carries this item" for every
    // site in the batch — which refuses precisely the sites the rule exists to
    // admit — on a run whose log said success.
    await expect(
      deps.osm([TROY], { historic: [], manMade: [], boundary: [] }, { phase: vi.fn(), step: vi.fn() }),
    ).rejects.toThrow('not answering');
  });

  describe('which door OpenStreetMap is read through', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it('is the mirror unless the environment says otherwise, and the run log says which', async () => {
      vi.stubEnv('OSM_READER', '');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
      collected([site()]);

      await (await configOf()).fetchItems(progress(), []);

      expect(mockedOsmDoor).toHaveBeenCalledTimes(1);
      expect(mockedOverpassDoor).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        '[Archaeology Sync] OpenStreetMap is read through the QLever osm-planet mirror (qlever)',
      );
      log.mockRestore();
    });

    it('is Overpass when named, behind the same cache, and the run log says so', async () => {
      vi.stubEnv('OSM_READER', 'overpass');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
      collected([site()]);
      const cached = cachedOsmSend();
      const keep = { historic: ['archaeological_site'], manMade: [], boundary: [] };
      const run = { phase: vi.fn(), step: vi.fn() };

      await (await configOf()).fetchItems(progress(), []);
      const deps = mockedCollect.mock.calls[0][0];
      await deps.osm([TROY], keep, run);

      expect(mockedOsmDoor).not.toHaveBeenCalled();
      const door = mockedOverpassDoor.mock.results[0].value as { send: unknown };
      // The same cache kind and the same floor above it: nothing past the door
      // learns which one answered.
      expect(mockedWithCache).toHaveBeenCalledWith(
        door.send, expect.objectContaining({ sourceId: 5, enabled: true }),
      );
      expect(mockedReadOsm).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'overpass', send: cached }), [TROY], keep, run,
      );
      expect(log).toHaveBeenCalledWith(
        '[Archaeology Sync] OpenStreetMap is read through the public Overpass API (overpass)',
      );
      log.mockRestore();
    });

    it('refuses a name that is no door before a single question is sent', async () => {
      vi.stubEnv('OSM_READER', 'overpas');
      mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
      // No `collected(...)` here on purpose: the run must never reach the
      // collector, and a queued once-answer nobody consumed would leak into
      // the next test.

      // A typo read as the default would be a run that failed on the mirror
      // an hour later, in the middle of the outage the operator was working
      // around.
      await expect((await configOf()).fetchItems(progress(), [])).rejects.toThrow(/OSM_READER names no reader/);
      expect(mockedCollect).not.toHaveBeenCalled();
      expect(mockedOsmDoor).not.toHaveBeenCalled();
      expect(mockedOverpassDoor).not.toHaveBeenCalled();
    });
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

  it('measures the finds floor over the museums alone, never over the sites', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    // One museum placing one of the ten offered finds, beside two sites, which
    // hold none: what was dug up at Troy is in a museum somewhere else.
    collected([
      museum({ treasures: [rosetta({ externalId: 'Q1000', name: 'Q1000' })] }),
      site(),
      site({ qid: 'Q43332', label: 'Ephesus' }),
    ]);

    const result = await (await configOf()).fetchItems(progress(), []);

    // The floor is a question about museums and their finds (ADR-0044).
    // Counting the sites would compare what the catalogue offers at the
    // museums against a list of rows with nothing inside them, and read the
    // difference as finds that had left.
    expect(result.withdrawalSkippedReason).toContain('at the 1 museums it admits');
    // And the sites are still written: the proposal is both doors' (ADR-0058).
    expect(result.items).toHaveLength(3);
  });

  it('vouches for a run that placed the finds again', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: STORED });
    collected([museum({ treasures: STORED.map(({ work }) => rosetta({
      externalId: work, name: work,
    })) })]);

    const result = await (await configOf()).fetchItems(progress(), []);

    expect(result.withdrawalSkippedReason).toBeNull();
  });

  it('drops the cached OSM answers when the mirror answered about almost nothing', async () => {
    // The site door fails the run rather than reading an empty answer as "no
    // ruin is mapped here" — and the answers are kept for a day, so a run that
    // did not forget them would fail again tomorrow morning for a reason that
    // had already gone away. Only the `osm` kind: what Wikidata said is still
    // true.
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    mockedClearCache.mockClear();
    mockedCollect.mockRejectedValueOnce(new OsmAnswerFloorError(1126, 3));

    await expect((await configOf()).fetchItems(progress(), []))
      .rejects.toThrow(OsmAnswerFloorError);
    expect(mockedClearCache).toHaveBeenCalledWith(5, 'osm');
  });

  it('drops the cached OSM answers when the enumeration of digs came back empty', async () => {
    // The empty enumeration is cached like any other answer, so without this
    // the site door would re-read the silence and fail again for a day.
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    mockedClearCache.mockClear();
    mockedCollect.mockRejectedValueOnce(new OsmEmptyEnumerationError());

    await expect((await configOf()).fetchItems(progress(), []))
      .rejects.toThrow(OsmEmptyEnumerationError);
    expect(mockedClearCache).toHaveBeenCalledWith(5, 'osm');
  });

  it('keeps the cache when the run fails for any other reason', async () => {
    mockedQuery.mockResolvedValueOnce(lineRow()).mockResolvedValueOnce({ rows: [] });
    mockedClearCache.mockClear();
    mockedCollect.mockRejectedValueOnce(new Error('Sync cancelled'));

    await expect((await configOf()).fetchItems(progress(), [])).rejects.toThrow('Sync cancelled');
    expect(mockedClearCache).not.toHaveBeenCalled();
  });
});

describe('what the archaeology run writes', () => {
  it('writes the museum with its kind, its tags and the run notes about it', async () => {
    wrote();

    await (await afterFetch()).processItem(museum(), progress(), writing());

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

  it('writes the site with the outline OpenStreetMap drew, and what OSM said about it', async () => {
    wrote();

    await (await afterFetch([site()])).processItem(site(), progress(), writing());

    const params = mockedUpsert.mock.calls[0][0];
    expect(params).toMatchObject({
      sourceId: 5,
      externalId: TROY,
      name: 'Troy',
      // The kind's other type, and the word a reader filters by (#814).
      type: 'site',
      tags: ['archaeology', 'site'],
      countryNames: ['Turkey'],
      // Text, as the source answered: PostGIS is where geometry is decided.
      boundaryWkt: 'POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.96,26.23 39.95))',
      // A site enters on its own fame and is admitted for nothing else
      // (ADR-0058 decision 4).
      admittedFor: null,
    });
    // The reading kept whole and separable, the object and the tag beside the
    // verdict, so what the run read off somebody else's map stays nameable
    // (ADR-0059 decision 2).
    expect(params.metadata.osm).toEqual(site().osm);
    expect(params.metadata).toMatchObject({
      wikidataQid: TROY,
      wikidataClasses: ['Q839954'],
      sitelinksCount: 96,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Troy',
    });
    // No finds: what was dug up here is in a museum somewhere else, and a site
    // says so by having nothing to list.
    expect(mockedWriter).not.toHaveBeenCalled();
  });

  it('sends no extent for a site OpenStreetMap maps as a point', async () => {
    wrote();

    await (await afterFetch([site()])).processItem(
      site({ extentWkt: null, osm: { ...site().osm, extentFrom: null } }),
      progress(),
      writing(),
    );

    // Null rather than an empty shape: most sites are a point on the map, and
    // a card printing "0 ha" for one would be stating a measurement nobody made.
    expect(mockedUpsert.mock.calls[0][0].boundaryWkt).toBeNull();
  });

  it('carries a held museum\'s question to its card', async () => {
    wrote();
    const note = 'an antiquities department (category: Egyptological collections in Russia); '
      + 'is the exposition substantially archaeology?';

    await (await afterFetch()).processItem(museum({
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

    await (await afterFetch()).processItem(museum({
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

  it('hands the finds to the shared writer with this source, the run, its line and where each was found', async () => {
    wrote();

    await (await afterFetch()).processItem(museum(), progress(), {
      ...writing(), withdrawalSkippedReason: 'this run placed 1 of the 10 works',
    });

    // The reason and the id travel together: a writer told the id and not the
    // verdict would mark links on a run nothing vouched for (ADR-0044). And the
    // find spot rides on the treasure, which is what lets the card say the
    // Rosetta Stone was found at Fort Julien rather than that it is in London.
    //
    // The finds' line travels with them for a reason of its own: the museum's
    // badge is read at that line, so the find's own flag has to be read at the
    // same one, or the two badges would disagree about the same find (ADR-0023
    // decision 2). The art museums' 22/18 is what the writer falls back to, and
    // this kind's finds are thinner than that (ADR-0058 decision 5).
    expect(mockedWriter).toHaveBeenCalledWith(
      8104,
      [expect.objectContaining({
        externalId: ROSETTA, foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
      })],
      expect.anything(),
      {
        syncLogId: 62,
        withdrawalSkippedReason: 'this run placed 1 of the 10 works',
        sourceId: 5,
        iconicLine: { enterSitelinks: 18, staySitelinks: 15 },
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
  it('is a ranked source that recomputes its membership', async () => {
    const config = await configOf();

    expect(config.sourceId).toBe(5);
    expect(config.sourceCompleteness).toBe('ranked');
    expect(config.recomputesMembership).toBe(true);
    expect(config.getItemName(museum())).toBe('British Museum');
    expect(config.getItemId(museum())).toBe(BRITISH_MUSEUM);
  });

  it('badges every site, for belonging to the kind at all', async () => {
    const badges = (await configOf()).badgesAdmitted as (item: CollectedArchaeologyItem) => boolean;

    // A site is admitted for being one of the world's archaeological sites,
    // which is exactly what the badge says (ADR-0045 decision 5): Pompeii is
    // badged for being Pompeii. The museum door's rule is the one below.
    expect(badges(site())).toBe(true);
  });

  it('badges the museum that holds a famous find, and not the one admitted for what it is', async () => {
    const badges = (await configOf()).badgesAdmitted;
    expect(typeof badges).toBe('function');
    const holdsOne = badges as (item: CollectedArchaeologyMuseum) => boolean;

    // Belonging is not the badge for this kind, as it is for art museums: a
    // museum enters for what it is and never for a find (ADR-0058 decision 2),
    // so the badge marks the one that holds a masterpiece (ADR-0045 decision
    // 5). The British Museum has the Rosetta Stone; the Bardo is in the
    // catalogue on its own 35 articles, holding nothing above the finds' line,
    // and stands in the kind in full standing without a badge.
    expect(holdsOne(museum())).toBe(true);
    expect(holdsOne(museum({
      qid: BARDO, label: 'Bardo National Museum', treasures: [], findsAboveLine: 0,
    }))).toBe(false);
  });
});

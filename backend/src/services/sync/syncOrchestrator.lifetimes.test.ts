/**
 * #1719: a run reads each item's place's lifetime once, before the first item
 * is written, through the source's own door, and hands it to every item; a door
 * that does not answer leaves every record's view as it stands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The end of a run copies the Wikipedia editions from the subset (#2209): a
// statement on the real pool, which a unit spec must never reach.
vi.mock('./wikipediaEditions.js', () => ({ refreshWikipediaEditions: vi.fn().mockResolvedValue(null) }));
vi.mock('./findSiteProposals.js', () => ({ proposeFindSites: vi.fn().mockResolvedValue(null) }));

// Mock sync log utilities — these hit the database
vi.mock('./syncUtils.js', () => ({
  createSyncLog: vi.fn().mockResolvedValue(42),
  updateSyncLog: vi.fn().mockResolvedValue(undefined),
  writeSyncLogProgress: vi.fn().mockResolvedValue(true),
  annotateClosedSyncLog: vi.fn().mockResolvedValue(undefined),
  readUnplacedExperiences: vi.fn().mockResolvedValue({ logIds: [], experienceIds: [] }),
  clearUnplacedExperiences: vi.fn().mockResolvedValue(0),
}));

vi.mock('./changeRecorder.js', () => ({
  recordSyncChanges: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./regionAssignmentService.js', () => ({
  assignRegionsForExperiences: vi.fn().mockResolvedValue(3),
  worldViewsWithGeometry: vi.fn().mockResolvedValue([5]),
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
vi.mock('./admission.js', () => ({
  admissionSweepSkipReason: vi.fn().mockReturnValue(null),
  countAdmitted: vi.fn().mockResolvedValue(0),
  markRefused: vi.fn().mockResolvedValue([]),
  filePutBackTypes: vi.fn().mockResolvedValue([]),
  restoreAdmission: vi.fn().mockResolvedValue([]),
  markIconic: vi.fn().mockResolvedValue([]),
  unmarkIconic: vi.fn().mockResolvedValue([]),
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

// The door and the reader of lifetimes: what each spec here asserts on.
vi.mock('./subset/runDoor.js', () => ({ wikidataRunDoor: vi.fn(async () => vi.fn()) }));
vi.mock('./places/lifetime.js', () => ({ readLifetimes: vi.fn() }));

import { orchestrateSync } from './syncOrchestrator.js';
import { readLifetimes } from './places/lifetime.js';
import { wikidataRunDoor } from './subset/runDoor.js';
import type { SyncRunContext } from './syncContract.js';
import { TEST_SOURCE_ID, makeConfig, processed, resetOrchestratorMocks, restoreOrchestratorTimers } from './syncOrchestrator.fixtures.js';

const BEGAN = { year: -9999, month: null, day: null, span: 'millennium' as const, circa: true, ending: null, property: 'P571', statement: null };

describe('the places\' lifetimes a run reads (#1719)', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

  it('reads them once, by each item\'s item, and hands every item the map', async () => {
    vi.mocked(readLifetimes).mockResolvedValue(new Map([['1', { began: BEGAN }]]));
    const processItem = vi.fn().mockResolvedValue(processed('updated'));
    const gone = vi.fn(() => null);
    await orchestrateSync(makeConfig({
      processItem, lifetimeItem: (item) => (item.id === '1' ? 'Q214944' : null), lifetimeGone: gone,
    }), 1);
    expect(wikidataRunDoor).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wikidataRunDoor).mock.calls[0][0]).toBe(TEST_SOURCE_ID);
    expect(readLifetimes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readLifetimes).mock.calls[0].slice(1)).toEqual([[{ key: '1', qid: 'Q214944' }], gone]);
    const contexts = processItem.mock.calls.map((call) => call[2] as SyncRunContext);
    expect(contexts.map((context) => context.lifetimes?.get('1'))).toEqual([{ began: BEGAN }, { began: BEGAN }]);
  });

  it('empties the view of an item the source found no one item for, and leaves one it read nothing about', async () => {
    // Göbekli Tepe's one item; a serial site of several items; a site Wikidata did not answer for.
    const ITEMS = new Map<string, string | null | undefined>([['1', 'Q214944'], ['2', null], ['3', undefined]]);
    vi.mocked(readLifetimes).mockResolvedValue(new Map([['1', { began: BEGAN }]]));
    const processItem = vi.fn().mockResolvedValue(processed('updated'));
    const fetchItems = vi.fn().mockResolvedValue({
      items: [{ id: '1', name: 'Göbekli Tepe' }, { id: '2', name: 'a serial site' }, { id: '3', name: 'unanswered' }], fetchedCount: 3,
    });
    await orchestrateSync(makeConfig({
      fetchItems, processItem, lifetimeItem: (item) => ITEMS.get(item.id),
    }), 1);
    expect(vi.mocked(readLifetimes).mock.calls[0][1]).toEqual([{ key: '1', qid: 'Q214944' }]);
    const lifetimes = (processItem.mock.calls[0][2] as SyncRunContext).lifetimes;
    expect([lifetimes?.get('1'), lifetimes?.get('2'), lifetimes?.has('3')]).toEqual([{ began: BEGAN }, {}, false]);
  });

  it('reads none for a source that names no item', async () => {
    await orchestrateSync(makeConfig(), 1);
    expect(readLifetimes).not.toHaveBeenCalled();
  });

  it('goes on with no lifetimes where the door does not answer', async () => {
    vi.mocked(readLifetimes).mockRejectedValue(new Error('query service unavailable'));
    const processItem = vi.fn().mockResolvedValue(processed('unchanged'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await orchestrateSync(makeConfig({ processItem, lifetimeItem: () => 'Q214944' }), 1);
    quiet.mockRestore();
    expect(processItem).toHaveBeenCalledTimes(2);
    expect((processItem.mock.calls[0][2] as SyncRunContext).lifetimes?.size).toBe(0);
  });
});

/**
 * Tests for the sync orchestrator.
 *
 * Tests the generic lifecycle management (progress tracking, cancellation,
 * error handling, status determination, changeset recording) in isolation from
 * any database or external API by mocking all callbacks and sync log utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateSync, getSyncStatus, cancelSync, isCancellable, type SyncServiceConfig, type ProcessItemResult } from './syncOrchestrator.js';
import { runningSyncs, type SyncProgress } from './types.js';

// Mock sync log utilities — these hit the database
vi.mock('./syncUtils.js', () => ({
  createSyncLog: vi.fn().mockResolvedValue(42),
  updateSyncLog: vi.fn().mockResolvedValue(undefined),
  annotateClosedSyncLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./changeRecorder.js', () => ({
  recordSyncChanges: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./regionAssignmentService.js', () => ({
  assignRegionsForExperiences: vi.fn().mockResolvedValue(3),
  worldViewsWithGeometry: vi.fn().mockResolvedValue([5]),
}));

vi.mock('./admission.js', () => ({
  admissionSweepSkipReason: vi.fn().mockReturnValue(null),
  countAdmitted: vi.fn().mockResolvedValue(0),
  markRefused: vi.fn().mockResolvedValue([]),
  restoreAdmission: vi.fn().mockResolvedValue([]),
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

import { createSyncLog, updateSyncLog, annotateClosedSyncLog } from './syncUtils.js';
import { recordSyncChanges } from './changeRecorder.js';
import { missingDetectionSkipReason, flagMissingExperiences, countSeenAmongActive } from './missingDetection.js';
import {
  admissionSweepSkipReason, countAdmitted, markRefused, restoreAdmission, markNotAdmitted,
} from './admission.js';
import { assignRegionsForExperiences, worldViewsWithGeometry } from './regionAssignmentService.js';

const TEST_CATEGORY_ID = 999;

interface TestItem {
  id: string;
  name: string;
}

/** A processItem result of the given outcome, with a matching change set. */
function processed(outcome: 'created' | 'updated' | 'unchanged'): ProcessItemResult {
  return {
    outcome,
    experienceId: 501,
    nameSnapshot: 'Item',
    returnedFromMissing: false,
    changeSet: {
      changeType: outcome,
      changedFields: outcome === 'updated'
        ? [{ field: 'shortDescription', old: 'a', new: 'b', significance: 'minor', curatedConflict: false, held: false }]
        : [],
      significance: outcome === 'updated' ? 'minor' : null,
      curatedConflicts: [],
      heldFields: [],
    },
  };
}

const HELD_FIELD = {
  field: 'name', old: 'what a reader sees', new: 'what the source now offers',
  significance: 'major' as const, curatedConflict: false, held: true,
};

/**
 * What a gated run over an already-visible row produces: nothing written, and
 * the proposal carried in the third bucket (#519).
 */
function heldRun(): ProcessItemResult {
  const result = processed('unchanged');
  result.changeSet.heldFields = [HELD_FIELD];
  result.changeSet.significance = 'major';
  return result;
}

function makeProgress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    cancel: false,
    status: 'processing',
    statusMessage: 'Running...',
    progress: 0,
    total: 10,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    held: 0,
    filtered: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun: false,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    categoryId: TEST_CATEGORY_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'authoritative',
    fetchItems: vi.fn().mockResolvedValue({ items: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }], fetchedCount: 2 }),
    processItem: vi.fn().mockResolvedValue(processed('created')),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}

describe('orchestrateSync', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (countAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (markRefused as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (restoreAdmission as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (markNotAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    runningSyncs.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should process all items and report correct counts', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('updated')),
    });

    await orchestrateSync(config, 1);

    expect(config.fetchItems).toHaveBeenCalledOnce();
    expect(config.processItem).toHaveBeenCalledTimes(2);
    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, false);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      expect.objectContaining({ fetched: 2, created: 1, updated: 1, errors: 0 }),
      undefined,
    );
  });

  it('should report partial status when some items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockRejectedValueOnce(new Error('item failed')),
    });

    await orchestrateSync(config, null);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial',
      expect.objectContaining({ fetched: 2, created: 1, updated: 0, errors: 1 }),
      [{ externalId: '2', error: 'item failed' }],
    );
  });

  it('should report failed status when all items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await orchestrateSync(config, null);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'failed',
      expect.objectContaining({ fetched: 2, created: 0, updated: 0, errors: 2 }),
      expect.arrayContaining([
        { externalId: '1', error: 'boom' },
        { externalId: '2', error: 'boom' },
      ]),
    );
  });

  it('should count pre-processing errors from fetchItems in final status', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockImplementation(async (_progress, errorDetails) => {
        // Simulate fetchItems appending pre-processing errors (e.g., museums without coordinates)
        errorDetails.push({ externalId: 'bad-1', error: 'no coordinates' });
        return { items: [{ id: '1', name: 'Item 1' }], fetchedCount: 2 };
      }),
      processItem: vi.fn().mockResolvedValue(processed('created')),
    });

    await orchestrateSync(config, null);

    // Pre-processing error should be reflected in progress.errors and final status
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial', // 1 error + 1 created = partial
      expect.objectContaining({ fetched: 2, created: 1, updated: 0, errors: 1 }),
      [{ externalId: 'bad-1', error: 'no coordinates' }],
    );
  });

  it('should throw when sync is already running', async () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'processing' }));

    const config = makeConfig();
    await expect(orchestrateSync(config, null))
      .rejects.toThrow('sync already in progress');
  });

  it('should allow starting a new sync after previous completed', async () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10 }));

    const config = makeConfig();
    await orchestrateSync(config, null);

    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('empties nothing before it starts, whatever it was asked for', async () => {
    // A run refreshes what the source offers and marks what it withdrew. There
    // is no mode that empties the category first: the visit records and manual
    // region assignments that went with it are the one thing no later run can
    // rebuild. The config no longer has a cleanup hook to call, and this holds
    // the line against one coming back.
    const config = makeConfig();
    await orchestrateSync(config, null, { force: true } as never);

    expect(Object.keys(config)).not.toContain('cleanup');
    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('should handle cancellation during processing', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, progress) => {
        progress.cancel = true; // Simulate cancel on first item
        return processed('created');
      }),
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }],
        fetchedCount: 3,
      }),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow('Sync cancelled');

    // Should have processed only the first item before cancel was detected
    expect(config.processItem).toHaveBeenCalledTimes(1);

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('cancelled');
  });

  it('should propagate fetch errors as sync failures', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockRejectedValue(new Error('API down')),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow('API down');

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('failed');
    expect(status?.statusMessage).toBe('API down');
  });

  it('should clean up runningSyncs after 30s delay', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Progress still exists immediately after sync
    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(true);

    // Advance past the 30s cleanup timer
    vi.advanceTimersByTime(31000);

    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not clean up runningSyncs if a new sync started', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Simulate a new sync starting before cleanup fires
    const newProgress = makeProgress({ status: 'fetching', statusMessage: 'New sync', total: 0 });
    runningSyncs.set(TEST_CATEGORY_ID, newProgress);

    vi.advanceTimersByTime(31000);

    // Old cleanup should NOT have removed the new sync's progress
    expect(runningSyncs.get(TEST_CATEGORY_ID)).toBe(newProgress);
  });
});

describe('orchestrateSync changeset recording', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // Return values, not just call records: `clearAllMocks` leaves an
    // implementation a previous test installed in place, and a stale skip
    // reason silently disables the sweep for every test after it.
    (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (countAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (markRefused as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (restoreAdmission as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (markNotAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    runningSyncs.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('counts unchanged rows separately from updated ones', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('updated'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      expect.objectContaining({ created: 0, updated: 1, unchanged: 1 }),
      undefined,
    );
  });

  it('does not record unchanged rows in the changeset', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('created');
  });

  it('counts a filtered entity apart from errors, leaving the run successful', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'Item 1' }],
        fetchedCount: 2,
        filtered: [{ externalId: 'Q1459037', name: 'Royal Collection', reason: 'not a place' }],
      }),
    });

    await orchestrateSync(config, 1);

    // A collection answering a museum query is the filter working, not the run
    // breaking — status stays clean and the count lands in its own column
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ filtered: 1, errors: 0 }),
      undefined,
    );
  });

  it('keeps filtered entities visible in the changeset', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockResolvedValue({
        items: [],
        fetchedCount: 1,
        filtered: [{ externalId: 'Q1459037', name: 'Royal Collection', reason: 'not a place' }],
      }),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0]).toMatchObject({
      changeType: 'filtered',
      externalId: 'Q1459037',
      nameSnapshot: 'Royal Collection',
      experienceId: null,
    });
  });

  it('refuses the rows a rule turned down, whatever the run\'s coverage was', async () => {
    // Unconditional by design: a coverage floor governs what silence means and
    // has nothing to say about an object the run named (ADR-0024).
    const config = makeConfig({
      fetchItems: vi.fn().mockResolvedValue({
        items: [],
        fetchedCount: 1,
        filtered: [{ externalId: 'Q6373', name: 'British Museum', reason: 'not an art museum' }],
      }),
    });

    await orchestrateSync(config, 1);

    expect(markRefused).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      [{ externalId: 'Q6373', name: 'British Museum', reason: 'not an art museum' }],
      false,
    );
  });

  it('keys the changeset entry to the row the refusal actually moved', async () => {
    (markRefused as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 6205, externalId: 'Q6373', name: 'British Museum' },
    ]);
    const config = makeConfig({
      fetchItems: vi.fn().mockResolvedValue({
        items: [],
        fetchedCount: 1,
        filtered: [{ externalId: 'Q6373', name: 'British Museum', reason: 'not an art museum' }],
      }),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0]).toMatchObject({ changeType: 'filtered', experienceId: 6205 });
  });

  it('does not sweep for a source that fetches a published list', async () => {
    await orchestrateSync(makeConfig(), 1);

    expect(countAdmitted).not.toHaveBeenCalled();
    expect(restoreAdmission).not.toHaveBeenCalled();
    expect(markNotAdmitted).not.toHaveBeenCalled();
  });

  it('lets a run that both filters and admits a venue end with it admitted', async () => {
    // The one ordering that carries weight. A venue can be named in the filtered
    // list and still be one the run admits — a fold cycle used to produce
    // exactly that — and the run's own admission has to be the answer that
    // stands, or the row ends the run hidden until the next one.
    const order: string[] = [];
    (markRefused as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('refuse');
      return [];
    });
    (restoreAdmission as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('restore');
      return [];
    });

    await orchestrateSync(makeConfig({
      recomputesMembership: true,
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'Item 1' }],
        fetchedCount: 1,
        filtered: [{ externalId: '1', name: 'Item 1', reason: 'folded' }],
      }),
    }), 1);

    expect(order).toEqual(['refuse', 'restore']);
    // And restore is asked about the very id that was refused.
    expect(restoreAdmission).toHaveBeenCalledWith(TEST_CATEGORY_ID, ['1'], false);
  });

  it('sweeps against the ids the run actually saw', async () => {
    await orchestrateSync(makeConfig({ recomputesMembership: true }), 1);

    expect(markNotAdmitted).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, ['1', '2'], expect.any(String), false,
    );
  });

  it('still restores, but does not sweep, when a guard refuses', async () => {
    (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue('run had 3 errors');

    await orchestrateSync(makeConfig({ recomputesMembership: true }), 1);

    // Restoring is safe on any run: it can only widen what a reader sees.
    // Sweeping on a broken run empties a catalogue.
    expect(restoreAdmission).toHaveBeenCalled();
    expect(markNotAdmitted).not.toHaveBeenCalled();
  });

  it('counts a swept row as filtered and records it against the row', async () => {
    (markNotAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 6288, externalId: 'Q55685908', name: 'Roman Forum and the Palatine' },
    ]);

    await orchestrateSync(makeConfig({ recomputesMembership: true }), 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const swept = recorded.find((c: { externalId: string }) => c.externalId === 'Q55685908');
    expect(swept).toMatchObject({ changeType: 'filtered', experienceId: 6288 });
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success', expect.objectContaining({ filtered: 1 }), undefined,
    );
  });

  it('records a failed item with its error and no experience id', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0]).toMatchObject({
      changeType: 'failed',
      experienceId: null,
      error: 'No valid coordinates',
    });
  });

  it('counts curated conflicts across the run', async () => {
    const conflicted = processed('unchanged');
    conflicted.changeSet.curatedConflicts = [
      { field: 'name', old: 'ours', new: 'theirs', significance: 'major', curatedConflict: true, held: false },
    ];
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValue(conflicted),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ curatedConflicts: 2 }),
      undefined,
    );
  });

  it('stores the value the source proposed for a curated field', async () => {
    const conflicted = processed('unchanged');
    const conflict = {
      field: 'name', old: 'ours', new: 'theirs', significance: 'major' as const,
      curatedConflict: true, held: false,
    };
    conflicted.changeSet.curatedConflicts = [conflict];
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValue(conflicted),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ changeType: 'conflict' });
    expect(recorded[0].changedFields).toEqual([conflict]);
  });

  it('does not count a row whose change the gate held as updated', async () => {
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(heldRun()) });

    await orchestrateSync(config, 1);

    // `total_updated` counts rows that actually changed, and the hold wrote
    // nothing — a run reporting two updates over two rows it did not touch is
    // the report saying the opposite of what the catalogue holds (#519).
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ updated: 0, unchanged: 2 }),
      undefined,
    );
  });

  it('keeps a held field out of the curated-conflict counter', async () => {
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(heldRun()) });

    await orchestrateSync(config, 1);

    // That counter means "a person had claimed this field". Nobody has looked at
    // a held one, which is the whole difference the two words carry.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ curatedConflicts: 0 }),
      undefined,
    );
  });

  it('counts a held row as held, and still as unchanged', async () => {
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(heldRun()) });

    await orchestrateSync(config, 1);

    // The one number the summary lacked (#523): run 68 held all 1272 UNESCO
    // sites and reported "unchanged 1272", which reads as a run that touched
    // nothing. Held stays inside `unchanged` — nothing about the row moved, and
    // that counter's meaning is already fixed — and is counted again here, per
    // row, where `curatedConflicts` counts per claimed field.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ held: 2, unchanged: 2, updated: 0 }),
      undefined,
    );
  });

  it('keeps a claim-only refusal out of the held counter', async () => {
    const conflicted = processed('unchanged');
    conflicted.changeSet.curatedConflicts = [{
      field: 'shortDescription', old: 'ours', new: 'theirs',
      significance: 'minor' as const, curatedConflict: true, held: false,
    }];
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(conflicted) });

    await orchestrateSync(config, 1);

    // A claim has had its answer — the curator's value won on purpose — so
    // nothing is waiting, and a count of the decisions the run left open must
    // not include it.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ held: 0, curatedConflicts: 2, unchanged: 2 }),
      undefined,
    );
  });

  it('does not count a row the gate wrote pending as held', async () => {
    // No service produces a created result with held fields — an insert writes
    // every column, and `computeChangeSet` returns none for it — but the
    // predicate must not lean on that: a held field on a created row is still
    // a row that landed, and a `wasHeld` that dropped its outcome check would
    // count it. The negative case is the one the guard exists for.
    const createdUnderGate = processed('created');
    createdUnderGate.changeSet.heldFields = [HELD_FIELD];
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(createdUnderGate) });

    await orchestrateSync(config, 1);

    // An arrival under a gate lands unread rather than refused: `created`
    // already reports it and the queue raises an `arrival` card for it.
    // Counting it here too would report the run's news twice.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ created: 2, held: 0 }),
      undefined,
    );
  });

  it('reports exactly as many held as it records held rows', async () => {
    const conflicted = processed('unchanged');
    conflicted.changeSet.curatedConflicts = [{
      field: 'shortDescription', old: 'ours', new: 'theirs',
      significance: 'minor' as const, curatedConflict: true, held: false,
    }];
    const gained = processed('unchanged');
    gained.contents = {
      locations: { added: [{ name: 'Waldsiedlung Zehlendorf', ref: '1239-006' }], withdrawn: [], returned: [], changed: [] },
    };
    const config = makeConfig({
      fetchItems: vi.fn().mockResolvedValue({
        items: ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, name: `Item ${id}` })),
        fetchedCount: 6,
      }),
      processItem: vi.fn()
        .mockResolvedValueOnce(heldRun())
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(conflicted)
        .mockResolvedValueOnce(gained)
        .mockResolvedValueOnce(processed('updated'))
        .mockResolvedValueOnce(heldRun()),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const heldRows = recorded.filter((c: { changeType: string }) => c.changeType === 'held').length;
    // Migration 038 fills the counter for the runs that predate it from the
    // rows they recorded, so the number and the rows have to be one decision:
    // the increment and the row's word come from the same predicate.
    expect(heldRows).toBe(2);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ held: heldRows, unchanged: 4, created: 1, updated: 1 }),
      undefined,
    );
  });

  it('carries the held count onto a run that was then cancelled', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, progress) => {
        progress.cancel = true;
        return heldRun();
      }),
    });

    await expect(orchestrateSync(config, 1)).rejects.toThrow('Sync cancelled');

    // The failure path writes its own stats, and a proposal the run held before
    // it stopped is still waiting on somebody.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'cancelled',
      expect.objectContaining({ held: 1, unchanged: 1 }),
      expect.anything(),
    );
  });

  it('records a held row as held, so its card is not read as a decision taken', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(heldRun()).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Stored at all — an unchanged row is normally only counted, and dropping
    // this one would leave the proposal nowhere and the curator's card empty.
    expect(recorded).toHaveLength(1);
    // `conflict` is the word for a value a person claimed on purpose, with
    // nothing waiting. A verdict *is* waiting here, and the row has to say so.
    expect(recorded[0].changeType).toBe('held');
    expect(recorded[0].changedFields).toEqual([HELD_FIELD]);
  });

  it('labels a row carrying both a claim and a hold as held', async () => {
    const both = heldRun();
    const conflict = {
      field: 'shortDescription', old: 'ours', new: 'theirs',
      significance: 'minor' as const, curatedConflict: true, held: false,
    };
    both.changeSet.curatedConflicts = [conflict];
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // `conflict` would be false of the held half: the claim has had its answer,
    // the hold has not, and the unanswered part is what the row is for.
    expect(recorded[0].changeType).toBe('held');
    // Both refusals travel, each carrying its own reason, or publishing and
    // `accept-source` would each be missing the half they answer.
    expect(recorded[0].changedFields).toEqual([conflict, HELD_FIELD]);
  });

  it('labels a row carrying both a hold and a return as held, not returned', async () => {
    const both = heldRun();
    both.returnedFromMissing = true;
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // `returned` would be true of this row too, but the hold is the half nobody
    // has answered, and it is the half the admin report's `?type=held` filter
    // exists to find — a row read as `returned` instead never turns up there.
    expect(recorded[0].changeType).toBe('held');
    expect(recorded[0].changedFields).toEqual([HELD_FIELD]);
  });

  it('records a row whose only change is what it holds', async () => {
    const gained = processed('unchanged');
    gained.contents = {
      locations: { added: [{ name: 'Waldsiedlung Zehlendorf', ref: '1239-006' }], withdrawn: [], returned: [], changed: [] },
    };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(gained).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The defect ADR-0026 exists to fix: an object every field of which came
    // through unchanged, whose set of points moved, produced no row at all — so
    // a serial site gaining a component was recorded nowhere, not merely
    // rendered nowhere.
    expect(recorded).toHaveLength(1);
    expect(recorded[0].contents.locations.added[0].name).toBe('Waldsiedlung Zehlendorf');
    // Its own word, because the alternative was the catch-all `conflict` — which
    // means a curator had claimed a field and the source's proposal lost, and the
    // admin report's `?type=conflict` filter would hand this back as one.
    expect(recorded[0].changeType).toBe('contents');
  });

  it('counts a row whose only hold is a field of a part as held, and files it so', async () => {
    // The Wine Glass's attribution, held on a visible work under a gated museum
    // (ADR-0037): every field of the museum's own came through, and what a
    // curator is being asked about lives one level down.
    const heldPart = processed('unchanged');
    heldPart.contents = {
      treasures: {
        added: [], withdrawn: [], returned: [],
        changed: [{
          item: { name: 'The Wine Glass', ref: 'Q12418' },
          fields: [{
            field: 'artist', old: 'Johannes Vermeer', new: 'Jan Vermeer van Haarlem the Elder',
            significance: 'major', curatedConflict: false, held: true,
          }],
        }],
      },
    };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(heldPart).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    // `total_held` is "rows a reader can already see the run proposed a change
    // to and the gate kept whole" — which this row is, whichever level the
    // proposal sits at. And the row files as `held` rather than `contents`,
    // because the held half is the one nobody has answered, and the admin
    // report's `?type=held` filter is where a curator would look for it.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ held: 1, unchanged: 2, updated: 0 }),
      undefined,
    );
    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('held');
    expect(recorded[0].contents.treasures.changed[0].fields[0].held).toBe(true);
  });

  it('calls a row with both a claim and a contents move a conflict, not a contents row', async () => {
    const both = processed('unchanged');
    both.changeSet.curatedConflicts = [
      { field: 'name', old: 'ours', new: 'theirs', significance: 'major', curatedConflict: true, held: false },
    ];
    both.contents = { locations: { added: [{ name: 'A new part', ref: '1239-008' }], withdrawn: [], returned: [], changed: [] } };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The claim is the half a curator has to answer; the delta raises no question and
    // travels in its own column either way. So the unanswered thing names the row.
    expect(recorded[0].changeType).toBe('conflict');
    expect(recorded[0].contents.locations.added[0].ref).toBe('1239-008');
  });

  it('calls a row that returned and gained a part returned, not a contents row', async () => {
    const both = processed('unchanged');
    both.returnedFromMissing = true;
    both.contents = { treasures: { added: [{ name: 'The Night Watch', ref: 'Q219831' }], withdrawn: [], returned: [], changed: [] } };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // An object back in the source's list is the larger fact about the object, and it
    // is the one a reader of the report goes looking for by type.
    expect(recorded[0].changeType).toBe('returned');
  });

  it('leaves an unchanged row unrecorded when its contents did not move either', async () => {
    const quiet = processed('unchanged');
    quiet.contents = { locations: { added: [], withdrawn: [], returned: [] , changed: [] } };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(quiet).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    // A writer reports an empty delta on every quiet object, and there are 1235
    // of those in a UNESCO run. Storing them would be the noise ADR-0020
    // rejected, wearing a new field's clothes.
    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toEqual([]);
  });

  it('counts a contents-only change as unchanged, because nothing about the row changed', async () => {
    const gained = processed('unchanged');
    gained.contents = { treasures: { added: [{ name: 'The Night Watch', ref: 'Q219831' }], withdrawn: [], returned: [], changed: [] } };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(gained).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    // `total_updated` counts rows that actually changed, and this one did not —
    // the museum did. Same rule a held row follows (#519): stored, not counted.
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ updated: 0, unchanged: 2 }),
      undefined,
    );
  });

  it('carries the contents delta on a row it was already recording', async () => {
    const changed = processed('updated');
    changed.contents = {
      locations: { added: [], withdrawn: [{ name: 'Bilbao Fine Arts Museum', ref: 'Q127064' }], returned: [], changed: [] },
    };
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(changed).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The two facts are independent: a run can rewrite a description and drop a
    // point in the same pass, and reading one off the other's presence would
    // lose whichever came second.
    expect(recorded[0].changeType).toBe('updated');
    expect(recorded[0].contents.locations.withdrawn[0].ref).toBe('Q127064');
  });

  it('records a return even when the row came back byte-identical', async () => {
    const returned = processed('unchanged');
    returned.returnedFromMissing = true;
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(returned).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('returned');
  });

  it('reports a row the source produced again as returned', async () => {
    const returned = processed('updated');
    returned.returnedFromMissing = true;
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValueOnce(returned).mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0].changeType).toBe('returned');
  });

  it('measures coverage against the rows that were there, not the ids offered', async () => {
    await orchestrateSync(makeConfig(), 1);

    // Counting the offered ids would fold in rows this run created, which only
    // ever lifts the ratio past the floor
    expect(countSeenAmongActive).toHaveBeenCalledWith(TEST_CATEGORY_ID, ['1', '2']);
  });

  it('measures coverage on every run, since none of them empties the category', async () => {
    // The exemption existed because a force run deleted the category first, so
    // the count would be zero against a pre-deletion denominator. Nothing
    // deletes now, and a run that skipped the floor could conclude that
    // everything it failed to fetch had been delisted.
    await orchestrateSync(makeConfig(), 1, { force: true } as never);

    expect(countSeenAmongActive).toHaveBeenCalledWith(TEST_CATEGORY_ID, ['1', '2']);
  });

  it('measures coverage before the run writes anything', async () => {
    const order: string[] = [];
    (countSeenAmongActive as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push('count');
      return 2;
    });
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async () => {
        order.push('process');
        return processed('created');
      }),
    });

    await orchestrateSync(config, 1);

    // Counted afterwards, a created row and a row whose missing_since the run
    // just cleared both land in the numerator while the denominator never had
    // them
    expect(order[0]).toBe('count');
  });

  it('decides missing from the ids the run saw, not from the log stamp', async () => {
    await orchestrateSync(makeConfig(), 1, { dryRun: true });

    expect(flagMissingExperiences).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, true, ['1', '2'],
    );
  });

  it('counts an item the source offered but processing dropped as seen', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockRejectedValueOnce(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    // Both ids reach the detector: the source listed them, so neither is missing
    expect(flagMissingExperiences).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, false, ['1', '2'],
    );
  });

  it('does not insert the changeset twice when closing the log throws', async () => {
    (updateSyncLog as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('deadlock'));

    await expect(orchestrateSync(makeConfig(), 1)).rejects.toThrow('deadlock');

    // The failure path runs too, but must not write rows the success path
    // already inserted
    expect(recordSyncChanges).toHaveBeenCalledTimes(1);
  });

  it('marks a lost changeset on the failure path too, not only on the success path', async () => {
    (recordSyncChanges as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('value too long'));
    const config = makeConfig({
      fetchItems: vi.fn().mockRejectedValue(new Error('API down')),
    });

    await expect(orchestrateSync(config, 1)).rejects.toThrow('API down');

    // The run card tells a lost record apart from a pre-provenance run by this
    // marker; without it on this path, a failed run is labelled as ancient
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'failed', expect.anything(),
      expect.arrayContaining([expect.objectContaining({ externalId: 'changeset' })]),
    );
  });

  it('closes the log even when the changeset insert fails, and does not call it a success', async () => {
    (recordSyncChanges as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('value too long'));

    await orchestrateSync(makeConfig(), 1);

    // A run whose per-object record never landed is not a clean run
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'partial', expect.objectContaining({ errors: 1 }),
      expect.arrayContaining([
        expect.objectContaining({ externalId: 'changeset' }),
      ]),
    );
  });

  it('flags missing objects when the guards allow it', async () => {
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      syncLogId: 42, experienceId: 77, externalId: '1234', nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing', changedFields: null, significance: null, error: null,
    }]);

    await orchestrateSync(makeConfig(), 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ missing: 1 }),
      undefined,
    );
  });

  it('skips missing detection and records why', async () => {
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValueOnce('source is ranked');

    await orchestrateSync(makeConfig(), 1);

    expect(flagMissingExperiences).not.toHaveBeenCalled();
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ detectionSkippedReason: 'source is ranked' }),
      undefined,
    );
  });

  it('marks the log as a dry run and tells processItem', async () => {
    const config = makeConfig();

    await orchestrateSync(config, 1, { dryRun: true });

    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, true);
    expect(config.processItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true, syncLogId: 42 }),
    );
  });

  it('previews anything it can run, now that no mode deletes first', async () => {
    // The refusal was about force deleting the category before there was
    // anything to preview. With nothing deleted there is nothing to refuse.
    await orchestrateSync(makeConfig(), 1, { force: true, dryRun: true } as never);

    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, true);
  });

  it('puts the run into the failed state, not just a failed message', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await orchestrateSync(config, 1);

    // The UI reads `status`; leaving it 'complete' over a failed verdict is the
    // one case where state and verdict genuinely disagree
    expect(runningSyncs.get(TEST_CATEGORY_ID)?.status).toBe('failed');
  });

  it('calls a run partial, not failed, when everything was already current', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('unchanged'))
        .mockRejectedValueOnce(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'partial',
      expect.objectContaining({ unchanged: 1, errors: 1 }),
      expect.anything(),
    );
  });
});

describe('getSyncStatus', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return null when no sync exists', () => {
    expect(getSyncStatus(TEST_CATEGORY_ID)).toBeNull();
  });

  it('should return progress when sync exists', () => {
    const progress = makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 });
    runningSyncs.set(TEST_CATEGORY_ID, progress);

    expect(getSyncStatus(TEST_CATEGORY_ID)).toBe(progress);
  });
});

describe('cancelSync', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return false when no sync exists', () => {
    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should cancel a running sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(true);

    const progress = runningSyncs.get(TEST_CATEGORY_ID);
    expect(progress?.cancel).toBe(true);
    expect(progress?.statusMessage).toBe('Cancelling...');
  });

  it('should not cancel an already-complete sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10, logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not cancel a failed sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'failed', statusMessage: 'Error', total: 0, errors: 1, logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });
});

describe('placing what moved', () => {
  beforeEach(() => {
    // Reset, not clear. `mockClear` keeps the implementation, so a
    // `mockRejectedValue` installed by one test survives into every later one —
    // and a test asserting only call arguments then passes against a mock that
    // never resolves, which is how a failing placement can look like a working
    // one.
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(3);
    (worldViewsWithGeometry as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([5]);
    (annotateClosedSyncLog as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
    runningSyncs.delete(TEST_CATEGORY_ID);
  });

  it('places the experiences whose locations moved, once per world view', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockImplementationOnce(async (_i, _p, ctx) => {
          ctx.onLocationsChanged(11);
          return { ...processed('created'), experienceId: 11 };
        })
        .mockResolvedValueOnce({ ...processed('unchanged'), experienceId: 12 }),
    });

    await orchestrateSync(config, null);

    // Only the one that moved. The other's assignments are still correct, and
    // recomputing them is the churn this whole change removes.
    expect(assignRegionsForExperiences).toHaveBeenCalledWith([11], 5);
  });

  it('leaves assignments alone when nothing moved', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValue(processed('unchanged')),
    });

    await orchestrateSync(config, null);

    // Not merely "assigned nothing" — it must not even ask which world views
    // exist, since an ordinary run is expected to reach this with an empty set.
    expect(worldViewsWithGeometry).not.toHaveBeenCalled();
    expect(assignRegionsForExperiences).not.toHaveBeenCalled();
  });

  it('places nothing on a preview', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_i, _p, ctx) => {
        ctx.onLocationsChanged(11);
        return { ...processed('created'), experienceId: 11 };
      }),
    });

    await orchestrateSync(config, null, { dryRun: true });

    // A dry run writes no locations, so there is nothing placed either — and
    // placing would be a write, which is the one thing a preview promises not
    // to do.
    expect(assignRegionsForExperiences).not.toHaveBeenCalled();
  });

  it('places what a cancelled run already moved', async () => {
    // A cancel is a button, not a rare fault, and a run stopped halfway has
    // already written the points it got to. Leaving those unplaced puts real
    // objects in the wrong region, or nowhere, until someone notices.
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, progress, ctx) => {
        ctx.onLocationsChanged(11);
        progress.cancel = true;
        return { ...processed('updated'), experienceId: 11 };
      }),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow();

    expect(assignRegionsForExperiences).toHaveBeenCalledWith([11], 5);
  });

  it('records a placement failure in the log, so an operator can see it', async () => {
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('geometry exploded'));
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_i, _p, ctx) => {
        ctx.onLocationsChanged(11);
        return { ...processed('created'), experienceId: 11 };
      }),
    });

    await orchestrateSync(config, null);

    // The log is already closed as a success by this point. Left on the console
    // only, an operator would have no way to know that experience_regions is
    // stale for what this run moved, or that a full re-assignment fixes it.
    const note = (annotateClosedSyncLog as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(note?.[2]).toBe('partial');
    expect(JSON.stringify(note?.[3])).toContain('region-assignment');
  });

  it('keeps a cancelled run cancelled, even when placement then fails', async () => {
    // `recordSyncFailure` writes `cancelled` for a stopped run, and that is a
    // fact of its own: the history panel renders it as its own chip, and it
    // survives nowhere else in the row. Overwriting it with `partial` would
    // lose that an operator stopped this run.
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('geometry exploded'));
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, progress, ctx) => {
        ctx.onLocationsChanged(11);
        progress.cancel = true;
        return { ...processed('updated'), experienceId: 11 };
      }),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow();

    const note = (annotateClosedSyncLog as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(note?.[2]).toBe('cancelled');
    expect(JSON.stringify(note?.[3])).toContain('region-assignment');
  });

  it('does not let a failed assignment fail the run', async () => {
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('geometry exploded'));
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_i, _p, ctx) => {
        ctx.onLocationsChanged(11);
        return { ...processed('created'), experienceId: 11 };
      }),
    });

    await expect(orchestrateSync(config, null)).resolves.toBeUndefined();

    // The log is already closed by this point. Throwing here would leave the
    // run reported as still running, which is the failure mode recording the
    // changeset was hardened against for the same reason.
    expect(updateSyncLog).toHaveBeenCalled();
  });
});

describe('registering a location write', () => {
  beforeEach(() => {
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(3);
    (annotateClosedSyncLog as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
    runningSyncs.delete(TEST_CATEGORY_ID);
  });

  it('keeps what an item wrote even when that item then throws', async () => {
    // The museum service upserts treasures *after* moving the point, and that
    // can throw. Carried back on the result, the id would be lost with the
    // throw while the point had already moved on disk — leaving a stale `auto`
    // row naming the region it left, and nothing to signal it.
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, _progress, ctx) => {
        ctx.onLocationsChanged(11);
        throw new Error('treasures blew up');
      }),
    });

    await orchestrateSync(config, null);

    expect(assignRegionsForExperiences).toHaveBeenCalledWith([11], 5);
  });
});

describe('isCancellable', () => {
  const at = (status: SyncProgress['status'], progress: number, total: number) =>
    makeProgress({ status, progress, total });

  it('accepts while items are still being fetched', () => {
    expect(isCancellable(at('fetching', 0, 0))).toBe(true);
  });

  it('accepts while items remain to process', () => {
    expect(isCancellable(at('processing', 3, 10))).toBe(true);
  });

  it('refuses once the last item is done', () => {
    // Nothing reads `progress.cancel` past this point — detection, changeset
    // recording, log closure and placement all ignore it — so accepting would
    // report a cancellation that does not happen and let the run finish as a
    // success.
    expect(isCancellable(at('processing', 10, 10))).toBe(false);
  });

  it('refuses while regions are being assigned', () => {
    expect(isCancellable(at('assigning', 10, 10))).toBe(false);
  });

  it('refuses a run that has already ended', () => {
    for (const status of ['complete', 'partial', 'failed', 'cancelled'] as const) {
      expect(isCancellable(at(status, 10, 10))).toBe(false);
    }
  });
});

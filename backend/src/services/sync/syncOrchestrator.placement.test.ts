/**
 * Placing what a run moved, at the end of the run.
 *
 * A sync places the experiences whose locations it inserted, moved or dropped,
 * in every world view that has geometry, after the log is closed — and reports
 * rather than throws when that fails, so a run is never left reported as
 * running over a stale `experience_regions`. These pin what the orchestrator
 * owes that phase: which objects, once per world view, however the run ended,
 * and what the log and the panel are told through it.
 *
 * Its own file beside `syncOrchestrator.test.ts`, which is at the line limit;
 * the mocks are the same ones, restated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  orchestrateSync, type SyncServiceConfig, type ProcessItemResult,
} from './syncOrchestrator.js';
import { runningSyncs } from './types.js';

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
  markIconic: vi.fn().mockResolvedValue([]),
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

import { updateSyncLog, annotateClosedSyncLog } from './syncUtils.js';
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

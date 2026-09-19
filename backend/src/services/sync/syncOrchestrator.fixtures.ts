/**
 * What every test of the orchestrator drives a run with: a source id, the three
 * item outcomes as `processItem` returns them, a held run, a progress row and a
 * service config — and the state each case starts from.
 *
 * The five files this module serves — `syncOrchestrator.test.ts` and its `.log`,
 * `.changeset`, `.held` and `.sweep` siblings — each install their own `vi.mock`
 * of the five modules a run talks to (`publishController.fixtures.ts` works the
 * same way); this module reads those mocks back, so one reset serves them all.
 * Three further `syncOrchestrator*.test.ts` files (`.placement`, `.withdrawal`,
 * `.refusedContents`) mock the same modules but keep builders of their own.
 */

import { vi } from 'vitest';
import type { SyncServiceConfig, ProcessItemResult } from './syncOrchestrator.js';
import { runningSyncs, type SyncProgress } from './types.js';
import {
  missingDetectionSkipReason, flagMissingExperiences, countActiveExperiences,
  countSeenAmongActive,
} from './missingDetection.js';
import {
  admissionSweepSkipReason, countAdmitted, markRefused, restoreAdmission, markNotAdmitted,
  markIconic, unmarkIconic,
} from './admission.js';

export const TEST_SOURCE_ID = 999;

export interface TestItem {
  id: string;
  name: string;
}

/** A processItem result of the given outcome, with a matching change set. */
export function processed(outcome: 'created' | 'updated' | 'unchanged'): ProcessItemResult {
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

export const HELD_FIELD = {
  field: 'name', old: 'what a reader sees', new: 'what the source now offers',
  significance: 'major' as const, curatedConflict: false, held: true,
};

/**
 * What a gated run over an already-visible row produces: nothing written, and
 * the proposal carried in the third bucket (#519).
 */
export function heldRun(): ProcessItemResult {
  const result = processed('unchanged');
  result.changeSet.heldFields = [HELD_FIELD];
  result.changeSet.significance = 'major';
  return result;
}

export function makeProgress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    cancel: false,
    kind: 'sync',
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

export function makeConfig(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    sourceId: TEST_SOURCE_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'authoritative',
    fetchItems: vi.fn().mockResolvedValue({ items: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }], fetchedCount: 2 }),
    processItem: vi.fn().mockResolvedValue(processed('created')),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}

/**
 * The state every case starts from: an empty registry, no calls on record, and
 * fake timers.
 *
 * Return values, not just call records: `clearAllMocks` leaves an
 * implementation a previous test installed in place, and a stale skip
 * reason silently disables the sweep for every test after it.
 */
export function resetOrchestratorMocks(): void {
  runningSyncs.clear();
  vi.clearAllMocks();
  (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
  (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
  (countAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (markRefused as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (restoreAdmission as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (markNotAdmitted as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (markIconic as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (unmarkIconic as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (countActiveExperiences as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (countSeenAmongActive as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  vi.useFakeTimers();
}

/** What every case leaves behind: no registry, no timers, real time again. */
export function restoreOrchestratorTimers(): void {
  runningSyncs.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
}

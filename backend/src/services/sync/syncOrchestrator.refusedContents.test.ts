/**
 * The objects an admitted row holds that a kind's rule turned down (#890).
 *
 * The venue-side read refuses a film in an art museum's collection, a conclave
 * a cathedral's `P276` names, a meteorite in an archaeology museum's case. Two
 * things have to follow, and neither is the collector's to do: the refusal
 * reaches the run's changeset as a `filtered` row, so a person reads its
 * classes; and nothing is marked for it — `filtered` is matched against the
 * source's own rows by external id, and an object is not a row of the source.
 * And an entity both lists name — a chapel the fame door refused that an
 * admitted basilica's `P276` names — is one row and one count, the row's
 * refusal standing.
 *
 * Its own file beside `syncOrchestrator.test.ts`, which is at the line limit;
 * the mocks are the same ones, restated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  orchestrateSync, type SyncServiceConfig, type ProcessItemResult, type FetchResult,
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
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

import { updateSyncLog } from './syncUtils.js';
import { recordSyncChanges } from './changeRecorder.js';
import { markRefused } from './admission.js';

const TEST_SOURCE_ID = 999;

interface TestItem {
  id: string;
  name: string;
}

function created(): ProcessItemResult {
  return {
    outcome: 'created',
    experienceId: 501,
    nameSnapshot: 'Item',
    returnedFromMissing: false,
    changeSet: {
      changeType: 'created', changedFields: [], significance: null,
      curatedConflicts: [], heldFields: [],
    },
  };
}

function runWith(fetched: FetchResult<TestItem>): SyncServiceConfig<TestItem> {
  return {
    sourceId: TEST_SOURCE_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'ranked',
    fetchItems: vi.fn().mockResolvedValue(fetched),
    processItem: vi.fn().mockResolvedValue(created()),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
  };
}

const recorded = (): { externalId: string; error: string | null }[] =>
  (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];

describe('an object a row holds that the rule refused', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
  });

  it('is reported as a filtered row, and marks nothing', async () => {
    await orchestrateSync(runWith({
      items: [{ id: '1', name: 'Item 1' }],
      fetchedCount: 2,
      refusedContents: [{
        externalId: 'Q900950', name: 'Film in the Collection',
        reason: 'not a work of art by its classes: film (Q11424) — held by Louvre Museum',
      }],
    }), 1);

    expect(markRefused).toHaveBeenCalledWith(TEST_SOURCE_ID, [], false);
    expect(recorded().find((r) => r.externalId === 'Q900950')).toMatchObject({
      changeType: 'filtered',
      nameSnapshot: 'Film in the Collection',
      experienceId: null,
      error: 'not a work of art by its classes: film (Q11424) — held by Louvre Museum',
    });
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'success',
      expect.objectContaining({ filtered: 1, errors: 0 }),
      undefined,
    );
  });

  it('is named once when both lists carry it, and the row it names is still marked', async () => {
    const chapel = { externalId: 'Q900001', name: 'Chapel', reason: '17 sitelinks: below the line' };
    await orchestrateSync(runWith({
      items: [],
      fetchedCount: 2,
      filtered: [chapel],
      refusedContents: [
        { externalId: 'Q900001', name: 'Chapel', reason: 'not a treasure by its classes: chapel — held by Basilica' },
        { externalId: 'Q900002', name: 'Conclave', reason: 'not a treasure by its classes: conclave — held by Basilica' },
      ],
    }), 1);

    expect(markRefused).toHaveBeenCalledWith(TEST_SOURCE_ID, [chapel], false);
    const rows = recorded();
    const named = rows.filter((r) => r.externalId === 'Q900001');
    expect(named).toHaveLength(1);
    expect(named[0].error).toBe('17 sitelinks: below the line');
    expect(rows.filter((r) => r.externalId === 'Q900002')).toHaveLength(1);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'success',
      expect.objectContaining({ filtered: 2 }),
      undefined,
    );
  });
});

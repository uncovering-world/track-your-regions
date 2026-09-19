/**
 * Tests for the log a run writes and the state it ends in: the counts it
 * reports, the status it settles on when items fail or nothing changed, a dry
 * run that writes nothing, and a changeset that is neither lost nor inserted
 * twice when closing the log throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { orchestrateSync } from './syncOrchestrator.js';
import { runningSyncs } from './types.js';
import { createSyncLog, updateSyncLog } from './syncUtils.js';
import { recordSyncChanges } from './changeRecorder.js';
import {
  TEST_SOURCE_ID, processed, makeConfig, resetOrchestratorMocks, restoreOrchestratorTimers,
} from './syncOrchestrator.fixtures.js';

describe('orchestrateSync', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

  it('should process all items and report correct counts', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('updated')),
    });

    await orchestrateSync(config, 1);

    expect(config.fetchItems).toHaveBeenCalledOnce();
    expect(config.processItem).toHaveBeenCalledTimes(2);
    expect(createSyncLog).toHaveBeenCalledWith(TEST_SOURCE_ID, 1, false);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID,
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
      TEST_SOURCE_ID,
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
      TEST_SOURCE_ID,
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
      TEST_SOURCE_ID,
      42,
      'partial', // 1 error + 1 created = partial
      expect.objectContaining({ fetched: 2, created: 1, updated: 0, errors: 1 }),
      [{ externalId: 'bad-1', error: 'no coordinates' }],
    );
  });
});

describe('orchestrateSync changeset recording', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

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
      TEST_SOURCE_ID, 42, 'failed', expect.anything(),
      expect.arrayContaining([expect.objectContaining({ externalId: 'changeset' })]),
    );
  });

  it('closes the log even when the changeset insert fails, and does not call it a success', async () => {
    (recordSyncChanges as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('value too long'));

    await orchestrateSync(makeConfig(), 1);

    // A run whose per-object record never landed is not a clean run
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'partial', expect.objectContaining({ errors: 1 }),
      expect.arrayContaining([
        expect.objectContaining({ externalId: 'changeset' }),
      ]),
    );
  });

  it('marks the log as a dry run and tells processItem', async () => {
    const config = makeConfig();

    await orchestrateSync(config, 1, { dryRun: true });

    expect(createSyncLog).toHaveBeenCalledWith(TEST_SOURCE_ID, 1, true);
    expect(config.processItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true, syncLogId: 42 }),
    );
  });

  it('previews anything it can run, now that no mode deletes first', async () => {
    // The refusal was about force deleting the source before there was
    // anything to preview. With nothing deleted there is nothing to refuse.
    await orchestrateSync(makeConfig(), 1, { force: true, dryRun: true } as never);

    expect(createSyncLog).toHaveBeenCalledWith(TEST_SOURCE_ID, 1, true);
  });

  it('puts the run into the failed state, not just a failed message', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await orchestrateSync(config, 1);

    // The UI reads `status`; leaving it 'complete' over a failed verdict is the
    // one case where state and verdict genuinely disagree
    expect(runningSyncs.get(TEST_SOURCE_ID)?.status).toBe('failed');
  });

  it('calls a run partial, not failed, when everything was already current', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('unchanged'))
        .mockRejectedValueOnce(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'partial',
      expect.objectContaining({ unchanged: 1, errors: 1 }),
      expect.anything(),
    );
  });
});

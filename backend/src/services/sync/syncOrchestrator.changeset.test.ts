/**
 * Tests for what the changeset records of a run: the rows it counts and the
 * rows it leaves out, a failed item, a curated conflict and the value the
 * source proposed for it, and what a row is called when only its contents
 * moved or it came back from missing.
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
import { updateSyncLog } from './syncUtils.js';
import { recordSyncChanges } from './changeRecorder.js';
import {
  TEST_SOURCE_ID, processed, makeConfig, resetOrchestratorMocks, restoreOrchestratorTimers,
} from './syncOrchestrator.fixtures.js';

describe('orchestrateSync changeset recording', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

  it('counts unchanged rows separately from updated ones', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('updated'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID,
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
});

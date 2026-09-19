/**
 * Tests for the gate, as the record has to show it (#519): a held change is
 * not an update, it is not a curated conflict, the row is still unchanged, and
 * the card it produces must not read as a decision already taken.
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
  TEST_SOURCE_ID, processed, HELD_FIELD, heldRun, makeConfig, resetOrchestratorMocks,
  restoreOrchestratorTimers,
} from './syncOrchestrator.fixtures.js';

describe('orchestrateSync changeset recording', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

  it('does not count a row whose change the gate held as updated', async () => {
    const config = makeConfig({ processItem: vi.fn().mockResolvedValue(heldRun()) });

    await orchestrateSync(config, 1);

    // `total_updated` counts rows that actually changed, and the hold wrote
    // nothing — a run reporting two updates over two rows it did not touch is
    // the report saying the opposite of what the catalogue holds (#519).
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID, 42, 'cancelled',
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
      TEST_SOURCE_ID, 42, 'success',
      expect.objectContaining({ held: 1, unchanged: 2, updated: 0 }),
      undefined,
    );
    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('held');
    expect(recorded[0].contents.treasures.changed[0].fields[0].held).toBe(true);
  });
});

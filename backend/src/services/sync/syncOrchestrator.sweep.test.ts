/**
 * Tests for what a run may conclude about rows it did not see: the coverage it
 * measures before writing anything, the rows a rule refuses or a sweep takes
 * out, the badges it sets and takes back, and the objects it flags missing —
 * each with the guard that stops it concluding from too little.
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
  missingDetectionSkipReason, flagMissingExperiences, countSeenAmongActive,
} from './missingDetection.js';
import {
  admissionSweepSkipReason, countAdmitted, markRefused, restoreAdmission, markIconic,
  unmarkIconic, markNotAdmitted,
} from './admission.js';
import {
  TEST_SOURCE_ID, processed, makeConfig, resetOrchestratorMocks, restoreOrchestratorTimers,
} from './syncOrchestrator.fixtures.js';

describe('orchestrateSync changeset recording', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

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
      TEST_SOURCE_ID, 42, 'success',
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
      TEST_SOURCE_ID,
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

  it('does not sweep, restore or badge for a source that fetches a published list', async () => {
    await orchestrateSync(makeConfig(), 1);

    expect(countAdmitted).not.toHaveBeenCalled();
    expect(restoreAdmission).not.toHaveBeenCalled();
    expect(markIconic).not.toHaveBeenCalled();
    expect(markNotAdmitted).not.toHaveBeenCalled();
  });

  it('lets a run that both filters and admits a venue end with it admitted, and badged', async () => {
    // The orderings that carry weight. A venue can be named in the filtered
    // list and still be one the run admits — a fold cycle produces exactly
    // that — and the run's own admission has to be the answer that
    // stands, or the row ends the run hidden until the next one. And the badge
    // is written where admission is a settled answer (#760): after the whole
    // admission step, so a refusal this run lifted is admitted by the time it
    // is asked and one a curator confirmed is not.
    const order: string[] = [];
    for (const [name, fn] of [
      ['refuse', markRefused], ['restore', restoreAdmission],
      ['sweep', markNotAdmitted], ['badge', markIconic],
    ] as const) {
      (fn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push(name);
        return [];
      });
    }

    await orchestrateSync(makeConfig({
      recomputesMembership: true,
      badgesAdmitted: true,
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'Item 1' }],
        fetchedCount: 1,
        filtered: [{ externalId: '1', name: 'Item 1', reason: 'folded' }],
      }),
    }), 1);

    expect(order).toEqual(['refuse', 'restore', 'sweep', 'badge']);
    // And restore and the badge are asked about the very id that was refused.
    expect(restoreAdmission).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1'], false);
    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1'], false);
  });

  it('badges only the admitted rows a predicate passes, where belonging is not the badge', async () => {
    // A kind whose world tier has a door that is not a masterpiece — archaeology
    // admits a museum for what it is as well as for the famous find it holds
    // (ADR-0058 decision 2) — badges the masterpiece only (ADR-0045 decision 5).
    // The question is asked of the item the collector judged, because the row on
    // disk does not carry the answer.
    await orchestrateSync(makeConfig({
      recomputesMembership: true,
      badgesAdmitted: (item) => item.id === '2',
    }), 1);

    // Every id is still swept against, and only the one that passed is badged:
    // an unbadged row is in the kind in full standing.
    expect(markNotAdmitted).toHaveBeenCalledWith(
      TEST_SOURCE_ID, ['1', '2'], expect.any(String), false,
    );
    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['2'], false);
  });

  it('takes the badge back off an admitted row the predicate stopped passing', async () => {
    // The other half of a predicate badge. An archaeology museum whose last
    // famous find fell below the finds' line stays in the catalogue for what it
    // is, and must stop wearing a must-see badge for a find it is no longer
    // credited with. Nothing else reaches it: `CLEAR_ICONIC` fires when a row
    // leaves the kind, and this row does not leave.
    await orchestrateSync(makeConfig({
      recomputesMembership: true,
      badgesAdmitted: (item) => item.id === '2',
    }), 1);

    // Off the very list `markIconic` was handed, so the two statements cannot
    // disagree about who is badged. The curator's pin on the badge is the
    // clear's own guard (`unmarkIconic`).
    expect(unmarkIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['2'], false);
  });

  it('issues no clear where belonging is the badge, having nothing to take back', async () => {
    // `badgesAdmitted: true` hands every admitted row to `markIconic`, so the
    // leftover set is empty by construction and a statement would be a write
    // that can only ever match nothing.
    await orchestrateSync(makeConfig({ recomputesMembership: true, badgesAdmitted: true }), 1);

    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1', '2'], false);
    expect(unmarkIconic).not.toHaveBeenCalled();
  });

  it('sweeps against the ids the run actually saw, and badges nothing without the flag', async () => {
    await orchestrateSync(makeConfig({ recomputesMembership: true }), 1);

    expect(markNotAdmitted).toHaveBeenCalledWith(
      TEST_SOURCE_ID, ['1', '2'], expect.any(String), false,
    );
    // Recomputing membership buys the sweep, not the badge: that is a property
    // of the source's admission rule (`badgesAdmitted`), declared on its own.
    expect(markIconic).not.toHaveBeenCalled();
    expect(unmarkIconic).not.toHaveBeenCalled();
  });

  it('still restores, but does not sweep, when a guard refuses', async () => {
    (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue('run had 3 errors');

    await orchestrateSync(makeConfig({ recomputesMembership: true, badgesAdmitted: true }), 1);

    // Restoring is safe on any run: it can only widen what a reader sees.
    // Sweeping on a broken run empties a catalogue.
    expect(restoreAdmission).toHaveBeenCalled();
    expect(markNotAdmitted).not.toHaveBeenCalled();
    // And badging is a statement about rows the run did admit, whatever the
    // guard says about sweeping the rest.
    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1', '2'], false);
  });

  it('takes no badge back on a run whose sweep a guard refused', async () => {
    // The clear speaks about every admitted row the run did *not* name, which is
    // the set the sweep just declined to touch. Sent anyway, one broken SPARQL
    // day would strip the must-see badge off every archaeology museum the run
    // failed to reach — the sweep's guard honoured in the admission column and
    // broken in the badge one.
    (admissionSweepSkipReason as ReturnType<typeof vi.fn>).mockReturnValue('run had 3 errors');

    await orchestrateSync(makeConfig({
      recomputesMembership: true,
      badgesAdmitted: (item) => item.id === '2',
    }), 1);

    expect(markNotAdmitted).not.toHaveBeenCalled();
    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['2'], false);
    expect(unmarkIconic).not.toHaveBeenCalled();
  });

  it('takes no badge back for a source that sweeps nothing at all', async () => {
    // No skip reason and no sweep either: a source that publishes a list rather
    // than recomputing its membership never decides the rows it did not name, so
    // "the reason is null" is not "the sweep ran" and the clear must not read it
    // as one (`SweepOutcome`).
    await orchestrateSync(makeConfig({
      recomputesMembership: false,
      badgesAdmitted: (item) => item.id === '2',
    }), 1);

    expect(markNotAdmitted).not.toHaveBeenCalled();
    expect(markIconic).toHaveBeenCalledWith(TEST_SOURCE_ID, ['2'], false);
    expect(unmarkIconic).not.toHaveBeenCalled();
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
      TEST_SOURCE_ID, 42, 'success', expect.objectContaining({ filtered: 1 }), undefined,
    );
  });

  it('measures coverage against the rows that were there, not the ids offered', async () => {
    await orchestrateSync(makeConfig(), 1);

    // Counting the offered ids would fold in rows this run created, which only
    // ever lifts the ratio past the floor
    expect(countSeenAmongActive).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1', '2']);
  });

  it('measures coverage on every run, since none of them empties the source', async () => {
    // The exemption existed because a force run deleted the source first, so
    // the count would be zero against a pre-deletion denominator. Nothing
    // deletes now, and a run that skipped the floor could conclude that
    // everything it failed to fetch had been delisted.
    await orchestrateSync(makeConfig(), 1, { force: true } as never);

    expect(countSeenAmongActive).toHaveBeenCalledWith(TEST_SOURCE_ID, ['1', '2']);
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
      TEST_SOURCE_ID, 42, true, ['1', '2'],
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
      TEST_SOURCE_ID, 42, false, ['1', '2'],
    );
  });

  it('flags missing objects when the guards allow it', async () => {
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      syncLogId: 42, experienceId: 77, externalId: '1234', nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing', changedFields: null, significance: null, error: null,
    }]);

    await orchestrateSync(makeConfig(), 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'success',
      expect.objectContaining({ missing: 1 }),
      undefined,
    );
  });

  it('skips missing detection and records why', async () => {
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValueOnce('source is ranked');

    await orchestrateSync(makeConfig(), 1);

    expect(flagMissingExperiences).not.toHaveBeenCalled();
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_SOURCE_ID, 42, 'success',
      expect.objectContaining({ detectionSkippedReason: 'source is ranked' }),
      undefined,
    );
  });
});

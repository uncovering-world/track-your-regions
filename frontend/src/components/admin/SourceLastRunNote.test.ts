/**
 * What the sync card says of the objects a last run moved and did not place
 * (#1152): how many, and who places them, whether the restart stopped the run
 * in its items or in the placement after it closed.
 */

import { describe, it, expect } from 'vitest';
import { lastRunSentence } from './SourceLastRunNote';
import type { SyncLastRun } from '../../api/admin';

/** A museum run the restart stopped 412 of 1,083 objects in. */
function run(overrides: Partial<SyncLastRun> = {}): SyncLastRun {
  return {
    logId: 140, status: 'failed', dryRun: false,
    startedAt: '2026-09-29T20:40:00Z', completedAt: '2026-09-29T21:00:00Z',
    phase: 'processing', progress: 412, total: 1083, created: 37, updated: 12, held: 0, errors: 0,
    stoppedByRestart: true, unplaced: 37, placementStoppedByRestart: false,
    ...overrides,
  };
}

describe('lastRunSentence, of what a run left unplaced', () => {
  it('names the objects a run stopped in its items moved, and who places them', () => {
    expect(lastRunSentence(run())).toBe(
      'The last sync stopped when the server was restarted under it — 412 of 1,083 done: '
      + '37 created, 12 updated. What it wrote stands; starting it again goes over everything, '
      + 'with the answers the source already gave kept. 37 objects this source moved are not in their '
      + 'regions yet. The next sync places them and clears this note; Region Assignment places them sooner.',
    );
  });

  it('says a run that went through everything was stopped while it placed what it moved', () => {
    expect(lastRunSentence(run({
      status: 'partial', progress: 1083, stoppedByRestart: false, placementStoppedByRestart: true,
    }))).toBe(
      'The last sync went through all its objects, but the server was restarted under it while it '
      + 'was placing what it moved. 37 objects this source moved are not in their regions yet. The next '
      + 'sync places them and clears this note; Region Assignment places them sooner.',
    );
  });

  it('does not say a cancelled run went through all its objects', () => {
    const sentence = lastRunSentence(run({
      status: 'cancelled', stoppedByRestart: false, placementStoppedByRestart: true,
    }));

    expect(sentence).toMatch(/^The server was restarted under the last sync while it was placing what it moved\. 37 objects/);
    expect(sentence).not.toMatch(/went through all its objects/);
  });

  it('says nothing of placement when the run moved nothing it had not placed', () => {
    const sentence = lastRunSentence(run({ unplaced: 0 }));

    expect(sentence).toMatch(/with the answers the source already gave kept\.$/);
    expect(sentence).not.toMatch(/Region Assignment/);
  });

  it('only hedges on a run from before the count', () => {
    expect(lastRunSentence(run({ unplaced: null })))
      .toMatch(/kept\. Objects it wrote may need Region Assignment\.$/);
  });

  it('says one object in the singular', () => {
    expect(lastRunSentence(run({ unplaced: 1 })))
      .toMatch(/One object this source moved is not in its region yet\. The next sync places it and clears this note;/);
  });

  it('still names what waits when a run since was not stopped — a preview, a failed placement', () => {
    expect(lastRunSentence(run({ dryRun: true, status: 'success', stoppedByRestart: false, unplaced: 37 })))
      .toBe('37 objects this source moved are not in their regions yet. The next sync places them and '
        + 'clears this note; Region Assignment places them sooner.');
  });

  it('names what waits after a stopped preview and a run stopped while collecting', () => {
    const waits = /with the answers the source already gave kept\. 37 objects this source moved are not in their regions yet\./;
    expect(lastRunSentence(run({ dryRun: true, unplaced: 37 }))).toMatch(waits);
    expect(lastRunSentence(run({ phase: 'fetching', unplaced: 37 }))).toMatch(/37 objects this source moved are not in their regions yet\./);
  });

  it('says nothing of a last run that ended on its own and placed what it moved', () => {
    expect(lastRunSentence(run({ stoppedByRestart: false, unplaced: 0 }))).toBeNull();
  });
});

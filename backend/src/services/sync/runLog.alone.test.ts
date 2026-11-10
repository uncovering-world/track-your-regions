import { describe, expect, it } from 'vitest';
import { completionMessage } from './runLog.js';
import { makeProgress } from './syncOrchestrator.fixtures.js';

const NO_SKIPS = { withdrawal: null, admissionSweep: null };

describe("a run's closing line says it ran alone (#2424)", () => {
  it('says a dry run of some kinds of a pass ran alone, from the whole gather', () => {
    const line = completionMessage(makeProgress({ dryRun: true, alone: true, created: 602 }), 'success', NO_SKIPS);
    expect(line).toMatch(/^Complete: 602 created/);
    expect(line).toMatch(/; run alone, from the pass's whole gather: the pass's other kinds did not run$/);
  });

  it('says nothing of it on a run of the whole pass', () => {
    expect(completionMessage(makeProgress({ dryRun: true }), 'success', NO_SKIPS)).not.toMatch(/alone/);
  });
});

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

describe("a run's closing line says which of the pass's shared steps it read back (#2424)", () => {
  it('names each step it read, when it was kept and the builds its key names', () => {
    const keptGather = { places: new Date('2026-11-11T05:02:00Z'), pool: new Date('2026-11-11T05:19:00Z'), builds: '71 builds, the newest #1204' };
    const line = completionMessage(makeProgress({ dryRun: true, alone: true, keptGather }), 'success', NO_SKIPS);
    expect(line).toMatch(/; read the gather of places kept at 2026-11-11T05:02:00.000Z and the surroundings pool kept at 2026-11-11T05:19:00.000Z, made by the same code over the same builds \(71 builds, the newest #1204\) and admitted rows$/);
  });

  it('says nothing of it when the run made them', () => {
    expect(completionMessage(makeProgress({ dryRun: true, keptGather: {} }), 'success', NO_SKIPS)).not.toMatch(/kept at/);
  });
});

/**
 * The Public Dumps developers' table (#1494): a row's actions take one line,
 * the first a button and the rest a menu, and a failed build's reason stands
 * under its chip and is said once.
 */

import { describe, it, expect, vi } from 'vitest';
import { reasonBeyondChip, rowActions } from './DumpsPanel';
import type { DumpBuild, DumpsDumpsItem } from '../../api/admin/dumps';

vi.mock('../../api/admin/dumps', () => ({}));

const build = (over: Partial<DumpBuild>): DumpBuild => ({
  id: 6, kind: 'keep', fileName: null, dumpDate: null, mode: 'local', bytes: 0, lines: 0, checksumKind: null,
  verified: false, broughtForward: false, queuedBy: null, status: 'failed', error: null, outcome: null,
  startedAt: '2026-10-15T08:00:00Z', finishedAt: '2026-10-15T08:26:00Z', ...over,
} as DumpBuild);

const entities = {
  key: 'wikidata-entities', source: 'Wikidata', title: 'All entities', datedBy: 'day', about: '', how: '', inputOf: null,
  progress: null, builds: [], sample: { fileName: 'sample.json.gz', bytes: 1 },
  localCopy: { date: '2026-10-05', bytes: 145_700_000_000, fileName: 'latest-all.json.gz' },
  keeps: { built: { dumpDate: '2026-10-05' }, rederives: true, samples: true, fromCopy: true },
} as unknown as DumpsDumpsItem;

const noop = () => {};
const actionsOf = (dump: DumpsDumpsItem) => rowActions({
  dump, copy: dump.localCopy, copyDate: '5 Oct 2026', replaces: '',
  verify: noop, build: noop, rederive: noop, cutSample: noop, trial: noop, pending: false,
});

describe('rowActions', () => {
  it('puts building the newest file first for a dump something is built from, and the rest after it', () => {
    expect(actionsOf(entities).map((a) => a.label)).toEqual([
      'Build newest', 'Verify newest', 'Build 5 Oct 2026 copy', 'Derive again', 'Cut a sample', 'Try the build',
    ]);
  });

  it('has verifying as the only action of a dump nothing is built from', () => {
    const plain = { ...entities, keeps: null, localCopy: null, sample: null } as unknown as DumpsDumpsItem;
    expect(actionsOf(plain).map((a) => a.label)).toEqual(['Verify newest']);
  });
});

describe('reasonBeyondChip', () => {
  it('names why a build failed', () => {
    expect(reasonBeyondChip(build({ error: 'The build stopped: its process ended or restarted.' })))
      .toBe('The build stopped: its process ended or restarted.');
  });

  it('says nothing that only restates the chip', () => {
    expect(reasonBeyondChip(build({ status: 'cancelled', error: 'Cancelled.' }))).toBeNull();
  });

  it('says nothing of a build that ended well', () => {
    expect(reasonBeyondChip(build({ status: 'success', error: null }))).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The panel's side of a dump build (ADR-0106): what is refused before a build
 * is queued, what a queued build asks the worker for, and how a build's row
 * reads in the panel. The ledger and the disk are mocked.
 */

const ledger = vi.hoisted(() => ({
  enqueueBuild: vi.fn(async () => 1),
  activeBuildOf: vi.fn(),
  closeOrphanedBuilds: vi.fn(async () => 0),
  requestCancel: vi.fn(async () => true),
}));
vi.mock('./ledger.js', () => ledger);
const copies = vi.hoisted(() => ({ newest: null as null | { fileName: string } }));
vi.mock('./localCopies.js', () => ({ newestLocalCopy: async () => copies.newest }));
const samples = vi.hoisted(() => ({ newest: null as null | { fileName: string } }));
vi.mock('./samples.js', () => ({ newestSample: async () => samples.newest }));
const kept = vi.hoisted(() => ({ latest: vi.fn(async () => null as null | { dumpDate: string }) }));
vi.mock('./keepers.js', () => ({
  keeperOf: (key: string) => {
    if (key === 'wikidata-entities') return { title: 'subset', rederive: vi.fn(), latest: kept.latest, samples: true, fromCopy: true };
    if (key === 'pageviews-user') return { title: 'readership', latest: kept.latest, samples: false, fromCopy: false };
    return null;
  },
}));

const { buildProgress, startBuild } = await import('./buildQueue.js');

const queuedRow = (request: Record<string, unknown>) => ({
  id: 1, status: 'queued', request, progress: null, file_name: null, dump_date: null, expected_bytes: null,
  started_at: new Date(), heartbeat_at: null, runner: null, cancel_requested_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  copies.newest = null;
  samples.newest = null;
  process.env.DUMPS_DIR = '/app/data/dumps';
});

describe('queuing a dump build (ADR-0106)', () => {
  it('refuses a sample, a trial or a build from the copy of readership (#1436)', async () => {
    copies.newest = { fileName: 'pageviews-202609-user.bz2' };
    await expect(startBuild('pageviews-user', { startedBy: 1, kind: 'sample' })).rejects.toThrow(/cannot be tried on a sample/);
    await expect(startBuild('pageviews-user', { startedBy: 1, kind: 'trial' })).rejects.toThrow(/cannot be tried on a sample/);
    // Its year always ends at the newest month: a build from the copy would end it at a month not kept yet.
    await expect(startBuild('pageviews-user', { startedBy: 1, kind: 'keep', from: 'local' })).rejects.toThrow(/always reads the newest file/);
    expect(ledger.enqueueBuild).not.toHaveBeenCalled();
  });

  it('cuts a sample from the local copy, and refuses one without a copy or a builder (#1527)', async () => {
    await expect(startBuild('wikidata-entities', { startedBy: 1, kind: 'sample' })).rejects.toThrow(/no local copy of wikidata-entities/);
    await expect(startBuild('enwiki-page', { startedBy: 1, kind: 'sample' })).rejects.toThrow(/Nothing is built from enwiki-page/);
    copies.newest = { fileName: 'wikidata-20261005-all.json.gz' };
    ledger.activeBuildOf.mockResolvedValue(queuedRow({ kind: 'sample' }));
    await startBuild('wikidata-entities', { startedBy: 1, kind: 'sample' });
    expect(ledger.enqueueBuild).toHaveBeenCalledWith('wikidata-entities', 'local', { kind: 'sample', only: 'wikidata-20261005-all.json.gz' }, 1);
  });

  it('tries the build on the newest sample, and refuses where none was cut (#1527)', async () => {
    copies.newest = { fileName: 'wikidata-20261005-all.json.gz' };
    await expect(startBuild('wikidata-entities', { startedBy: 1, kind: 'trial' })).rejects.toThrow(/no sample of wikidata-entities/);
    samples.newest = { fileName: 'sample-4gb-wikidata-20261005-all.json.gz' };
    ledger.activeBuildOf.mockResolvedValue(queuedRow({ kind: 'trial' }));
    await startBuild('wikidata-entities', { startedBy: 1, kind: 'trial' });
    expect(ledger.enqueueBuild).toHaveBeenCalledWith(
      'wikidata-entities', 'local', { kind: 'trial', only: 'sample-4gb-wikidata-20261005-all.json.gz' }, 1,
    );
  });

  it('refuses a keeping build of a dump nothing is built from', async () => {
    await expect(startBuild('enwiki-page', { startedBy: 1, kind: 'keep' })).rejects.toThrow(/Nothing is built from enwiki-page/);
    expect(ledger.enqueueBuild).not.toHaveBeenCalled();
  });

  it('refuses to derive again where nothing is built yet, or nothing is built from the dump (#1526)', async () => {
    await expect(startBuild('wikidata-entities', { startedBy: 1, kind: 'rederive' })).rejects.toThrow(/build it from the dump first/);
    await expect(startBuild('enwiki-page', { startedBy: 1, kind: 'rederive' })).rejects.toThrow(/can be derived again/);
    expect(ledger.enqueueBuild).not.toHaveBeenCalled();
  });

  it('queues a re-derive with no file to read, whatever the local copy (#1526)', async () => {
    kept.latest.mockResolvedValue({ dumpDate: '2026-10-05' });
    ledger.activeBuildOf.mockResolvedValue(queuedRow({ kind: 'rederive' }));
    const progress = await startBuild('wikidata-entities', { startedBy: 7, kind: 'rederive', from: 'local' });
    expect(ledger.enqueueBuild).toHaveBeenCalledWith('wikidata-entities', 'local', { kind: 'rederive' }, 7);
    expect(progress).toMatchObject({ status: 'queued', kind: 'rederive' });
  });

  it('refuses a build from a local copy that is not there', async () => {
    await expect(startBuild('wikidata-entities', { startedBy: 1, kind: 'keep', from: 'local' })).rejects.toThrow(/no local copy/);
  });

  it('queues a build from the local copy with that copy\'s file, and shows it waiting for the worker', async () => {
    copies.newest = { fileName: 'wikidata-20261005-all.json.gz' };
    ledger.activeBuildOf.mockResolvedValue(queuedRow({ kind: 'keep', only: 'wikidata-20261005-all.json.gz' }));
    const progress = await startBuild('wikidata-entities', { startedBy: 7, kind: 'keep', from: 'local' });
    expect(ledger.enqueueBuild).toHaveBeenCalledWith('wikidata-entities', 'local', { kind: 'keep', only: 'wikidata-20261005-all.json.gz' }, 7);
    expect(progress).toMatchObject({ status: 'queued', kind: 'keep', message: 'Waiting for the dump worker...', heartbeatAt: null });
  });

  it('reads a running build\'s progress and file from its row', async () => {
    ledger.activeBuildOf.mockResolvedValue({
      ...queuedRow({ kind: 'verify' }), status: 'running', heartbeat_at: new Date('2026-10-14T13:00:00Z'),
      file_name: 'wikidata-20261005-all.json.gz', dump_date: new Date('2026-10-05T00:00:00Z'), expected_bytes: '156402652329',
      progress: { phase: 'reading', message: 'Pass 1 of 2', downloaded: 0, read: 1800, lines: 1000 },
    });
    expect(await buildProgress('wikidata-entities')).toMatchObject({
      status: 'reading', message: 'Pass 1 of 2', read: 1800, lines: 1000,
      file: { fileName: 'wikidata-20261005-all.json.gz', date: '2026-10-05', expectedBytes: 156402652329 },
    });
  });

  it('reads what a step measures and when it started, and neither from a row written before them (#1519)', async () => {
    ledger.activeBuildOf.mockResolvedValue({
      ...queuedRow({ kind: 'keep' }), status: 'running', heartbeat_at: new Date(),
      progress: {
        phase: 'reading', message: 'Labelling the entities the kept items name...', downloaded: 0, read: 3_140_000_000, lines: 0,
        etaSeconds: 300, total: 5_350_000_000, stepStartedAt: '2026-10-15T15:00:00.000Z',
      },
    });
    expect(await buildProgress('wikidata-entities')).toMatchObject({
      read: 3_140_000_000, total: 5_350_000_000, stepStartedAt: new Date('2026-10-15T15:00:00Z'),
      // The same step in the shape every long operation reports, with no step count (#1356).
      operation: { step: { index: 1, count: null, sentence: 'Labelling the entities the kept items name...', done: 3_140_000_000, total: 5_350_000_000 } },
    });
    ledger.activeBuildOf.mockResolvedValue({
      ...queuedRow({ kind: 'keep' }), status: 'running', heartbeat_at: new Date(),
      progress: { phase: 'reading', message: 'Indexing...', downloaded: 0, read: 0, lines: 0, etaSeconds: null },
    });
    expect(await buildProgress('wikidata-entities')).toMatchObject({ total: null, stepStartedAt: null });
  });

  it('reads a row from before the queue, which asked for nothing, as a verify build', async () => {
    ledger.activeBuildOf.mockResolvedValue({ ...queuedRow({}), request: null, status: 'running', heartbeat_at: new Date() });
    expect(await buildProgress('wikidata-entities')).toMatchObject({ kind: 'verify', status: 'resolving' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Running one queued build in the dump worker (ADR-0106): its outcome closes
 * its row, what it did on the way stays in the message, an admin's cancel
 * reaches it through its heartbeat, and a stopping worker says to start it
 * again. The ledger, the catalog and the read are mocked.
 */

const ledger = vi.hoisted(() => ({
  beat: vi.fn(async (_id: number, _progress: { etaSeconds: number | null }) => ({ cancelRequested: false })),
  closeBuild: vi.fn(async () => undefined),
  recordFile: vi.fn(async () => undefined),
  recordUpdate: vi.fn(async () => undefined),
  BEAT_EVERY_MS: 5_000,
}));
vi.mock('./ledger.js', () => ledger);
const FILE = {
  key: 'wikidata-lexemes', fileName: 'wikidata-20261012-lexemes.json.gz', url: 'https://dumps.wikimedia.org/x',
  date: '2026-10-12', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 1, compression: 'gzip',
};
vi.mock('./catalog.js', () => ({ dumpNamed: (key: string) => ({ key, resolve: async () => FILE }) }));
const keepers = vi.hoisted(() => ({
  rederive: vi.fn(async (_options: { buildId: number; onNote?: (note: string) => void; onPhase: (m: string) => void }) => undefined),
  build: vi.fn(),
  update: vi.fn(),
  canUpdate: vi.fn(async () => true),
}));
vi.mock('./keepers.js', () => ({
  keeperOf: (key: string) => {
    if (key === 'wikidata-entities') return { rederive: keepers.rederive, build: keepers.build };
    if (key === 'osm-planet') return { build: keepers.build, update: keepers.update, canUpdate: keepers.canUpdate };
    return null;
  },
}));
const SAMPLE = { fileName: 'sample-4gb-wikidata-20261005-all.json.gz', of: 'wikidata-20261005-all.json.gz', date: '2026-10-05', bytes: 400 };
const SAMPLE_FILE = { key: 'wikidata-entities', fileName: SAMPLE.fileName, url: '', date: SAMPLE.date, checksum: null, expectedBytes: 400, compression: 'gzip' };
const samples = vi.hoisted(() => ({ cutSample: vi.fn(), sampleIn: vi.fn() }));
vi.mock('./samples.js', () => ({
  cutSample: samples.cutSample, sampleIn: samples.sampleIn, sampleFile: () => SAMPLE_FILE, SAMPLE_JSON_BYTES: 4 * 1024 ** 3,
}));
const read = vi.hoisted(() => ({ readDump: vi.fn() }));
vi.mock('./read.js', () => ({ readDump: read.readDump, countLines: () => ({}) }));

const { runBuild } = await import('./buildRun.js');

const claimed = { id: 9, dump: 'wikidata-lexemes', request: { kind: 'verify' as const } };
/** A read that runs until its signal aborts. */
const untilAborted = async (_file: unknown, _consumer: unknown, options: { signal: AbortSignal }) => {
  await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DUMPS_DIR', '/dumps');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('a build in the dump worker (ADR-0106)', () => {
  it('closes a verified build as a success, with the file recorded', async () => {
    read.readDump.mockResolvedValue({ bytes: 1, lines: 3, checksumActual: 'a'.repeat(40) });
    await runBuild(claimed, new AbortController().signal);
    // A verify names its steps itself, so its row says when the one running started (#1519).
    expect(ledger.beat).toHaveBeenCalledWith(9, expect.objectContaining({ stepStartedAt: expect.any(String) }));
    expect(ledger.recordFile).toHaveBeenCalledWith(9, FILE);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'success', lines: 3 }));
  });

  it('brings a kept copy forward without finding, recording or verifying a file of the host\'s (#1437)', async () => {
    keepers.update.mockResolvedValue({ bytes: 40, lines: 0, checksumActual: null, summary: 'kept 3 OpenStreetMap objects' });
    await runBuild({ id: 9, dump: 'osm-planet', request: { kind: 'keep' } }, new AbortController().signal);
    expect(keepers.update).toHaveBeenCalledWith(expect.objectContaining({ buildId: 9 }));
    expect(keepers.build).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.recordUpdate).toHaveBeenCalledWith(9);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'success', checksumActual: null, outcome: expect.stringMatching(/^brought forward and swapped in; kept 3 OpenStreetMap objects/),
    }));
  });

  it('downloads nothing for a scheduled update when what is kept can no longer be brought forward (#1437)', async () => {
    keepers.canUpdate.mockResolvedValueOnce(false);
    await runBuild({ id: 9, dump: 'osm-planet', request: { kind: 'keep', scheduled: true, notBefore: '2026-10-30T09:30:00.000Z' } }, new AbortController().signal);
    expect(keepers.update).not.toHaveBeenCalled();
    expect(keepers.build).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed', error: expect.stringMatching(/a scheduled update downloads nothing/),
    }));
  });

  it('builds from the local copy named, not from what is kept, when the admin asks for that copy (#1437)', async () => {
    keepers.build.mockResolvedValue({ bytes: 1, lines: 0, checksumActual: 'c'.repeat(32), summary: 'kept 3 OpenStreetMap objects' });
    await runBuild({ id: 9, dump: 'osm-planet', request: { kind: 'keep', only: 'planet-261012.osm.pbf' } }, new AbortController().signal);
    expect(keepers.update).not.toHaveBeenCalled();
    expect(ledger.recordUpdate).not.toHaveBeenCalled();
    expect(keepers.build).toHaveBeenCalled();
    expect(ledger.recordFile).toHaveBeenCalled();
  });

  it('hands the builder the month the year ends on, with that month\'s file found by name (#2230)', async () => {
    keepers.build.mockResolvedValue({ bytes: 1, lines: 0, checksumActual: null, summary: 'kept the year ending 2025-09 beside the current one' });
    await runBuild({ id: 9, dump: 'osm-planet', request: { kind: 'keep', only: 'pageviews-202509-user.bz2', windowEnd: '2025-09' } }, new AbortController().signal);
    expect(keepers.update).not.toHaveBeenCalled();
    expect(keepers.build).toHaveBeenCalledWith(FILE, expect.objectContaining({ buildId: 9, windowEnd: '2025-09' }));
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'success', outcome: expect.stringMatching(/year ending 2025-09/) }));
  });

  it('derives again without finding or reading a file, and closes as a success (#1526)', async () => {
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'rederive' } }, new AbortController().signal);
    expect(keepers.rederive).toHaveBeenCalledWith(expect.objectContaining({ buildId: 9 }));
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.beat).toHaveBeenCalledWith(9, expect.objectContaining({ phase: 'deriving' }));
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, {
      status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null, outcome: 'derived again and swapped in',
    });
  });

  it('says how long each step took in the row of a build that ended well (#1527)', async () => {
    vi.useFakeTimers({ now: 0 });
    keepers.rederive.mockImplementation(async ({ onPhase }) => {
      onPhase('Deriving the claims, labels and sitelinks...');
      vi.setSystemTime(65_000);
      onPhase('Indexing...');
      vi.setSystemTime(70_000);
    });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'rederive' } }, new AbortController().signal);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      outcome: 'derived again and swapped in; steps: Deriving the claims, labels and sitelinks 1 min 5 s, Indexing 5 s',
    }));
  });

  it('starts each step with its time and nothing measured, and measures what the step reads (#1519)', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-15T15:00:00Z') });
    const beats: Array<Record<string, unknown>> = [];
    ledger.beat.mockImplementation(async (_id: number, progress: object) => {
      beats.push({ ...progress });
      return { cancelRequested: false };
    });
    read.readDump.mockResolvedValue({ bytes: 1, lines: 3, checksumActual: 'a'.repeat(40) });
    keepers.build.mockImplementation(async (_file: unknown, options: {
      onPhase: (m: string) => void; onMeasure: (read: number, total: number) => void;
    }) => {
      options.onPhase('Labelling the entities the kept items name...');
      options.onMeasure(2_000, 8_000);
      await vi.advanceTimersByTimeAsync(5_000);
      vi.setSystemTime(Date.parse('2026-10-15T15:10:00Z'));
      options.onPhase('Indexing...');
      options.onPhase('Indexing: 0 of 6 indexes built; building idx_wikidata_claims_subject...');
      await vi.advanceTimersByTimeAsync(5_000);
      return { bytes: 1, lines: 3, checksumActual: 'a'.repeat(40) };
    });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'keep' } }, new AbortController().signal);
    const labelling = beats.find(beat => String(beat.message).startsWith('Labelling'));
    expect(labelling).toMatchObject({ read: 2_000, total: 8_000, stepStartedAt: '2026-10-15T15:00:00.000Z' });
    // Each step started is counted, a message of the same step not (#1356).
    expect(beats.at(-1)!.step).toBe((labelling!.step as number) + 1);
    expect(beats.at(-1)).toMatchObject({
      message: 'Indexing: 0 of 6 indexes built; building idx_wikidata_claims_subject...', read: 0, total: null, stepStartedAt: '2026-10-15T15:10:00.000Z',
    });
  });

  it('records what it read of its file when it fails in a later step, not that step\'s measure (#1519)', async () => {
    keepers.build.mockImplementation(async (_file: unknown, options: {
      onPhase: (m: string) => void; onMeasure: (read: number, total: number) => void; onProgress: (p: object) => void;
    }) => {
      options.onPhase('Pass 2 of 2: writing 9 items...');
      options.onProgress({ downloaded: 0, read: 500, lines: 7 });
      options.onPhase('Labelling the entities the kept items name...');
      options.onMeasure(80, 90);
      options.onPhase('Deriving the claims, labels and sitelinks...');
      throw new Error('the database went away');
    });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'keep' } }, new AbortController().signal);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'failed', bytes: 500, lines: 7 }));
  });

  it('cuts a sample of the local copy named, records it as the file, and says what it cut (#1527)', async () => {
    samples.cutSample.mockResolvedValue({ sample: SAMPLE, lines: 1200, read: 300 * 1024 ** 2 });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'sample', only: SAMPLE.of } }, new AbortController().signal);
    expect(samples.cutSample).toHaveBeenCalledWith('/dumps', SAMPLE.of, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.recordFile).toHaveBeenCalledWith(9, SAMPLE_FILE);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'success', lines: 1200, outcome: expect.stringMatching(/^cut sample-4gb-wikidata-20261005-all\.json\.gz \(0\.0 GB, 1,200 lines\) from the first 0\.3 GB/),
    }));
  });

  it('tries the build on the sample, read from disk only, and swaps nothing in (#1527)', async () => {
    samples.sampleIn.mockResolvedValue(SAMPLE);
    keepers.build.mockResolvedValue({ bytes: 400, lines: 1200, checksumActual: null, summary: 'kept 10 of 1,200 items' });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'trial', only: SAMPLE.fileName } }, new AbortController().signal);
    expect(samples.sampleIn).toHaveBeenCalledWith('/dumps', SAMPLE.fileName);
    expect(keepers.build).toHaveBeenCalledWith(SAMPLE_FILE, expect.objectContaining({ trial: true, held: true, buildId: 9 }));
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'success', outcome: `tried the build on ${SAMPLE.fileName}; kept 10 of 1,200 items; nothing was swapped in`,
    }));
  });

  it('refuses a sample or a trial where no local copy is kept (#1527)', async () => {
    vi.stubEnv('DUMPS_DIR', '');
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'trial', only: SAMPLE.fileName } }, new AbortController().signal);
    expect(keepers.build).not.toHaveBeenCalled();
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'failed', error: expect.stringMatching(/DUMPS_DIR is not set/) }));
  });

  it('fails a kind of build it does not know rather than reading the file as a verify (#1526)', async () => {
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'compact' as never } }, new AbortController().signal);
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'failed', error: expect.stringMatching(/does not know a compact build/) }));
  });

  it('fails a keep build of a dump it has no builder for, before finding or reading the file (#1670)', async () => {
    await runBuild({ id: 9, dump: 'enwiki-page', request: { kind: 'keep' } }, new AbortController().signal);
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed', error: expect.stringMatching(/has no builder for enwiki-page; restart it/),
    }));
  });

  it('says to restart the worker for a re-derive or a trial of a dump it has no builder for (#1670)', async () => {
    for (const kind of ['rederive', 'trial'] as const) {
      vi.clearAllMocks();
      await runBuild({ id: 9, dump: 'enwiki-page', request: { kind, only: SAMPLE.fileName } }, new AbortController().signal);
      expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
        status: 'failed', error: expect.stringMatching(/has no builder for enwiki-page; restart it/),
      }));
    }
  });

  it('closes a re-derive that failed with what it noted on the way (#1526)', async () => {
    keepers.rederive.mockImplementation(async ({ onNote }) => {
      onNote?.('the database\'s disk was not checked: DB_DISK_DIR names no path on it');
      throw new Error('There is no subset in place to derive again: build it from the dump first');
    });
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'rederive' } }, new AbortController().signal);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed',
      error: 'There is no subset in place to derive again: build it from the dump first; the database\'s disk was not checked: DB_DISK_DIR names no path on it',
    }));
  });

  it('keeps what a failed build did on the way in the failure', async () => {
    read.readDump.mockImplementation(async (_file: unknown, _consumer: unknown, options: { onNote?: (note: string) => void }) => {
      options.onNote?.('removed wikidata-20261005-lexemes.json.gz first');
      throw new Error('the host cut the download');
    });
    await runBuild(claimed, new AbortController().signal);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed', error: 'the host cut the download; removed wikidata-20261005-lexemes.json.gz first',
    }));
  });

  it('stops at the heartbeat after an admin asked it to, and closes as cancelled', async () => {
    vi.useFakeTimers();
    read.readDump.mockImplementation(untilAborted);
    ledger.beat.mockResolvedValueOnce({ cancelRequested: false }).mockResolvedValue({ cancelRequested: true });
    const done = runBuild(claimed, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'cancelled', error: 'Cancelled.' }));
  });

  it('says to start the build again when the worker stops under it', async () => {
    read.readDump.mockImplementation(untilAborted);
    const stop = new AbortController();
    const done = runBuild(claimed, stop.signal);
    await vi.waitFor(() => expect(read.readDump).toHaveBeenCalled());
    stop.abort();
    await done;
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed', error: 'The dump worker stopped; start the build again.',
    }));
  });

  it('starts the time left again when the download ends and the read begins (#1474)', async () => {
    vi.useFakeTimers({ now: 0 });
    const etas: Array<number | null> = [];
    ledger.beat.mockImplementation(async (_id: number, progress: { etaSeconds: number | null }) => {
      etas.push(progress.etaSeconds);
      return { cancelRequested: false };
    });
    read.readDump.mockImplementation(async (_file: unknown, _consumer: unknown, options: { onProgress: (p: object) => void }) => {
      vi.setSystemTime(0);
      options.onProgress({ downloaded: 0, read: 0, lines: 0 });
      vi.setSystemTime(120_000);
      options.onProgress({ downloaded: 1, read: 0, lines: 0 });
      // The read starts at 0 with the whole file downloaded: a new pass, with no estimate in its first minute.
      vi.setSystemTime(130_000);
      options.onProgress({ downloaded: 1, read: 0.1, lines: 1 });
      await vi.advanceTimersByTimeAsync(5_000);
      return { bytes: 1, lines: 3, checksumActual: 'a'.repeat(40) };
    });
    await runBuild(claimed, new AbortController().signal);
    expect(etas.at(-1)).toBeNull();
  });
});

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
  BEAT_EVERY_MS: 5_000,
}));
vi.mock('./ledger.js', () => ledger);
const FILE = {
  key: 'wikidata-lexemes', fileName: 'wikidata-20261012-lexemes.json.gz', url: 'https://dumps.wikimedia.org/x',
  date: '2026-10-12', checksum: { kind: 'sha1', value: 'a'.repeat(40) }, expectedBytes: 1, compression: 'gzip',
};
vi.mock('./catalog.js', () => ({ dumpNamed: (key: string) => ({ key, resolve: async () => FILE }) }));
const keepers = vi.hoisted(() => ({ rederive: vi.fn(async (_options: { buildId: number; onNote?: (note: string) => void }) => undefined) }));
vi.mock('./keepers.js', () => ({ keeperOf: (key: string) => (key === 'wikidata-entities' ? { rederive: keepers.rederive } : null) }));
const read = vi.hoisted(() => ({ readDump: vi.fn() }));
vi.mock('./read.js', () => ({ readDump: read.readDump, countLines: () => ({}) }));

const { runBuild } = await import('./buildRun.js');

const claimed = { id: 9, dump: 'wikidata-lexemes', request: { kind: 'verify' as const } };
/** A read that runs until its signal aborts. */
const untilAborted = async (_file: unknown, _consumer: unknown, options: { signal: AbortSignal }) => {
  await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('a build in the dump worker (ADR-0106)', () => {
  it('closes a verified build as a success, with the file recorded', async () => {
    read.readDump.mockResolvedValue({ bytes: 1, lines: 3, checksumActual: 'a'.repeat(40) });
    await runBuild(claimed, new AbortController().signal);
    expect(ledger.recordFile).toHaveBeenCalledWith(9, FILE);
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'success', lines: 3 }));
  });

  it('derives again without finding or reading a file, and closes as a success (#1526)', async () => {
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'rederive' } }, new AbortController().signal);
    expect(keepers.rederive).toHaveBeenCalledWith(expect.objectContaining({ buildId: 9 }));
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.beat).toHaveBeenCalledWith(9, expect.objectContaining({ phase: 'deriving' }));
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, { status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null });
  });

  it('fails a kind of build it does not know rather than reading the file as a verify (#1526)', async () => {
    await runBuild({ id: 9, dump: 'wikidata-entities', request: { kind: 'compact' as never } }, new AbortController().signal);
    expect(read.readDump).not.toHaveBeenCalled();
    expect(ledger.recordFile).not.toHaveBeenCalled();
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'failed', error: expect.stringMatching(/does not know a compact build/) }));
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

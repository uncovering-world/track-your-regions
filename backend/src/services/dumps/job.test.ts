import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A build is refused while another process builds the same dump (#1463), is
 * refused from a local copy that is not there, and keeps what it did on the
 * way when it fails (#1456). The ledger, the catalog's resolving and the read
 * are mocked, so no build reaches a host.
 */

const ledger = vi.hoisted(() => ({
  liveBuildOf: vi.fn(),
  closeOrphanedBuilds: vi.fn(async () => 0),
  openBuild: vi.fn(),
  closeBuild: vi.fn(async () => undefined),
  beat: vi.fn(async () => undefined),
  BEAT_EVERY_MS: 60_000,
}));
vi.mock('./ledger.js', () => ledger);
const resolved = vi.hoisted(() => ({ file: null as null | Record<string, unknown> }));
vi.mock('./catalog.js', () => ({
  dumpNamed: (key: string) => ({ key, resolve: async () => resolved.file, isFileName: (name: string) => /^wikidata-\d{8}-all\.json\.gz$/.test(name) }),
}));
const read = vi.hoisted(() => ({ readDump: vi.fn() }));
vi.mock('./read.js', () => ({ readDump: read.readDump, countLines: () => ({}) }));

const { startBuild } = await import('./job.js');

beforeEach(() => {
  ledger.liveBuildOf.mockReset();
  ledger.closeOrphanedBuilds.mockClear();
});

describe('a build from the local copy (#1456)', () => {
  it('is refused where there is no local copy', async () => {
    ledger.liveBuildOf.mockResolvedValue(null);
    const before = process.env.DUMPS_DIR;
    delete process.env.DUMPS_DIR;
    try {
      await expect(startBuild('wikidata-entities', { startedBy: 1, runner: 'server:fixture', from: 'local' })).rejects.toThrow(/no local copy of wikidata-entities/);
    } finally {
      if (before !== undefined) process.env.DUMPS_DIR = before;
    }
  });
});

describe('one build per dump, whatever process runs it (#1463)', () => {
  it('refuses a build while another process\'s build of the dump still beats', async () => {
    ledger.liveBuildOf.mockResolvedValue({
      id: 7, file_name: 'wikidata-20261005-all.json.gz', started_at: new Date('2026-10-14T11:00:00Z'), heartbeat_at: new Date(),
    });
    await expect(startBuild('wikidata-entities', { startedBy: 1, runner: 'server:fixture' })).rejects.toThrow(/running in another process: build 7, wikidata-20261005-all\.json\.gz/);
    expect(ledger.closeOrphanedBuilds).toHaveBeenCalledWith({ dump: 'wikidata-entities' });
  });

  it('starts one once no build of the dump beats', async () => {
    ledger.liveBuildOf.mockResolvedValue(null);
    const progress = await startBuild('wikidata-lexemes', { startedBy: 1, runner: 'server:fixture' });
    // The progress object is the live one: the build behind it has already ended on the empty listing.
    expect(progress).toMatchObject({ dump: 'wikidata-lexemes', kind: 'verify' });
    expect(ledger.liveBuildOf).toHaveBeenCalledWith('wikidata-lexemes');
  });
});

describe('what a failed build did on the way (#1456)', () => {
  it('keeps the removal of an older copy in the failure the ledger records', async () => {
    ledger.liveBuildOf.mockResolvedValue(null);
    ledger.openBuild.mockResolvedValue(9);
    resolved.file = { key: 'wikidata-lexemes', fileName: 'wikidata-20261012-lexemes.json.gz', url: 'https://dumps.wikimedia.org/x', date: '2026-10-12', checksum: null, expectedBytes: 1, compression: 'gzip' };
    read.readDump.mockImplementation(async (_file: unknown, _consumer: unknown, options: { onNote?: (note: string) => void }) => {
      options.onNote?.('removed wikidata-20261005-lexemes.json.gz first: the disk could not hold wikidata-20261012-lexemes.json.gz beside it');
      throw new Error('the host cut the download');
    });
    await startBuild('wikidata-lexemes', { startedBy: 1, runner: 'server:fixture' });
    await vi.waitFor(() => expect(ledger.closeBuild).toHaveBeenCalled());
    expect(ledger.closeBuild).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'failed',
      error: expect.stringMatching(/^the host cut the download; removed wikidata-20261005-lexemes\.json\.gz first/),
    }));
    resolved.file = null;
  });
});

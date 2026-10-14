import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A build is refused while another process builds the same dump (#1463):
 * the ledger is mocked, and the dump resolves to no file, so a build that
 * starts ends at once without touching a host.
 */

const ledger = vi.hoisted(() => ({
  liveBuildOf: vi.fn(),
  closeOrphanedBuilds: vi.fn(async () => 0),
  openBuild: vi.fn(),
  closeBuild: vi.fn(),
  beat: vi.fn(),
  BEAT_EVERY_MS: 60_000,
}));
vi.mock('./ledger.js', () => ledger);
vi.mock('./catalog.js', () => ({
  dumpNamed: (key: string) => ({ key, resolve: async () => null }),
}));

const { startBuild } = await import('./job.js');

beforeEach(() => {
  ledger.liveBuildOf.mockReset();
  ledger.closeOrphanedBuilds.mockClear();
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

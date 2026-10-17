import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./reader.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reader.js')>(),
  wikidataReaderOf: vi.fn(),
}));
vi.mock('../../dumps/wikidata/subsetTables.js', () => ({
  latestSubset: vi.fn(async () => ({ dumpDate: '2026-10-05', swappedAt: new Date(), needs: {} })),
  entitiesAreHeld: vi.fn(async () => true),
}));
vi.mock('../wikidataCache.js', () => ({ pruneExpired: vi.fn() }));

import { pruneExpired } from '../wikidataCache.js';
import { readsSubset, wikidataReaderOf } from './reader.js';
import { subsetRunDoor } from './runDoor.js';
import type { SyncProgress } from '../types.js';

const MUSEUMS = 2;
const progress = () => ({ statusMessage: '' }) as SyncProgress;

describe('subsetRunDoor', () => {
  beforeEach(() => {
    vi.mocked(pruneExpired).mockReset().mockResolvedValue(0);
  });

  it('prunes what the source\'s live runs kept, since no run on the subset reads it (ADR-0119)', async () => {
    // A run on the subset may build no cached door, and the cache's own prune
    // runs only behind one: without this, the museums' answers from their last
    // live run would stay in the table forever.
    vi.mocked(wikidataReaderOf).mockResolvedValue('subset');

    const door = await subsetRunDoor(MUSEUMS, progress());

    expect(pruneExpired).toHaveBeenCalledWith(MUSEUMS);
    expect(door && readsSubset(door)).toBe(true);
  });

  it('goes on reading the subset when the prune fails', async () => {
    vi.mocked(wikidataReaderOf).mockResolvedValue('subset');
    vi.mocked(pruneExpired).mockRejectedValue(new Error('cache table locked'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(subsetRunDoor(MUSEUMS, progress())).resolves.not.toBeNull();
  });

  it('prunes nothing for a source on the live service, whose cached door prunes on its own', async () => {
    vi.mocked(wikidataReaderOf).mockResolvedValue('live');

    expect(await subsetRunDoor(MUSEUMS, progress())).toBeNull();
    expect(pruneExpired).not.toHaveBeenCalled();
  });
});

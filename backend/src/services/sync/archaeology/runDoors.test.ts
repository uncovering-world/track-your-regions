/**
 * The OpenStreetMap door a pass is built with: the run's cache over its send,
 * and a note of what it touched so a failing door's answers can be taken back
 * — exactly those, and none on a run that never used the cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../wikidataCache.js', () => ({
  withCache: vi.fn((send: unknown) => send),
  forgetCached: vi.fn().mockResolvedValue(0),
}));
vi.mock('../osm/qleverOsm.js', () => ({
  qleverOsmDoor: vi.fn(() => ({
    name: 'qlever', question: vi.fn(), digsQuestions: vi.fn(), send: vi.fn(async () => []),
  })),
}));
vi.mock('../osm/overpassOsm.js', () => ({
  overpassOsmDoor: vi.fn(() => ({
    name: 'overpass', question: vi.fn(), digsQuestions: vi.fn(), send: vi.fn(async () => []),
  })),
}));

import { forgetCached, withCache } from '../wikidataCache.js';
import { doorsForAPass } from './runDoors.js';
import type { SyncProgress } from '../types.js';

const mockedForget = forgetCached as unknown as ReturnType<typeof vi.fn>;
const mockedWithCache = withCache as unknown as ReturnType<typeof vi.fn>;
const progress = { cancel: false, statusMessage: '' } as unknown as SyncProgress;
const OSM = { kind: 'osm' as const, label: 'OSM objects of 1 item' };

describe('doorsForAPass', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens the door it is named, behind this source\'s cache', () => {
    expect(doorsForAPass('qlever', progress, false).osm.name).toBe('qlever');
    expect(doorsForAPass('overpass', progress, false).osm.name).toBe('overpass');
    expect(mockedWithCache).toHaveBeenCalledWith(
      expect.any(Function), expect.objectContaining({ sourceId: 5, enabled: true }),
    );
  });

  it('takes back exactly the cached questions its door was asked, and no uncached one', async () => {
    const pass = doorsForAPass('qlever', progress, false);
    await pass.osm.send('batch 1', OSM);
    await pass.osm.send('digs', { kind: 'osm', label: 'every dig' });
    await pass.osm.send('a one-off question');

    await pass.forgetOsm();
    expect(mockedForget).toHaveBeenCalledWith(5, ['batch 1', 'digs']);
  });

  it('takes back nothing on a run started without the cache, which read and wrote no row', async () => {
    const pass = doorsForAPass('qlever', progress, true);
    await pass.osm.send('batch 1', OSM);

    await pass.forgetOsm();
    expect(mockedForget).toHaveBeenCalledWith(5, []);
  });
});

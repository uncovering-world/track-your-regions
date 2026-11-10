/**
 * What a place source's world tier keeps from one run to the next (ADR-0175
 * decision 6): the readers' bars of its last run that read a year, off that
 * run's sync log, and each membership's signals as the crowding step dated
 * them — the Kurobe Dam's 146,554 readers and three guides, read; a dam the
 * step ranked at zero before its first reading, not read.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../../db/index.js';
import { keepWorldBars, keptBarsOf, readWorldMemory } from './worldMemory.js';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => query.mockReset());

describe('keptBarsOf', () => {
  it('reads the readers\' bars a run recorded, naming the run that read them', () => {
    expect(keptBarsOf(812, { editions: 17, readers: 56_955, guidedReaders: 13_757, pool: 41_000, year: '2025-10 to 2026-09' }))
      .toEqual({ readers: 56_955, guidedReaders: 13_757, year: '2025-10 to 2026-09', logId: 812 });
    // Bars a run without a year kept name the run that first read them, so a second such run keeps them too.
    expect(keptBarsOf(900, { editions: 17, readers: 56_955, guidedReaders: 13_757, pool: 41_000, year: '2025-10 to 2026-09', keptFrom: 812 }))
      .toEqual({ readers: 56_955, guidedReaders: 13_757, year: '2025-10 to 2026-09', logId: 812 });
  });

  it('reads none from a run that read no year, or from a record it cannot read', () => {
    expect(keptBarsOf(812, { editions: 17, readers: null, guidedReaders: null, pool: 41_000 })).toBeNull();
    expect(keptBarsOf(812, null)).toBeNull();
    expect(keptBarsOf(812, { readers: '56955', guidedReaders: 13_757, year: '2025-10 to 2026-09' })).toBeNull();
  });
});

describe('readWorldMemory', () => {
  it('takes each membership\'s signals where they were read, and none where only a placeholder zero stands', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 812, world_bars: { editions: 17, readers: 56_955, guidedReaders: 13_757, pool: 41_000, year: '2025-10 to 2026-09' } }] })
      .mockResolvedValueOnce({ rows: [
        // The Kurobe Dam, both signals read.
        { external_id: 'Q1208749', readers: 146_554, guide_editions: 3, readers_read: true, guides_read: true },
        // Erfurt's Krämerbrücke, measured only while no usage build was in place: its guides' zero is no reading.
        { external_id: 'Q896890', readers: 54_022, guide_editions: 0, readers_read: true, guides_read: false },
        // A dam read by a build and no year: its readers' zero is no reading.
        { external_id: 'Q9002253', readers: 0, guide_editions: 0, readers_read: false, guides_read: true },
      ] })
      .mockResolvedValueOnce({ rows: [
        // Bauman Street, in by the venues around it; a street in by its readers, whose note names its cafés too.
        { external_id: 'Q1593247', note: 'In the surroundings tier by the venues around it: within 150 km, 805 places of its density: …' },
        { external_id: 'fixture-readers-street', note: 'In the surroundings tier by its readers: within 150 km, …; 5 cafés, restaurants and bars within 200 m of this place, …' },
      ] });
    const memory = await readWorldMemory(8);
    expect(memory.bars).toEqual({ readers: 56_955, guidedReaders: 13_757, year: '2025-10 to 2026-09', logId: 812 });
    expect([...memory.readers]).toEqual([['Q1208749', 146_554], ['Q896890', 54_022]]);
    expect([...memory.guided]).toEqual([['Q1208749', true], ['Q9002253', false]]);
    // The last real run of the source with a readers' bar, never a preview's.
    expect(query.mock.calls[0][0]).toMatch(/is_dry_run = FALSE/);
    expect(query.mock.calls[0][1]).toEqual([8]);
    expect(query.mock.calls[1][1]).toEqual([8]);
    // The places that last stood by the venue test (ADR-0192), read off the note each membership records.
    expect([...memory.venued!]).toEqual(['Q1593247']);
    expect(query.mock.calls[2][0]).toMatch(/facts->>'admissionNote'/);
  });

  it('holds no bars where no run of the source read a year', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await readWorldMemory(8)).toEqual({ bars: null, readers: new Map(), guided: new Map(), venued: new Set() });
  });
});

describe('keepWorldBars', () => {
  it('writes the bars on the run\'s own log, and nowhere for a run with none', async () => {
    query.mockResolvedValue({ rows: [] });
    const bars = { editions: 17, readers: 56_955, guidedReaders: 13_757, pool: 41_000, year: '2025-10 to 2026-09' };
    await keepWorldBars(901, bars);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/^UPDATE experience_sync_logs SET world_bars/), [901, JSON.stringify(bars)]);
    query.mockClear();
    await keepWorldBars(null, bars);
    expect(query).not.toHaveBeenCalled();
  });
});

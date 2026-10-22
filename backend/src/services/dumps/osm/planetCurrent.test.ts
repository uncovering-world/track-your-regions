import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextReader } from '../catalog.js';

/**
 * The planet brought current by its daily diffs (ADR-0134 decision 1), against
 * state files shaped as planet.openstreetmap.org served them on 2026-10-22:
 * diff 5143 ends 2026-10-12T00:00Z and diff 5153 ends 2026-10-22T00:00Z, and
 * the weekly planet of Monday 2026-10-12 is current to 2026-10-12T00:00:02Z.
 */

const downloaded: string[] = [];
const applied: string[][] = [];
vi.mock('../fetch.js', () => ({
  downloadTo: vi.fn(async (url: string, path: string) => {
    downloaded.push(url);
    writeFileSync(path, 'diff');
    return 4;
  }),
}));
vi.mock('./tools.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./tools.js')>(),
  runTool: vi.fn(async (_command: string, args: string[]) => {
    applied.push(args);
    writeFileSync(args[args.indexOf('-o') + 1], 'current planet');
    return { stdout: '', stderr: '', code: 0 };
  }),
}));

const { bringForward, CURRENT_PLANET, dailyState, firstDiffAfter, parseState, readCurrent, sequencePath } = await import('./planetCurrent.js');

/** Daily diff `n` ends at midnight UTC, 5143 on 2026-10-12. */
const endOf = (sequence: number) => new Date(Date.UTC(2026, 9, 12) + (sequence - 5143) * 86_400_000).toISOString().replace('.000', '');
const stateText = (sequence: number) => `#Thu Oct 22 00:18:38 UTC 2026\nsequenceNumber=${sequence}\ntimestamp=${endOf(sequence).replaceAll(':', '\\:')}\n`;
const asked: string[] = [];
const read: TextReader = async (url) => {
  asked.push(url);
  if (url.endsWith('/day/state.txt')) return stateText(5153);
  const match = /day\/(\d{3})\/(\d{3})\/(\d{3})\.state\.txt$/.exec(url);
  return stateText(Number(match!.slice(1).join('')));
};

let dir = '';
let work = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planet-'));
  work = mkdtempSync(join(tmpdir(), 'planet-cut-'));
  downloaded.length = 0;
  applied.length = 0;
  asked.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

describe('the daily replication', () => {
  it("places a diff in the replication tree, and refuses what is not a sequence", () => {
    expect(sequencePath(5153)).toBe('000/005/153');
    expect(sequencePath(1_234_567)).toBe('001/234/567');
    expect(() => sequencePath(-1)).toThrow('Refusing');
    expect(() => sequencePath(1.5)).toThrow('Refusing');
  });

  it('reads a state file as osmosis writes it, escaped colons and all', () => {
    expect(parseState(stateText(5153))).toEqual({ sequence: 5153, timestamp: '2026-10-22T00:00:00.000Z' });
    expect(() => parseState('<html>maintenance</html>')).toThrow('Not a replication state');
  });

  it('finds the first diff after the weekly planet: 5144 for the planet of Monday 2026-10-12', async () => {
    const newest = await dailyState(read);
    expect(await firstDiffAfter('2026-10-12T00:00:02.000Z', newest, read)).toBe(5144);
    expect(asked).toContain('https://planet.openstreetmap.org/replication/day/000/005/144.state.txt');
    expect(asked).toContain('https://planet.openstreetmap.org/replication/day/000/005/143.state.txt');
  });

  it('finds the diff after an instant that falls exactly on a diff\'s end', async () => {
    expect(await firstDiffAfter('2026-10-12T00:00:00.000Z', await dailyState(read), read)).toBe(5144);
  });

  it('walks past days a paused replication skipped, however many', async () => {
    // Diffs 5144-5148 all end on 2026-10-12 and 5149 on 2026-10-18: the estimate lands on 5145, four diffs short.
    const paused: TextReader = async (url) => {
      if (url.endsWith('/day/state.txt')) return stateText(5153);
      const sequence = Number(/day\/(\d{3})\/(\d{3})\/(\d{3})\.state\.txt$/.exec(url)!.slice(1).join(''));
      // Up to 5148 a diff ends on 2026-10-12 at the latest; from 5149 on, a day each from 2026-10-18.
      const day = sequence < 5149 ? Math.min(sequence - 5143, 0) : sequence - 5143;
      return `sequenceNumber=${sequence}\ntimestamp=${new Date(Date.UTC(2026, 9, 12) + day * 86_400_000).toISOString().replace('.000', '').replaceAll(':', '\\:')}\n`;
    };
    expect(await firstDiffAfter('2026-10-13T00:00:02.000Z', await dailyState(paused), paused)).toBe(5149);
  });

  it('answers past the newest diff for a planet already current to it', async () => {
    expect(await firstDiffAfter('2026-10-22T00:00:00.000Z', await dailyState(read), read)).toBe(5154);
  });
});

describe('bringing the planet forward', () => {
  it('applies every diff from the first to the newest in one pass, and keeps the current planet with its state', async () => {
    writeFileSync(join(dir, 'planet-261012.osm.pbf'), 'weekly planet');
    const newest = { sequence: 5153, timestamp: endOf(5153) };
    const result = await bringForward(join(dir, 'planet-261012.osm.pbf'), 5144, 'planet-261012.osm.pbf', newest,
      { dir, work, signal: new AbortController().signal, onPhase: () => undefined });
    expect(downloaded).toHaveLength(10);
    expect(downloaded[0]).toBe('https://planet.openstreetmap.org/replication/day/000/005/144.osc.gz');
    expect(applied).toHaveLength(1);
    expect(applied[0].slice(0, 2)).toEqual(['apply-changes', join(dir, 'planet-261012.osm.pbf')]);
    expect(applied[0].filter(arg => arg.endsWith('.osc.gz'))).toHaveLength(10);
    expect(result).toMatchObject({ path: join(dir, CURRENT_PLANET), applied: 10, bytes: 40, state: { sequence: 5153, base: 'planet-261012.osm.pbf' } });
    expect(readFileSync(join(dir, CURRENT_PLANET), 'utf8')).toBe('current planet');
    expect(await readCurrent(dir)).toEqual({ sequence: 5153, timestamp: '2026-10-22T00:00:00Z', base: 'planet-261012.osm.pbf' });
  });

  it('makes a planet with nothing newer to apply the current one, unchanged', async () => {
    writeFileSync(join(dir, 'planet-261019.osm.pbf'), 'weekly planet');
    const result = await bringForward(join(dir, 'planet-261019.osm.pbf'), 5154, 'planet-261019.osm.pbf', { sequence: 5153, timestamp: endOf(5153) },
      { dir, work, signal: new AbortController().signal, onPhase: () => undefined });
    expect(result.applied).toBe(0);
    expect(downloaded).toEqual([]);
    expect(readFileSync(join(dir, CURRENT_PLANET), 'utf8')).toBe('weekly planet');
    expect(existsSync(join(dir, 'planet-261019.osm.pbf'))).toBe(false);
    expect(await readCurrent(dir)).toMatchObject({ sequence: 5153 });
  });

  it('knows no current planet where its file or its state is missing', async () => {
    expect(await readCurrent(dir)).toBeNull();
    writeFileSync(join(dir, 'planet-current.state.json'), JSON.stringify({ sequence: 5153, timestamp: endOf(5153), base: 'planet-261012.osm.pbf' }));
    expect(await readCurrent(dir)).toBeNull();
  });
});

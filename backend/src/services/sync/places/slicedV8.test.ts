import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSliced, writeSliced } from './slicedV8.js';

describe('a large value written and read in slices (#2424)', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sliced-'));
    file = join(dir, 'pool.v8');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const pool = () => ({
    keptAt: '2026-11-11T05:19:00.000Z',
    value: {
      rows: new Map(['Q243', 'Q41225', 'Q770631', 'Q463400', 'Q12518'].map((qid, i) => [qid, { qid, readers: i, classes: ['Q12518'] }])),
      around: new Map([['all', new Map([['Q243', { near: new Float64Array([1, 2]) }], ['Q41225', { near: new Float64Array([3]) }], ['Q770631', { near: new Float64Array([]) }]])]]),
      shares: [['towers', { pool: new Map([['Q243', {}], ['Q41225', {}], ['Q12518', {}]]), byId: new Set(['Q243']) }]],
      seconds: 900,
    },
  });

  it('gives back the same value, its large Maps whole and in order, its small ones and everything else as they were', async () => {
    await writeSliced(file, pool(), 2);
    expect(await readSliced(file)).toEqual(pool());
  });

  it('refuses a file cut short, rather than giving back a smaller value', async () => {
    await writeSliced(file, pool(), 2);
    const bytes = await readFile(file);
    await writeFile(file, bytes.subarray(0, bytes.length - 3));
    await expect(readSliced(file)).rejects.toThrow(/ends before the value/);
  });

  it('writes a Map held in two places once and gives it back as one Map', async () => {
    const nodes = new Map([['Q243', 1], ['Q41225', 2], ['Q12518', 3]]);
    await writeSliced(file, { worship: { containers: nodes }, publicArt: { containers: nodes } }, 2);
    const read = await readSliced(file) as { worship: { containers: unknown }; publicArt: { containers: unknown } };
    expect(read.worship.containers).toBe(read.publicArt.containers);
    expect(read.worship.containers).toEqual(nodes);
  });
});


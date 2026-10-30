/**
 * Archaeology's finds and the year's readers: a find under the finds' line its
 * readers carry counts as one at it (ADR-0164), and the finds under the works
 * pool's floor the year reads at that bar join the pool (ADR-0165). The
 * fixture is `pipelineFixture.ts`'s, the Delphi museum and its two finds.
 */

import { describe, it, expect } from 'vitest';
import type { CollectedArchaeology } from './pipeline.js';
import { collect, item, world, type World } from './pipelineFixture.js';

const treasuresOf = (out: CollectedArchaeology, qid: string) =>
  (item(out, qid)?.treasures ?? []).map((t) => t.externalId);

describe('the finds readership door (ADR-0164)', () => {
  // The Charioteer under the finds' line: Delphi's museum, under the place line
  // too, is then in by nothing but what the world reads of its find.
  const underTheLine = (): World => {
    const w = world();
    w.finds.Q1230882.sitelinks = 16;
    return w;
  };
  const door = {
    opened: new Map([['Q1230882', { views: 61_204, burst: false }]]),
    bar: 26_222,
    exit: 19_984,
  };

  it('leaves a museum out whose only find is under the line, with no door', async () => {
    expect(item(await collect(underTheLine()), 'Q636928')).toBeUndefined();
  });

  it('admits it for a find its readers carry, badges the find and tells the curator why', async () => {
    const asked: string[][] = [];
    const out = await collect(underTheLine(), {
      openFindsDoor: (works) => {
        asked.push(works.map((work) => work.qid));
        return Promise.resolve(door);
      },
    });
    // The door is asked once, over the whole finds pool.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Q1230882');

    const delphi = item(out, 'Q636928');
    expect(delphi?.admittedFor).toEqual({ qid: 'Q1230882', label: 'Charioteer of Delphi' });
    expect(delphi?.findsAboveLine).toBe(1);
    expect(delphi?.treasures.find((t) => t.externalId === 'Q1230882')?.readIconic).toBe(true);
    expect(delphi?.admissionNote).toContain('read 61,204 times this year');
    expect(delphi?.admissionNote).toContain('the readership door\'s bar is 26,222');
  });
});

describe('the finds under the works pool\'s floor (ADR-0165)', () => {
  const door = {
    opened: new Map([['Q19726392', { views: 40_238, burst: false }]]),
    bar: 27_180,
    exit: 20_576,
  };

  it('never meets a find under the floor that only the year reads, with no under-floor read', async () => {
    const out = await collect(world(), { openFindsDoor: () => Promise.resolve(door) });
    expect(treasuresOf(out, 'Q636928')).not.toContain('Q19726392');
  });

  it('reads it by id into the pool, where it is placed and badged as any find', async () => {
    const asked: string[][] = [];
    const out = await collect(world(), {
      openFindsDoor: () => Promise.resolve(door),
      underFloorFinds: (finds) => {
        asked.push(finds.map((find) => find.qid));
        return Promise.resolve(['Q19726392', 'Q900830', 'Q1230882']);
      },
    });
    // Asked over the kept pool, which the Omphalos is not in.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Q1230882');
    expect(asked[0]).not.toContain('Q19726392');
    const omphalos = item(out, 'Q636928')?.treasures.find((t) => t.externalId === 'Q19726392');
    expect(omphalos?.readIconic).toBe(true);
    expect(omphalos?.sitelinksCount).toBe(5);
    // A joiner goes through the find rule as any pool work does: a statue of
    // 1850 with no find spot is read in full and then refused.
    expect(treasuresOf(out, 'Q636928')).not.toContain('Q900830');
  });
});

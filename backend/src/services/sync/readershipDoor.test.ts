import { describe, expect, it } from 'vitest';
import {
  doorOf, doorNote, percentile, type ReadershipDoor,
} from './readershipDoor.js';
import { ART_MUSEUM_DOOR } from './museum/tier1.js';

/**
 * ADR-0056's door, on the world tier drawn small: four works at the line of
 * 22 read 100, 200, 300 and 400 thousand times a year, so the bar (the median)
 * is 250,000 and the exit (the 35th percentile) 205,000.
 */
const tier = [
  { qid: 'Q1', sitelinks: 40 },
  { qid: 'Q2', sitelinks: 30 },
  { qid: 'Q3', sitelinks: 25 },
  { qid: 'Q4', sitelinks: 22 },
];
const tierViews: Array<[string, number]> = [['Q1', 400_000], ['Q2', 300_000], ['Q3', 200_000], ['Q4', 100_000]];
const VEILED_CHRIST = 'Q3697674';

describe('percentile', () => {
  it('interpolates between ranks, and has nothing to say of an empty tier', () => {
    expect(percentile([100, 200, 300, 400], 0.5)).toBe(250);
    expect(percentile([100, 200, 300, 400], 0.35)).toBeCloseTo(205);
    expect(percentile([], 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the readership door (ADR-0056)', () => {
  it('opens for a work below the line read at the tier median or over, and not for one under it', () => {
    const views = new Map([...tierViews, [VEILED_CHRIST, 276_677], ['Q5', 240_000]]);
    const works = [...tier, { qid: VEILED_CHRIST, sitelinks: 18 }, { qid: 'Q5', sitelinks: 15 }];
    const door = doorOf(works, views, 22, new Set(), new Set());
    expect(door.bar).toBe(250_000);
    expect([...door.opened]).toEqual([[VEILED_CHRIST, 276_677]]);
  });

  it("reads a source's own percentiles: Art Museums' 12th and 8th open what the median does not (ADR-0162)", () => {
    const views = new Map([...tierViews, ['Q5', 140_000], ['Q6', 130_000], ['Q7', 130_000]]);
    const works = [...tier, { qid: 'Q5', sitelinks: 15 }, { qid: 'Q6', sitelinks: 15 }, { qid: 'Q7', sitelinks: 15 }];
    expect(doorOf(works, views, 22, new Set(), new Set()).opened.size).toBe(0);
    const door = doorOf(works, views, 22, new Set(['Q6']), new Set(), ART_MUSEUM_DOOR);
    expect(door.bar).toBe(136_000);
    expect(door.exit).toBe(124_000);
    // Q5 clears the bar; Q6 is Iconic now and holds at the exit; Q7 is new and under the bar.
    expect([...door.opened.keys()]).toEqual(['Q5', 'Q6']);
  });

  it('keeps a work Iconic now down to the exit, and lets it go below', () => {
    const works = [...tier, { qid: 'Q5', sitelinks: 15 }, { qid: 'Q6', sitelinks: 15 }];
    const views = new Map([...tierViews, ['Q5', 210_000], ['Q6', 200_000]]);
    const door = doorOf(works, views, 22, new Set(['Q5', 'Q6']), new Set());
    expect([...door.opened.keys()]).toEqual(['Q5']);
  });

  it('opens nothing for a work another kind already shows a reader', () => {
    const views = new Map([...tierViews, [VEILED_CHRIST, 276_677]]);
    const door = doorOf([...tier, { qid: VEILED_CHRIST, sitelinks: 18 }], views, 22, new Set(), new Set([VEILED_CHRIST]));
    expect(door.opened.size).toBe(0);
  });

  it('reads the bar over the tier works that were read, so an unread one does not lower it', () => {
    const views = new Map([...tierViews, ['Q5', 240_000]]);
    const door = doorOf([...tier, { qid: 'Q0', sitelinks: 50 }, { qid: 'Q5', sitelinks: 15 }], views, 22, new Set(), new Set());
    expect(door.bar).toBe(250_000);
    expect(door.opened.size).toBe(0);
  });

  it('names the work, its year and the bar to the curator, and the burst where there is one', () => {
    const door: ReadershipDoor = { opened: new Map(), bar: 133_366, exit: 88_364 };
    const note = doorNote('Veiled Christ', { views: 276_677, burst: false }, door);
    expect(note).toBe('Admitted for Veiled Christ, below the sitelinks line but read 276,677 times this year in every '
      + "counted edition (the readership door's bar is 133,366). Can a visitor see it there now?");
    expect(doorNote('Veiled Christ', { views: 276_677, burst: true }, door)).toContain('its year is a burst');
  });

  it("names a source's own bar as the door's, never as the tier's median (ADR-0162)", () => {
    // Art Museums' bar is the 12th percentile, 48,323 on the dump of 2026-10-19; the median is 142,750.
    const door: ReadershipDoor = { opened: new Map(), bar: 48_323, exit: 41_248 };
    const note = doorNote('Young Hare', { views: 127_000, burst: false }, door);
    expect(note).toContain("(the readership door's bar is 48,323)");
    expect(note).not.toContain('median');
  });
});

import { describe, expect, it } from 'vitest';
import { doorOf, doorNote, fewWitnessesReason, percentile, placeDoorNote, type ReadershipDoor } from './readershipDoor.js';

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
      + "counted edition (the world tier's median is 133,366). Can a visitor see it there now?");
    expect(doorNote('Veiled Christ', { views: 276_677, burst: true }, door)).toContain('its year is a burst');
  });

  it('asks the curator of a place the door alone admitted whether a visitor goes to see it (ADR-0127)', () => {
    const door: ReadershipDoor = { opened: new Map(), bar: 75_745, exit: 49_638 };
    expect(placeDoorNote({ views: 100_106, burst: false }, door)).toBe('Admitted below the sitelinks line, read 100,106 '
      + "times this year in every counted edition (the median of this kind's places at the line is 75,745). "
      + 'Is it a place a visitor goes to see?');
    expect(placeDoorNote({ views: 100_106, burst: true }, door)).toContain('its year is a burst');
  });
  it('names the witnesses a place the door admits has, and why one with fewer stays out (ADR-0128)', () => {
    const door: ReadershipDoor = { opened: new Map(), bar: 75_178, exit: 50_844 };
    expect(placeDoorNote({ views: 175_000, burst: false }, door, ['guide', 'photos', 'formal'])).toBe('Admitted below the '
      + "sitelinks line, read 175,000 times this year in every counted edition (the median of this kind's places at the "
      + "line is 75,178). A travel guide, photographs taken there and Wikidata's heritage, hours, visitors or website say "
      + 'a visitor goes there. Is it a place a visitor goes to see?');
    expect(fewWitnessesReason({ views: 95_000, burst: false }, door, [])).toBe('Read 95,000 times this year in every '
      + "counted edition, over the readership door's bar of 75,178, but no witness says a visitor goes there; the door "
      + "asks for 2 of 4: a travel guide, photographs taken there, Wikidata's heritage, hours, visitors or website and the map");
    expect(fewWitnessesReason({ views: 60_000, burst: false }, door, ['photos'])).toContain(
      'over the exit of 50,844 that keeps a place the source holds, but only one witness says a visitor goes there (photographs taken there)',
    );
  });
});

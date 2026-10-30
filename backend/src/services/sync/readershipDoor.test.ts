import { describe, expect, it } from 'vitest';
import {
  artworkDoorNote, DOOR_PERCENTILES, doorOf, doorNote, fewWitnessesReason, percentile, placeDoorNote, type ReadershipDoor,
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

  it('asks the curator of a place the door alone admitted whether a visitor goes to see it (ADR-0127)', () => {
    const door: ReadershipDoor = { opened: new Map(), bar: 75_745, exit: 49_638 };
    expect(placeDoorNote({ views: 100_106, burst: false }, door)).toBe('Admitted below the sitelinks line, read 100,106 '
      + "times this year in every counted edition, over the readership door's bar of 75,745. "
      + 'Is it a place a visitor goes to see?');
    expect(placeDoorNote({ views: 100_106, burst: true }, door)).toContain('its year is a burst');
  });
  it('opens for a place a guide uses at its own lower bar, and says so to the curator (ADR-0163)', () => {
    // The Roman Agora of Athens: 19 editions, 47,207 readers, four Wikivoyage editions use its item.
    const AGORA = 'Q1435551';
    const views = new Map([...tierViews, [AGORA, 140_000], ['Q8', 140_000]]);
    const places = [...tier, { qid: AGORA, sitelinks: 19 }, { qid: 'Q8', sitelinks: 19 }];
    const door = doorOf(places, views, 22, new Set(), new Set(), DOOR_PERCENTILES,
      { items: new Set([AGORA]), percentiles: { enter: 0.12, stay: 0.08 } });
    expect(door.bar).toBe(250_000);
    expect(door.guidedBar).toBe(136_000);
    // The place a guide uses is in; the one with the same reading and no guide is not.
    expect([...door.opened.keys()]).toEqual([AGORA]);
    expect(placeDoorNote({ views: 140_000, burst: false, guided: true }, { ...door, opened: new Map() }))
      .toContain('over the bar of 136,000 for a place a Wikivoyage guide uses');
  });

  it('reads a held place no guide uses against the plain exit, never the guide\'s bar (ADR-0163)', () => {
    // A held site at 140,000, under the bar of 250,000 and over the exit, that no guide uses.
    const door: ReadershipDoor = { opened: new Map(), bar: 250_000, exit: 135_000, guidedBar: 136_000, guidedExit: 124_000 };
    const note = placeDoorNote({ views: 140_000, burst: false }, door);
    expect(note).toContain('over the exit of 135,000 that keeps a place the source holds');
    expect(note).not.toContain('Wikivoyage');
  });

  it('names the witnesses a place the door admits has, and why one with fewer stays out (ADR-0128)', () => {
    const door: ReadershipDoor = { opened: new Map(), bar: 75_178, exit: 50_844 };
    expect(placeDoorNote({ views: 175_000, burst: false }, door, ['guide', 'photos', 'formal'])).toBe('Admitted below the '
      + "sitelinks line, read 175,000 times this year in every counted edition, over the readership door's bar of "
      + "75,178. A travel guide, photographs taken there and Wikidata's heritage, hours, visitors or website say "
      + 'a visitor goes there. Is it a place a visitor goes to see?');
    expect(fewWitnessesReason({ views: 95_000, burst: false }, door, [])).toBe('Read 95,000 times this year in every '
      + "counted edition, over the readership door's bar of 75,178, but no witness says a visitor goes there; the door "
      + "asks for 2 of 4: a travel guide, photographs taken there, Wikidata's heritage, hours, visitors or website and the map");
    expect(fewWitnessesReason({ views: 60_000, burst: false }, door, ['photos'])).toContain(
      'over the exit of 50,844 that keeps a place the source holds, but only one witness says a visitor goes there (photographs taken there)',
    );
  });

  it('asks the curator of a work the door alone admitted whether it stands there now, naming the bar or the exit (#2033)', () => {
    // Public art's bar and exit over the works it held at the line on 2026-10-25.
    const door: ReadershipDoor = { opened: new Map(), bar: 115_121, exit: 76_328 };
    expect(artworkDoorNote({ views: 193_801, burst: false }, door)).toBe('Admitted below the sitelinks line, read '
      + "193,801 times this year in every counted edition, over the readership door's bar of 115,121. "
      + 'Can a visitor see it there now?');
    expect(artworkDoorNote({ views: 80_000, burst: true }, door)).toBe('Admitted below the sitelinks line, read '
      + '80,000 times this year in every counted edition, over the exit of 76,328 that keeps a place '
      + 'the source holds; its year is a burst (a quarter in one week, or months that swing), so check the reading holds. '
      + 'Can a visitor see it there now?');
  });
});

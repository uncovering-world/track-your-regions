import { describe, expect, it } from 'vitest';
import { chooseItemCoordinate, spreadOf, type CoordinateEvidence, type ItemPoint } from './itemCoordinate.js';

/**
 * Which of an item's coordinates a run writes for the place (ADR-0204), on the
 * development catalogue's cases of 2026-11-13.
 */

const none = (n: number): Array<number | null> => Array.from({ length: n }, () => null);
const evidence = (n: number, given: Partial<CoordinateEvidence> = {}): CoordinateEvidence => ({
  outlineM: none(n), otherViewM: none(n), shownM: none(n), reportedM: none(n), ...given,
});

// Messene (Q1022117): Mavromati, inside the excavation's outline, and a bot's point 15 km off.
const MAVROMATI: ItemPoint = { lat: 37.175, lon: 21.92 };
const BOT: ItemPoint = { lat: 37.05, lon: 22 };

describe('an item with one coordinate', () => {
  it('is written as it is', () => {
    expect(chooseItemCoordinate([MAVROMATI], evidence(1))).toMatchObject({ point: MAVROMATI, basis: 'one', undecided: false });
  });
});

describe('coordinates within a short move of each other', () => {
  // San Ignacio Miní (Q868799): two statements 17 m apart.
  const a = { lat: -27.2554, lon: -55.5326 };
  const b = { lat: -27.2555, lon: -55.5327 };

  it('keep the one the place shows, and ask nobody', () => {
    const choice = chooseItemCoordinate([a, b], evidence(2, { shownM: [0, 17] }));
    expect(choice).toMatchObject({ point: a, basis: 'close', undecided: false });
  });

  it('take the first, the smaller latitude, where the place shows neither', () => {
    expect(chooseItemCoordinate([a, b], evidence(2)).point).toEqual(b);
  });
});

describe('coordinates far apart', () => {
  it('take the one inside the place\'s outline, wherever the place stands now', () => {
    const choice = chooseItemCoordinate([BOT, MAVROMATI], evidence(2, {
      outlineM: [15176, 0], shownM: [0, 15605], reportedM: [0, 15605],
    }));
    expect(choice).toMatchObject({ point: MAVROMATI, basis: 'outline', undecided: false });
    expect(choice.spreadM).toBeGreaterThan(15000);
  });

  it('read nothing from an outline more than a kilometre from both, which is another thing\'s', () => {
    // Smyrna (Q1379299): the outline held stands 5 km from either coordinate.
    const agora = { lat: 38.4186, lon: 27.1428 };
    const north = { lat: 38.4239, lon: 27.1428 };
    const choice = chooseItemCoordinate([north, agora], evidence(2, { outlineM: [4912, 5424], shownM: [589, 0], reportedM: [589, 0] }));
    expect(choice).toMatchObject({ point: agora, basis: 'reported', undecided: true });
  });

  it('take the one nearest another source\'s view where no outline decides', () => {
    const choice = chooseItemCoordinate([BOT, MAVROMATI], evidence(2, { otherViewM: [15600, 40] }));
    expect(choice).toMatchObject({ point: MAVROMATI, basis: 'other-view', undecided: false });
  });

  it('read nothing from a view farther than a short move from every coordinate', () => {
    // Poverty Point (Q964745): both coordinates inside the outline, 706 m apart, and the
    // World Heritage coordinate between them, 471 m from one and 643 m from the other.
    const north = { lat: 32.6425, lon: -91.408333333333 };
    const south = { lat: 32.6367, lon: -91.4114 };
    const choice = chooseItemCoordinate([north, south], evidence(2, {
      outlineM: [0, 0], otherViewM: [643, 471], shownM: [643, 471], reportedM: [0, 705],
    }));
    expect(choice).toMatchObject({ point: north, basis: 'reported', undecided: true });
    const far = chooseItemCoordinate([BOT, MAVROMATI], evidence(2, { otherViewM: [55000, 56000] }));
    expect(far).toMatchObject({ basis: 'first', undecided: true });
  });

  it('go on to the views where both stand inside the outline', () => {
    // Larsa (Q244746): both coordinates inside the tell's outline, 459 m apart.
    const a = { lat: 31.2833, lon: 45.8498 };
    const b = { lat: 31.2858, lon: 45.8536 };
    const choice = chooseItemCoordinate([a, b], evidence(2, { outlineM: [0, 0], otherViewM: [900, 20] }));
    expect(choice).toMatchObject({ point: b, basis: 'other-view' });
  });

  it('keep the one the run reported last where nothing decides, so a proposed move stays the curator\'s question', () => {
    // Myra (Q652024): the place shows Demre, the run proposed the theatre.
    const demre = { lat: 36.2508, lon: 29.9936 };
    const theatre = { lat: 36.2592, lon: 29.9853 };
    const choice = chooseItemCoordinate([demre, theatre], evidence(2, { shownM: [0, 1195], reportedM: [1195, 0] }));
    expect(choice).toMatchObject({ point: theatre, basis: 'reported', undecided: true });
  });

  it('keep the one the place shows where the run reported neither', () => {
    const choice = chooseItemCoordinate([BOT, MAVROMATI], evidence(2, { shownM: [0, 15605] }));
    expect(choice).toMatchObject({ point: BOT, basis: 'shown', undecided: true });
  });

  it('take the first, never the more finely written, where the place is new', () => {
    const choice = chooseItemCoordinate([MAVROMATI, BOT], evidence(2));
    expect(choice).toMatchObject({ point: BOT, basis: 'first', undecided: true });
  });
});

describe('the spread of an item\'s coordinates', () => {
  it('is the greatest distance between two of them', () => {
    expect(spreadOf([MAVROMATI])).toBe(0);
    expect(Math.round(spreadOf([BOT, MAVROMATI]) / 100) / 10).toBe(15.6);
  });
});

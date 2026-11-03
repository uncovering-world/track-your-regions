import { describe, expect, it } from 'vitest';
import { groupLabel, labelBox, labelSides, pinGroups, SAME_POINT_PX } from './pinLayout';

const SIZE = { width: 120, height: 20 };

describe('pins that stand on one point (#2273)', () => {
  it('are one group, in order, and pins a pin apart are two', () => {
    // The cathedral, its article on the same metre, the Historic Centre 30 px away.
    expect(pinGroups([{ x: 100, y: 100 }, { x: 140, y: 80 }, { x: 100, y: 100 }])).toEqual([[0, 2], [1]]);
    expect(pinGroups([{ x: 0, y: 0 }, { x: SAME_POINT_PX, y: 0 }])).toEqual([[0, 1]]);
    expect(pinGroups([{ x: 0, y: 0 }, { x: SAME_POINT_PX + 1, y: 0 }])).toEqual([[0], [1]]);
  });

  it('carry one label that names each of them, an article by its point', () => {
    expect(groupLabel(['Cathedral of Santiago de Compostela (this card)', 'Wikipedia']))
      .toBe("Cathedral of Santiago de Compostela (this card), and Wikipedia's point");
    expect(groupLabel(['Bisotun (this card)', 'Wikipedia: Behistun Inscription']))
      .toBe("Bisotun (this card), and Wikipedia's point for Behistun Inscription");
    expect(groupLabel(['Wikidata', 'UNESCO', 'Wikipedia'])).toBe("Wikidata, and UNESCO, and Wikipedia's point");
    expect(groupLabel(['Durham Cathedral'])).toBe('Durham Cathedral');
    // What follows a name the map may cut short, drawn after it.
    expect(groupLabel(['', 'Wikipedia'])).toBe(", and Wikipedia's point");
    expect(groupLabel([''])).toBe('');
  });
});

describe('labels that never cover each other or another pin (#2273)', () => {
  it('hang under their pin where nothing is there', () => {
    expect(labelSides([{ x: 100, y: 100 }, { x: 400, y: 100 }], [SIZE, SIZE])).toEqual(['bottom', 'bottom']);
  });

  it('move to another side of their pin where the side under it is taken', () => {
    // The Historic Centre 30 px north-west of the cathedral: under it the cathedral's
    // pin and label stand, so its label goes above.
    const sides = labelSides([{ x: 200, y: 200 }, { x: 170, y: 190 }], [SIZE, SIZE]);
    expect(sides[0]).toBe('bottom');
    expect(sides[1]).not.toBe('bottom');
    const boxes = sides.map((side, index) => labelBox([{ x: 200, y: 200 }, { x: 170, y: 190 }][index], SIZE, side));
    const [a, b] = boxes;
    expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false);
  });

  it('stay on the map: a label that would leave the canvas goes to another side', () => {
    // A pin framed 90 px from the left edge, with a 290 px label: under it, half the label
    // would be cut by the canvas; to its right it fits.
    const sides = labelSides([{ x: 90, y: 200 }], [{ width: 290, height: 20 }], { width: 885, height: 420 });
    expect(sides).toEqual(['right']);
  });

  it('place no label of no width, and leave its pin in the way of the others', () => {
    // A move's proposed point, drawn by the caller and unlabelled, with an article's pin 30 px off.
    const sides = labelSides([{ x: 200, y: 200 }, { x: 200, y: 170 }], [{ width: 0, height: 0 }, SIZE]);
    expect(sides[1]).not.toBe('bottom');
  });

  it('take the side that covers least where every side is taken', () => {
    const crowd = [{ x: 100, y: 100 }, { x: 100, y: 130 }, { x: 100, y: 50 }, { x: 160, y: 80 }, { x: 40, y: 80 }];
    expect(labelSides(crowd, crowd.map(() => SIZE))).toHaveLength(5);
  });
});

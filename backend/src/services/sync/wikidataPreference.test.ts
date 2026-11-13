import { describe, expect, it } from 'vitest';
import { applyPreferred, foldPreferred, preferredCoordinate, preferredPicture } from './wikidataUtils.js';

/**
 * The one picture and the one coordinate every Wikidata reader keeps of an
 * item that carries several at its best rank (#1246).
 */

const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/';

describe('the picture every reader keeps', () => {
  it('is the first by its Commons URL, in either order — the one UNESCO\'s MIN(?img) takes', () => {
    // Gol Stave Church (Q1513478): a winter and a summer photograph.
    const winter = `${COMMONS}Gol%20stavkirke%2C%20vinter.JPG`;
    const summer = `${COMMONS}00%204612%20Gol%20stavkirke.jpg`;
    expect(preferredPicture(winter, summer)).toBe(summer);
    expect(preferredPicture(summer, winter)).toBe(summer);
  });

  it('is the one there is where the other side has none', () => {
    expect(preferredPicture(null, 'a.jpg')).toBe('a.jpg');
    expect(preferredPicture('a.jpg', '')).toBe('a.jpg');
    expect(preferredPicture(null, null)).toBeNull();
  });
});

describe('the coordinate a reader keeps before it knows the place (ADR-0204)', () => {
  // Messene (Q1022117): Mavromati to three decimals, and a bot's point 15 km off to two.
  const mavromati = 'Point(21.92 37.175)';
  const bot = 'Point(22 37.05)';

  it('reads nothing into how finely far-apart coordinates are written: the smaller latitude, in either order', () => {
    expect(preferredCoordinate([mavromati, bot])).toBe(bot);
    expect(preferredCoordinate([bot, mavromati])).toBe(bot);
  });

  it('takes the more finely written of two writings of one spot, within a short move', () => {
    // Maman in Minato written twice, once rounded: 120 m apart.
    expect(preferredCoordinate(['Point(139.73 35.66)', 'Point(139.7296602 35.6610104)'])).toBe('Point(139.7296602 35.6610104)');
    expect(preferredCoordinate(['Point(139.7296602 35.6610104)', 'Point(139.73 35.66)'])).toBe('Point(139.7296602 35.6610104)');
  });

  it('keeps one answer for three points whatever order they arrive in, where only neighbours are one spot', () => {
    // Each 211 m from the middle one, 424 m from each other: the first by latitude and its one spot.
    const south = 'Point(0 10.001)';
    const middle = 'Point(0 10.0029)';
    const north = 'Point(0 10.00481234)';
    const orders = [
      [south, middle, north], [south, north, middle], [middle, south, north],
      [middle, north, south], [north, south, middle], [north, middle, south],
    ];
    expect(new Set(orders.map(order => preferredCoordinate(order)))).toEqual(new Set([middle]));
  });

  it('breaks a tie of latitude by the smaller longitude', () => {
    expect(preferredCoordinate(['Point(10.2 50.4)', 'Point(10.1 50.4)'])).toBe('Point(10.1 50.4)');
  });

  it('keeps one that parses over one that does not, and either over none', () => {
    expect(preferredCoordinate(['nowhere', mavromati])).toBe(mavromati);
    expect(preferredCoordinate([null, bot])).toBe(bot);
    expect(preferredCoordinate([mavromati, null])).toBe(mavromati);
  });

  it('keeps a point on this planet over one written on another globe, in either order', () => {
    // Fallen Astronaut's coordinate carries the Moon's IRI in front of it.
    const earth = 'Point(-3.61 26.13)';
    const moon = '<http://www.wikidata.org/entity/Q405> Point(-3.6 26.1)';
    expect(preferredCoordinate([earth, moon])).toBe(earth);
    expect(preferredCoordinate([moon, earth])).toBe(earth);
  });
});

describe("every picture an item's rows offered (#1778)", () => {
  it('is kept beside the one every reader keeps, once each and in URL order, and written onto the entry', () => {
    const b = 'http://commons.wikimedia.org/wiki/Special:FilePath/B.jpg';
    const a = 'http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg';
    let kept = foldPreferred(undefined, b, null);
    kept = foldPreferred(kept, null, null);
    kept = foldPreferred(kept, a, null);
    kept = foldPreferred(kept, b, null);
    expect(kept.imageUrl).toBe(a);
    expect(kept.pictures).toEqual([a, b]);

    const entry = { imageUrl: null as string | null, itemPictures: [] as readonly string[], lat: null, lon: null };
    applyPreferred(new Map([['Q1', entry]]), new Map([['Q1', kept]]));
    expect(entry.itemPictures).toEqual([a, b]);
  });
});


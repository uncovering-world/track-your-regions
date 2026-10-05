import { describe, expect, it } from 'vitest';
import { preferredCoordinate, preferredPicture } from './wikidataUtils.js';

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

describe('the coordinate every reader keeps', () => {
  // Cave of Altamira (Q133575): to the arc-second, and rounded to the arc-minute.
  const precise = 'Point(-4.11975 43.376944444444)';
  const rounded = 'Point(-4.11667 43.38333)';

  it('is the more precisely written, in either order', () => {
    expect(preferredCoordinate(precise, rounded)).toBe(precise);
    expect(preferredCoordinate(rounded, precise)).toBe(precise);
  });

  it('breaks a tie of precision by the smaller latitude, then longitude', () => {
    expect(preferredCoordinate('Point(10 50.5)', 'Point(10 50.4)')).toBe('Point(10 50.4)');
    expect(preferredCoordinate('Point(10.2 50.4)', 'Point(10.1 50.4)')).toBe('Point(10.1 50.4)');
  });

  it('keeps one that parses over one that does not, and either over none', () => {
    expect(preferredCoordinate('nowhere', precise)).toBe(precise);
    expect(preferredCoordinate(null, rounded)).toBe(rounded);
    expect(preferredCoordinate(precise, null)).toBe(precise);
  });

  it('decides one point written on two globes by its text, in either order', () => {
    const earth = 'Point(-3.6 26.1)';
    const moon = '<http://www.wikidata.org/entity/Q405> Point(-3.6 26.1)';
    expect(preferredCoordinate(earth, moon)).toBe(preferredCoordinate(moon, earth));
  });

  it('reads a point on another globe by its own digits', () => {
    // Fallen Astronaut's coordinate carries the Moon's IRI in front of it.
    const moon = '<http://www.wikidata.org/entity/Q405> Point(-3.6 26.1)';
    expect(preferredCoordinate(moon, 'Point(-3.61 26.13)')).toBe('Point(-3.61 26.13)');
  });
});

/**
 * The fame line a source row states for itself: read off `api_config`, and
 * refused when the row does not state a usable one.
 *
 * A source whose finds are thinner than its places states a second pair
 * (ADR-0058 decision 5), so the cases below read both doors: the one-pair row
 * every source before archaeology writes must keep parsing unchanged, and the
 * finds pair must be refused half-stated rather than quietly completed from the
 * places' line.
 *
 * And where a row stands against a pair once it is read: the hysteresis every
 * kind shares, and the one sentence a curator sees when a row they hold has
 * slipped. Both were spelled per-kind before they lived here.
 */

import { describe, it, expect } from 'vitest';
import { belowLineReason, contentsLine, lineStanding, parseSourceLine } from './sourceLine.js';

describe('parseSourceLine', () => {
  it('reads the pair off api_config', () => {
    expect(parseSourceLine({ pageSize: 100, enterSitelinks: 22, staySitelinks: 18 }))
      .toEqual({ enterSitelinks: 22, staySitelinks: 18 });
  });

  it('refuses a missing pair, a non-integer, and a stay line above the enter line', () => {
    expect(() => parseSourceLine({})).toThrow(/enterSitelinks/);
    expect(() => parseSourceLine(null)).toThrow(/enterSitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: 22 })).toThrow(/staySitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: '22', staySitelinks: 18 })).toThrow();
    expect(() => parseSourceLine({ enterSitelinks: 22.5, staySitelinks: 18 })).toThrow();
    expect(() => parseSourceLine({ enterSitelinks: 18, staySitelinks: 22 })).toThrow(/stay/);
  });

  it('bounds each count at 1 and 1000, the same bounds the route body carries', () => {
    expect(parseSourceLine({ enterSitelinks: 1, staySitelinks: 1 }))
      .toEqual({ enterSitelinks: 1, staySitelinks: 1 });
    expect(parseSourceLine({ enterSitelinks: 1000, staySitelinks: 1000 }))
      .toEqual({ enterSitelinks: 1000, staySitelinks: 1000 });
    expect(() => parseSourceLine({ enterSitelinks: 0, staySitelinks: 0 })).toThrow(/enterSitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: 1001, staySitelinks: 18 })).toThrow(/enterSitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: 22, staySitelinks: 0 })).toThrow(/staySitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: 22, staySitelinks: 1001 })).toThrow(/staySitelinks/);
  });

  it('allows a stay line equal to the enter line: hysteresis is optional, not required', () => {
    expect(parseSourceLine({ enterSitelinks: 22, staySitelinks: 22 }))
      .toEqual({ enterSitelinks: 22, staySitelinks: 22 });
  });

  it('reads the finds pair when the row states it', () => {
    expect(parseSourceLine({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
    })).toEqual({ enterSitelinks: 22, staySitelinks: 18, find: { enterSitelinks: 18, staySitelinks: 15 } });
  });

  it('refuses half a finds pair', () => {
    expect(() => parseSourceLine({ enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18 }))
      .toThrow(/findStaySitelinks/);
    expect(() => parseSourceLine({ enterSitelinks: 22, staySitelinks: 18, findStaySitelinks: 15 }))
      .toThrow(/findEnterSitelinks/);
  });

  it('refuses a finds stay line above its enter line', () => {
    expect(() => parseSourceLine({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 15, findStaySitelinks: 18,
    })).toThrow(/stay line \(18\) is above/);
  });

  it('bounds the finds counts the way it bounds the places', () => {
    expect(() => parseSourceLine({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 0, findStaySitelinks: 0,
    })).toThrow(/findEnterSitelinks/);
    expect(() => parseSourceLine({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15.5,
    })).toThrow(/findStaySitelinks/);
  });
});

describe('contentsLine', () => {
  it('is the second pair where the source states one, and its only line where it does not', () => {
    // Two readers ask this of one source — the collector, deciding which find
    // carries a museum over the place line, and the run, telling the treasure
    // writer which line a find's own must-see flag is read at. Spelled twice, a
    // source with one line would judge its museums at its own number and badge
    // its finds at the art museums', and the two badges would disagree about
    // the same find (ADR-0023 decision 2).
    expect(contentsLine({
      enterSitelinks: 22, staySitelinks: 18, find: { enterSitelinks: 18, staySitelinks: 15 },
    })).toEqual({ enterSitelinks: 18, staySitelinks: 15 });
    expect(contentsLine({ enterSitelinks: 30, staySitelinks: 25 }))
      .toEqual({ enterSitelinks: 30, staySitelinks: 25 });
  });
});

describe('lineStanding', () => {
  const line = { enterSitelinks: 22, staySitelinks: 18 };

  it('lets a row in at the enter line, admitted or not', () => {
    expect(lineStanding(22, false, line)).toBe('in');
    expect(lineStanding(39, true, line)).toBe('in');
  });

  it('leaves a row the source never held below the line out, unreported', () => {
    expect(lineStanding(17, false, line)).toBe('out');
  });

  it('holds an admitted row at the stay line, which is what hysteresis is for', () => {
    expect(lineStanding(18, true, line)).toBe('in');
    expect(lineStanding(21, true, line)).toBe('in');
  });

  it('refuses an admitted row that fell below the stay line', () => {
    expect(lineStanding(17, true, line)).toBe('fell');
  });
});

describe('belowLineReason', () => {
  it('gives every kind the same sentence, with both numbers in it', () => {
    expect(belowLineReason(17, { enterSitelinks: 22, staySitelinks: 18 }))
      .toBe("17 sitelinks: below the world tier's line (22 to enter, 18 to stay)");
  });
});

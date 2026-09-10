/**
 * The fame line a source row states for itself: read off `api_config`, and
 * refused when the row does not state a usable one.
 */

import { describe, it, expect } from 'vitest';
import { parseSourceLine } from './sourceLine.js';

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
});

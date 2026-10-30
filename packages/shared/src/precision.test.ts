import { describe, expect, it } from 'vitest';
import { approximateReasons, onWholeMinute } from './precision.js';

describe('an approximate World Heritage point (#1853)', () => {
  it('is on a whole minute or a whole degree, as the list stores it', () => {
    // The Longmen Grottoes, 34°28′0″ N 112°28′0″ E, and Himeji-jo's 134.7 E.
    expect(onWholeMinute(112.4666667, 34.46666667)).toBe(true);
    expect(onWholeMinute(134.7, 34.83333333)).toBe(true);
    expect(onWholeMinute(23, 37)).toBe(true);
    // Whole minutes the list cut to five decimal places (#2158): Novgorod's
    // 58°32′ N 31°17′ E and Guachimontones' 20°41′ N 103°49′ W.
    expect(onWholeMinute(31.28333, 58.53333)).toBe(true);
    expect(onWholeMinute(-103.816666667, 20.6833305556)).toBe(true);
    // Given to the second, 0.17″ from the minute: Glovers Reef.
    expect(onWholeMinute(-87.783316, 16.799952)).toBe(false);
    // Given to the second: the Mother Cathedral of Echmiatsin.
    expect(onWholeMinute(44.2951388889, 40.1593055556)).toBe(false);
    // One axis rounded is not enough.
    expect(onWholeMinute(112.4666667, 34.4710)).toBe(false);
  });

  it("is shared with another component of the property, whatever its precision", () => {
    // Echmiatsin's 1011-001, 002 and 003 share the property's own point; 1011-006 is Zvartnots.
    const reasons = approximateReasons([
      { ref: '1011-001', lon: 44.2951388889, lat: 40.1593055556 },
      { ref: '1011-002', lon: 44.2951388889, lat: 40.1593055556 },
      { ref: '1011-003', lon: 44.2951388889, lat: 40.1593055556 },
      { ref: '1011-006', lon: 44.3246388889, lat: 40.1586666667 },
      { ref: null, lon: 112.4666667, lat: 34.46666667 },
    ]);
    expect(reasons).toEqual(['shared', 'shared', 'shared', null, 'whole-minute']);
  });

  it('is not shared with itself listed twice under one reference', () => {
    expect(approximateReasons([
      { ref: '874-001', lon: 1.234567, lat: 40.123456 },
      { ref: '874-001', lon: 1.234567, lat: 40.123456 },
    ])).toEqual([null, null]);
  });
});

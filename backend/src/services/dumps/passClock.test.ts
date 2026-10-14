import { describe, expect, it } from 'vitest';
import { PassClock } from './passClock.js';

/** The time a build's pass has left, from its pace so far (#1467). */

const MINUTE = 60_000;

describe('the time left in a pass (#1467)', () => {
  it('gives nothing in the first minute, then the rest at the pace so far', () => {
    const clock = new PassClock();
    expect(clock.observe(0, 1000, 0)).toBeNull();
    expect(clock.observe(50, 1000, 30_000)).toBeNull();
    // 100 bytes in two minutes: 900 left is eighteen minutes.
    expect(clock.observe(100, 1000, 2 * MINUTE)).toBe(18 * 60);
  });

  it('starts again when a second pass reads the file from the beginning', () => {
    const clock = new PassClock();
    clock.observe(0, 1000, 0);
    clock.observe(1000, 1000, 10 * MINUTE);
    expect(clock.observe(10, 1000, 11 * MINUTE)).toBeNull();
    expect(clock.observe(210, 1000, 13 * MINUTE)).toBe(Math.round((790 / 200) * 120));
  });

  it('gives nothing for a file of no known size', () => {
    const clock = new PassClock();
    clock.observe(0, null, 0);
    expect(clock.observe(500, null, 5 * MINUTE)).toBeNull();
  });
});

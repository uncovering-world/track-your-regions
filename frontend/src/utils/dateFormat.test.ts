import { describe, expect, it } from 'vitest';
import { formatTimeLeft } from './dateFormat';

/** A time left said the way a person says it (#1467). */
describe('formatTimeLeft', () => {
  it('rounds to what an estimate can claim', () => {
    expect(formatTimeLeft(20)).toBe('under a minute');
    expect(formatTimeLeft(25 * 60 + 10)).toBe('about 25 min');
    expect(formatTimeLeft(70 * 60)).toBe('about 1 h 10 min');
    expect(formatTimeLeft(2 * 3600 + 2 * 60)).toBe('about 2 h');
    expect(formatTimeLeft(3 * 3600 - 60)).toBe('about 3 h');
  });
});

import { describe, it, expect } from 'vitest';
import { elapsedText } from './durations.js';

describe('elapsedText', () => {
  it('reads as a person reads a duration', () => {
    expect(elapsedText(14.4)).toBe('14 s');
    expect(elapsedText(372)).toBe('6 min 12 s');
    expect(elapsedText(3840)).toBe('1 h 4 min');
  });

  it('never says a negative time', () => {
    expect(elapsedText(-3)).toBe('0 s');
  });
});

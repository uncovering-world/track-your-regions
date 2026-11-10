import { describe, expect, it } from 'vitest';
import { inputsMoved } from './dumpController.js';

/**
 * The cause the Public Dumps card words a readership rebuild by (#2415): the
 * edition redirects moved while the twelve months are held, which the runs
 * read as they stand meanwhile; or a month missing, which they cannot read.
 */
describe('why a copy that follows another needs a rebuild', () => {
  const readership = { followsInputs: true as const };

  it('is the input moving while every part is held', () => {
    expect(inputsMoved(readership, 'rebuild', { readable: true })).toBe(true);
  });

  it('is not the input where a part is missing, nothing is needed, or the copy follows nothing', () => {
    expect(inputsMoved(readership, 'rebuild', { readable: false })).toBe(false);
    expect(inputsMoved(readership, 'nothing', { readable: true })).toBe(false);
    expect(inputsMoved({}, 'rebuild', { readable: true })).toBe(false);
    expect(inputsMoved(readership, 'rebuild', null)).toBe(false);
  });
});

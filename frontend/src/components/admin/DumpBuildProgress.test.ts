import { describe, expect, it } from 'vitest';
import { retryLine } from './DumpBuildProgress';

/** A build the network cut reads as a retry with its time, not as a failure (#2419). */
describe('a build waiting to try again', () => {
  it('says which attempt comes and when, at the reader\'s clock', () => {
    const line = retryLine({ at: '2026-11-10T17:05:00Z', attempt: 2, of: 4, reason: 'The connection to dumps.wikimedia.org was closed' });
    expect(line).toMatch(/^Waiting to try again: attempt 2 of 4 at \d{1,2}:\d{2}/);
  });
});

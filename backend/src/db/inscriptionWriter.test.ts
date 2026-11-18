/**
 * Tests for the stays on the List of World Heritage in Danger that hold
 * together, as the deferred hold trigger reads them (#2127).
 */

import { describe, it, expect } from 'vitest';
import { staysThatHold, yearDate } from './inscriptionWriter.js';
import type { ListPeriod } from './placePeriodsWriter.js';

const stay = (from: number | null, until: number | null, ended = until !== null): ListPeriod =>
  ({ from: from === null ? null : yearDate(from), ended, until: until === null ? null : yearDate(until), ending: null });

describe('staysThatHold', () => {
  it('keeps Cologne Cathedral\'s stay of 2004 to 2006 beside a later open one, in time order', () => {
    expect(staysThatHold([stay(2020, null), stay(2004, 2006)])).toEqual([stay(2004, 2006), stay(2020, null)]);
  });

  it('lets the open stay win over an ended one it overlaps', () => {
    // Liverpool read from 2012 by the dataset and from 2012 to 2021 elsewhere: one stay.
    expect(staysThatHold([stay(2012, 2021), stay(2012, null)])).toEqual([stay(2012, null)]);
  });

  it('keeps the earlier of two ended stays that overlap', () => {
    expect(staysThatHold([stay(2005, 2008), stay(2004, 2006)])).toEqual([stay(2004, 2006)]);
  });

  it('lets a stay whose start is not known stand alone', () => {
    expect(staysThatHold([stay(null, null), stay(2004, 2006)])).toEqual([stay(null, null)]);
  });

  it('keeps a stay a curator decided over any stay that overlaps it', () => {
    // A curator ended the stay from 2025; the run's open stay of 2025 yields, and 2004 to 2006 stands.
    expect(staysThatHold([stay(2025, null), stay(2004, 2006)], [stay(2025, null, true)]))
      .toEqual([stay(2004, 2006), stay(2025, null, true)]);
  });

  it('reads an ended stay whose end is not known as ending the day it began', () => {
    expect(staysThatHold([stay(1996, null, true), stay(1997, 1999)])).toEqual([stay(1996, null, true), stay(1997, 1999)]);
  });
});

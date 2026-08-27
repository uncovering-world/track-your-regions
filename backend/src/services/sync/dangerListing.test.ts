/**
 * Tests for reading UNESCO's danger listing.
 *
 * The field is what the catalogue has left once the record is imported: the
 * boolean beside it is not stored, and `danger_list` is. Both the importer and
 * the read that puts a year on the badge go through this parser.
 */

import { describe, it, expect } from 'vitest';
import { parseDangerListing } from './dangerListing.js';

describe('parseDangerListing', () => {
  it('reads the listing and the year it began', () => {
    // Ancient City of Aleppo, on the List of World Heritage in Danger since 2013.
    expect(parseDangerListing('Y 2013')).toEqual({ listed: true, since: 2013 });
  });

  it('answers nothing for a site the source does not list', () => {
    // Belize Barrier Reef Reserve System, removed from the list in 2018: the
    // portal empties the field rather than recording the removal in it
    // (measured against whc001 on 2026-08-27).
    expect(parseDangerListing(null)).toBeNull();
    expect(parseDangerListing(undefined)).toBeNull();
    expect(parseDangerListing('   ')).toBeNull();
  });

  it('takes the field around whatever spacing it arrives with', () => {
    expect(parseDangerListing('  Y   1992 ')).toEqual({ listed: true, since: 1992 });
  });

  it('reads the Y as the answer and the year as detail', () => {
    // Every one of the 27 shapes the dataset holds today is "Y <year>", so a
    // bare Y is hypothetical -- but a listing without its year is still a
    // listing, and a badge with no date is the right way to say so.
    expect(parseDangerListing('Y')).toEqual({ listed: true, since: null });
  });

  it('is still a listing when the year is not one', () => {
    // The answer is the first token and the year is detail: a shape whose
    // second token is unreadable must not turn a listed site into an unlisted
    // one, which is the direction that matters here.
    expect(parseDangerListing('Y 20133')).toEqual({ listed: true, since: null });
  });

  it('answers nothing for a field that is not this field', () => {
    // Guessing at half of an unrecognised shape would be worse than silence:
    // the flag beside it in the source is what the importer falls back on.
    expect(parseDangerListing('Y 2013 N 2018')).toBeNull();
    expect(parseDangerListing('listed in danger')).toBeNull();
    expect(parseDangerListing(2013)).toBeNull();
  });

  it('does not read an N as a listing', () => {
    // The field's own vocabulary is Y/N. The dataset carries no N today; if it
    // ever does, a delisted site must not be badged as in danger -- which is
    // exactly what a mere "the field is non-empty" test would do.
    expect(parseDangerListing('N 2007')).toEqual({ listed: false, since: null });
  });
});

import { describe, expect, it } from 'vitest';
import { monthBefore, readershipWindow, retiredCopies, summaryOf, yearCollision } from './readershipBuild.js';

describe('readership’s twelve months (#1436)', () => {
  it('names the months a year would share with the year in place, the year to come, or an earlier year kept (#2230)', () => {
    const both = { inPlace: '2026-09-01', toCome: '2026-10-01' };
    expect(yearCollision('2026-03', both, [])).toBe('The year ending 2026-03 shares 2025-10 to 2026-03 with the current year (2025-10 to 2026-09)');
    expect(yearCollision('2025-10', both, [])).toBe('The year ending 2025-10 shares 2025-10 to 2025-10 with the current year (2025-10 to 2026-09)');
    expect(yearCollision('2025-09', both, [])).toBeNull();
    // Nothing in place: the year to come, the twelve ending on the newest month the host lists, is judged against alone.
    expect(yearCollision('2026-01', { inPlace: null, toCome: '2026-10-01' }, []))
      .toBe('The year ending 2026-01 shares 2025-11 to 2026-01 with the current year to come, the twelve ending on the newest month the host lists (2025-11 to 2026-10)');
    // A year in place more than a year behind the host: the year to come is judged against as well, since the next current build reads it.
    expect(yearCollision('2027-10', { inPlace: '2026-09-01', toCome: '2027-12-01' }, []))
      .toBe('The year ending 2027-10 shares 2027-01 to 2027-10 with the current year to come, the twelve ending on the newest month the host lists (2027-01 to 2027-12)');
    // An earlier year kept owns its twelve, cut short or not; asking for it again resumes it.
    expect(yearCollision('2024-12', both, ['2025-09'])).toBe('The year ending 2024-12 shares 2024-10 to 2024-12 with the year ending 2025-09 kept beside the current one (2024-10 to 2025-09)');
    expect(yearCollision('2025-09', both, ['2025-09'])).toBeNull();
    expect(yearCollision('2024-09', both, ['2025-09'])).toBeNull();
  });

  it('refuses what it cannot judge while the host\'s newest month is not known, never letting it through (#2230)', () => {
    expect(yearCollision('2026-01', { inPlace: null, toCome: null }, []))
      .toBe("The year ending 2026-01 cannot be judged yet: the host's newest month is not known yet, and no year is in place");
    // A year ending after the one in place may be reached by the next current build, which ends on the host's newest month.
    expect(yearCollision('2027-03', { inPlace: '2026-09-01', toCome: null }, []))
      .toBe("The year ending 2027-03 cannot be judged yet: the host's newest month is not known yet, and the year ending 2027-03 ends after the current year (2025-10 to 2026-09)");
    // One ending before the year in place begins needs no word from the host; one inside it is a plain collision.
    expect(yearCollision('2025-06', { inPlace: '2026-09-01', toCome: null }, [])).toBeNull();
    expect(yearCollision('2026-03', { inPlace: '2026-09-01', toCome: null }, [])).toBe('The year ending 2026-03 shares 2025-10 to 2026-03 with the current year (2025-10 to 2026-09)');
  });

  it('says what a build kept and dropped, and, for an earlier year, which year stands beside the current one (#2230)', () => {
    expect(summaryOf(0, [], 0, '2025-10-01')).toBe('every month of the twelve was kept already');
    expect(summaryOf(1, ['2026-10 1,000 rows'], 1, '2025-11-01')).toBe('kept 2026-10 1,000 rows; dropped 1 month before 2025-11');
    // An earlier year drops nothing: the current year's cleanup is not its to run.
    expect(summaryOf(12, ['2024-10 900 rows', '2025-09 950 rows'], 0, '2024-10-01', '2025-09'))
      .toBe('kept 2024-10 900 rows, 2025-09 950 rows; kept the year ending 2025-09 beside the current one');
  });

  it('counts the twelve back across a year’s end', () => {
    expect(monthBefore('2026-01-01', 1)).toBe('2025-12-01');
    expect(readershipWindow('2026-09-01')).toEqual([
      '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
      '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01',
    ]);
  });

  it('removes the local copies of months kept or past the twelve, with their leftovers, and nothing else', () => {
    const names = [
      'pageviews-202609-user.bz2',
      'pageviews-202608-user.bz2.part', 'pageviews-202608-user.bz2.part.json',
      'pageviews-202507-user.bz2',
      'pageviews-202605-user.bz2',
      'wikidata-20261005-all.json.gz',
      'notes.txt',
    ];
    expect(retiredCopies(names, '2025-10-01', new Set(['pageviews-202609-user.bz2', 'pageviews-202608-user.bz2']))).toEqual([
      'pageviews-202507-user.bz2',
      'pageviews-202608-user.bz2.part', 'pageviews-202608-user.bz2.part.json',
      'pageviews-202609-user.bz2',
    ]);
  });
});

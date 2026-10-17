import { describe, expect, it } from 'vitest';
import { monthBefore, readershipWindow, retiredCopies } from './readershipBuild.js';

describe('readership’s twelve months (#1436)', () => {
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

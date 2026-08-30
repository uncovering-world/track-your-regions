/**
 * Tests for naming UNESCO's selection criteria.
 *
 * The string is a claim by the source about why a place is on the List, so the two
 * properties worth pinning are that every numeral it names is kept and that each known
 * one carries a meaning a traveller can read.
 */

import { describe, it, expect } from 'vitest';
import { parseCriteria, unescoCriterion } from './unescoCriteria';

describe('parseCriteria', () => {
  it('reads the source string the way the importer does', () => {
    // The Bamiyan Valley, as the export states it.
    const criteria = parseCriteria('(i)(ii)(iii)(iv)');
    expect(criteria.map(c => c.numeral)).toEqual(['i', 'ii', 'iii', 'iv']);
    expect(criteria.every(c => c.kind === 'cultural')).toBe(true);
  });

  it('gives each known numeral its meaning', () => {
    const [one] = parseCriteria('(i)');
    expect(one.meaning).toBe('a masterpiece of human creative genius');
  });

  it('tells the natural criteria from the cultural ones', () => {
    // Getbol, Korean Tidal Flats: inscribed under (x) alone.
    const [ten] = parseCriteria('(x)');
    expect(ten.kind).toBe('natural');
    expect(unescoCriterion('vi')?.kind).toBe('cultural');
    expect(unescoCriterion('vii')?.kind).toBe('natural');
  });

  it('keeps a numeral the Guidelines do not have rather than losing part of the claim', () => {
    const criteria = parseCriteria('(ii)(xi)');
    expect(criteria.map(c => c.numeral)).toEqual(['ii', 'xi']);
    expect(criteria[1].meaning).toBeNull();
  });

  it('reads nothing from a string with no bracketed numerals', () => {
    expect(parseCriteria('')).toEqual([]);
    expect(parseCriteria('cultural')).toEqual([]);
  });
});

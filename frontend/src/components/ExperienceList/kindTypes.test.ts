/**
 * A kind's group narrowed to one type (#589).
 */

import { describe, expect, it } from 'vitest';
import { narrowGroups } from './kindTypes';

/** Italy's World Heritage group, three of its sites. */
const italy = {
  kindName: 'World Heritage Sites',
  experiences: [
    { id: 829, name: 'Pompeii', type: 'cultural' },
    { id: 1237, name: 'The Dolomites', type: 'natural' },
    { id: 174, name: 'Historic Centre of Florence', type: 'cultural' },
  ],
};
const worship = { kindName: 'Places of worship', experiences: [{ id: 12, name: 'St Peter', type: 'basilica' }] };

describe('narrowGroups', () => {
  it("keeps only the chosen type's rows in that kind's group, and leaves the others", () => {
    const [heritage, other] = narrowGroups([italy, worship], new Map([['World Heritage Sites', 'natural']]), null);
    expect(heritage.experiences.map(row => row.name)).toEqual(['The Dolomites']);
    expect(other).toBe(worship);
  });

  it('keeps the open card whatever its type', () => {
    const [heritage] = narrowGroups([italy], new Map([['World Heritage Sites', 'natural']]), 829);
    expect(heritage.experiences.map(row => row.name)).toEqual(['Pompeii', 'The Dolomites']);
  });

  it('changes nothing where no kind is narrowed', () => {
    const groups = [italy, worship];
    expect(narrowGroups(groups, new Map(), null)).toEqual(groups);
  });
});

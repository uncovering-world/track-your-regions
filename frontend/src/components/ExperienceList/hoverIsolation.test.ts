import { describe, it, expect } from 'vitest';
import { ownedHoveredLocationId, lostHiddenLabel } from './utils';
import { ExperienceListItem } from './ExperienceListItem';
import type { ExperienceLocation } from '../../api/experiences';

const loc = (id: number) => ({ id, name: `L${id}`, longitude: 0, latitude: 0, ordinal: 0 } as ExperienceLocation);

/**
 * Both halves of what keeps a hover from re-rendering the whole region's list.
 * Measured before this: one hover cost a 2460 ms frame at 200 rows; after, 15 ms.
 * Neither is something a test can assert directly, so these guard the two
 * mechanisms the measurement rests on.
 */
describe('hover isolation in the experience list', () => {
  describe('ownedHoveredLocationId', () => {
    it('passes the id through to the row that owns the location', () => {
      expect(ownedHoveredLocationId([loc(1), loc(2)], 2)).toBe(2);
    });

    it('gives every other row null, so their props do not move', () => {
      // The point of the helper: without it each row receives the same changing
      // id and the memo lapses for the entire list on any location hover.
      expect(ownedHoveredLocationId([loc(1), loc(2)], 99)).toBeNull();
    });

    it('is null when nothing is hovered, or the row has no locations yet', () => {
      expect(ownedHoveredLocationId([loc(1)], null)).toBeNull();
      expect(ownedHoveredLocationId(undefined, 1)).toBeNull();
    });
  });

  describe('ExperienceListItem', () => {
    it('is memoised', () => {
      // Guards the wrapper itself: unwrapping it restores the 2460 ms hover, and
      // nothing else in the suite would notice.
      expect((ExperienceListItem as unknown as { $$typeof: symbol }).$$typeof)
        .toBe(Symbol.for('react.memo'));
    });
  });
});

describe('lostHiddenLabel', () => {
  it('uses the singular English actually wants', () => {
    expect(lostHiddenLabel(1)).toBe('1 here no longer exists — show it');
    expect(lostHiddenLabel(3)).toBe('3 here no longer exist — show them');
  });
});

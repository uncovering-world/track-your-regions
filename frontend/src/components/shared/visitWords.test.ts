/**
 * Where a card offers "Visited, not sure which part" (#2120).
 */

import { describe, expect, it } from 'vitest';
import { offersWholeTick } from './visitWords';

describe('the whole tick on a card', () => {
  it('is offered on a whole that shows only its parts: the Struve Arc', () => {
    expect(offersWholeTick({ has_parts: true }, { has_own_point: false })).toBe(true);
  });

  it("is not offered on a whole with a point of its own, whose tick is that point's: the City of Graz", () => {
    expect(offersWholeTick({ has_parts: true }, { has_own_point: true })).toBe(false);
  });

  it('is not offered on a place of no parts, nor while the card is still reading', () => {
    expect(offersWholeTick({ has_parts: false }, { has_own_point: false })).toBe(false);
    expect(offersWholeTick({ has_parts: true }, undefined)).toBe(false);
  });
});

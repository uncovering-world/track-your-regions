import { describe, it, expect } from 'vitest';
import { openableRegion } from './openableRegion';

/** The Rijksmuseum's chain as a read returns it: smallest place first. */
const RIJKSMUSEUM = [
  { id: 7100, name: 'Noord-Holland', world_view_id: 5, world_view_name: 'Administrative' },
  { id: 7091, name: 'Netherlands', world_view_id: 5, world_view_name: 'Administrative' },
  { id: 6737, name: 'Europe', world_view_id: 5, world_view_name: 'Administrative' },
  { id: 9001, name: 'Benelux', world_view_id: 2, world_view_name: 'Wikivoyage Regions' },
];

describe('openableRegion', () => {
  it('opens the smallest region in the world view the reader is in', () => {
    // ADR-0042 decision 4: Noord-Holland rather than Europe, so the map frames
    // the object rather than the continent — and never another world view's
    // region, whatever it holds.
    expect(openableRegion(RIJKSMUSEUM, 5)?.name).toBe('Noord-Holland');
    expect(openableRegion(RIJKSMUSEUM, 2)?.name).toBe('Benelux');
  });

  it('answers null where that world view does not place the object, and for the default one', () => {
    expect(openableRegion(RIJKSMUSEUM, 7)).toBeNull();
    // The default world view owns no regions; an address under it names none.
    expect(openableRegion(RIJKSMUSEUM, null)).toBeNull();
    expect(openableRegion([], 5)).toBeNull();
  });
});

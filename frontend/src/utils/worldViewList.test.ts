/**
 * Every shape the server can send for a failed re-placement, since this sentence is
 * handed to an admin as it stands. The one a second implementation got wrong twice:
 * `{ id: null, name: null }` is what arrives when *listing* the world views is what
 * failed, so there is no number to print and a naive template renders "world view null".
 */

import { describe, it, expect } from 'vitest';
import { worldViewList } from './worldViewList';

describe('worldViewList', () => {
  it('names the world view and keeps its id, because the handover needs both', () => {
    expect(worldViewList([{ id: 4, name: 'Continents' }])).toBe('Continents (world view 4)');
  });

  it('says listing failed rather than printing a null id', () => {
    expect(worldViewList([{ id: null, name: null }]))
      .toBe('every world view — they could not even be listed');
  });

  it('falls back to the number when the name is missing', () => {
    expect(worldViewList([{ id: 7, name: null }])).toBe('world view 7');
  });

  it('reads as "its world views" when the list is absent, which is an older server', () => {
    // `placementFailedWorldViews` and `placementFailed` travel together, so an empty
    // list is the shape of a server that predates the field — not of a success.
    expect(worldViewList([])).toBe('its world views');
    expect(worldViewList(undefined)).toBe('its world views');
  });

  it('joins several, since one failure per world view is the normal shape', () => {
    expect(worldViewList([{ id: 1, name: 'GADM' }, { id: 4, name: 'Continents' }]))
      .toBe('GADM (world view 1), Continents (world view 4)');
  });
});

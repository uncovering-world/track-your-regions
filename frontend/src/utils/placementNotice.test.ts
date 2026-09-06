/**
 * The sentence a curator hands to an admin when a point could not be re-placed.
 *
 * Moved here with the function from the withdrawn card's test: what it pins is the
 * wording and the ids, which every caller of the sentence relies on alike.
 */

import { describe, it, expect } from 'vitest';
import { placementNotice } from './placementNotice';

describe('placementNotice', () => {
  it('says nothing when placement did not fail', () => {
    // The common answer. A notice on every verdict would train a curator to dismiss
    // the one that matters.
    expect(placementNotice({ name: 'Bilbao' }, { offeredToReaders: true } as never)).toBeUndefined();
  });

  it('names the world views, and says the regions are stale until an admin acts', () => {
    const notice = placementNotice({ name: 'Bilbao' }, {
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Base layer' }, { id: 1, name: 'GADM' }],
    });

    // With the ids, because the curator reads this out to an admin who searches by
    // number: `worldViewList`'s form, not a list derived here, which is how the id
    // gets dropped from the one sentence written to be handed on.
    expect(notice).toContain('Base layer (world view 4), GADM (world view 1)');
    expect(notice).toContain('recorded');
    expect(notice).toMatch(/out of date/);
  });

  it('says something when the world views themselves could not be listed', () => {
    // `placeAfterRelease` answers with one nameless entry when even listing them
    // failed, so there is no number to give — and a template that tried would print
    // "world view null" here.
    const notice = placementNotice({ name: 'Bilbao' }, {
      placementFailed: true,
      placementFailedWorldViews: [{ id: null, name: null }],
    });

    expect(notice).toContain('every world view — they could not even be listed');
    expect(notice).not.toMatch(/null/);
  });
});

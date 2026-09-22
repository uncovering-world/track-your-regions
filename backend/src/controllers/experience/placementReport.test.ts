import { describe, expect, it } from 'vitest';
import { PublishResult } from '../../api/responses/curation.js';
import { placementReport } from './placementReport.js';

describe('placementReport', () => {
  it('sets neither key when every world view placed, so JSON sends neither', () => {
    const pair = placementReport([]);
    expect(pair).toEqual({ placementFailed: undefined, placementFailedWorldViews: undefined });
    expect(JSON.parse(JSON.stringify(pair))).toEqual({});
  });

  it('names each world view that failed, including the one no listing could name', () => {
    expect(placementReport([
      { worldViewId: 5, worldViewName: 'Administrative' },
      { worldViewId: null, worldViewName: null },
    ])).toEqual({
      placementFailed: true,
      placementFailedWorldViews: [{ id: 5, name: 'Administrative' }, { id: null, name: null }],
    });
  });

  it('builds a pair the schemas accept', () => {
    const answer = {
      experienceId: 6205, curationState: 'verified', appliedFields: [], claimedFieldsSkipped: [], appliedParts: [],
      fromSyncLogId: null, heldLeftOpen: 0, locationsPublished: 1, treasureLinksPublished: 0, treasuresPublished: 0,
      withdrawalsReleased: 1,
    };
    for (const failures of [[], [{ worldViewId: 5, worldViewName: 'Administrative' }]]) {
      expect(PublishResult.safeParse({ ...answer, ...placementReport(failures) }).success).toBe(true);
    }
  });
});

/**
 * What the curation answers promise beyond their types: the flag and the list of
 * a failed re-placement come together or not at all, and the list is never
 * empty. Zod's `toJSONSchema` does not carry a refinement, so neither the JSON
 * Schema nor the generated type says it. The parse that `respond()` runs
 * outside production is where it holds.
 */

import { describe, expect, it } from 'vitest';
import { AdmissionResult, PublishResult } from './curation.js';

const publication = {
  experienceId: 6205, curationState: 'verified', appliedFields: [], claimedFieldsSkipped: [],
  appliedParts: [], fromSyncLogId: null, heldLeftOpen: 0,
  locationsPublished: 1, treasureLinksPublished: 12, treasuresPublished: 12, withdrawalsReleased: 1,
};
const admission = { ...publication, admission: 'admitted', published: true };
const stale = [{ id: 5, name: 'Administrative' }];

describe.each([
  ['PublishResult', PublishResult, publication],
  ['AdmissionResult', AdmissionResult, admission],
] as const)('%s', (_name, schema, answer) => {
  it('accepts neither key, and both together', () => {
    expect(schema.safeParse(answer).success).toBe(true);
    expect(schema.safeParse({ ...answer, placementFailed: true, placementFailedWorldViews: stale }).success).toBe(true);
  });

  it.each([
    ['the flag without the list', { placementFailed: true }],
    ['the list without the flag', { placementFailedWorldViews: stale }],
    ['the flag with an empty list', { placementFailed: true, placementFailedWorldViews: [] }],
  ])('refuses %s', (_case, keys) => {
    expect(schema.safeParse({ ...answer, ...keys }).success).toBe(false);
  });
});

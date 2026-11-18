import { describe, it, expect } from 'vitest';
import {
  addToKindBodySchema, arrivalKindBodySchema, assignExperienceBodySchema, createManualExperienceBodySchema,
  experienceAdmissionBodySchema, keepOutOfKindBodySchema, rejectExperienceBodySchema, removeFromRegionQuerySchema,
  unassignQuerySchema, unrejectExperienceBodySchema,
} from './index.js';

/**
 * The why every screen of an act asks (#863), and the region a curator has
 * open, as the request schemas take them: the Capitoline Museums in Rome
 * rejected from Lazio, kept out of Art Museums, put back, and added by hand.
 */

const LAZIO = 863100;

describe('an act every screen asks why', () => {
  it('is refused without a reason', () => {
    expect(rejectExperienceBodySchema.safeParse({ regionId: LAZIO }).success).toBe(false);
    expect(assignExperienceBodySchema.safeParse({ regionId: LAZIO }).success).toBe(false);
    expect(removeFromRegionQuerySchema.safeParse({}).success).toBe(false);
    expect(keepOutOfKindBodySchema.safeParse({ membershipId: 40 }).success).toBe(false);
    expect(addToKindBodySchema.safeParse({ kindId: 5 }).success).toBe(false);
    expect(createManualExperienceBodySchema.safeParse({
      name: 'Capitoline Museums', longitude: 12.48, latitude: 41.89, regionId: LAZIO, kindId: 2,
    }).success).toBe(false);
  });

  it('takes only its own surface\'s reasons', () => {
    // A region act is about where the place stands, not what it is.
    expect(rejectExperienceBodySchema.safeParse({ regionId: LAZIO, reasonCode: 'not-this-kind' }).success).toBe(false);
    expect(removeFromRegionQuerySchema.safeParse({ reasonCode: 'missing-from-rule' }).success).toBe(false);
    expect(assignExperienceBodySchema.safeParse({ regionId: LAZIO, reasonCode: 'wrong-place' }).success).toBe(false);
    expect(keepOutOfKindBodySchema.safeParse({ membershipId: 40, reasonCode: 'missing-from-rule' }).success).toBe(false);

    expect(rejectExperienceBodySchema.parse({ regionId: LAZIO, reasonCode: 'wrong-place', reason: 'it is in Rome' }))
      .toEqual({ regionId: LAZIO, reasonCode: 'wrong-place', reason: 'it is in Rome' });
    expect(removeFromRegionQuerySchema.parse({ reasonCode: 'duplicate', note: 'the Palazzo Nuovo row' }))
      .toEqual({ reasonCode: 'duplicate', note: 'the Palazzo Nuovo row' });
    expect(assignExperienceBodySchema.parse({ regionId: LAZIO, reasonCode: 'missing-from-rule' }))
      .toEqual({ regionId: LAZIO, reasonCode: 'missing-from-rule' });
  });

  it('asks nothing of a rejection taken back, which agrees with the placement rule', () => {
    expect(unrejectExperienceBodySchema.parse({ regionId: LAZIO })).toEqual({ regionId: LAZIO });
  });

  it('leaves the reason optional where no screen asks it', () => {
    expect(unassignQuerySchema.parse({})).toEqual({});
    expect(arrivalKindBodySchema.parse({ kindId: 5, stays: false })).toEqual({ kindId: 5, stays: false });
  });
});

describe('the region the curator has open', () => {
  it('rides with a keep-out, a put-back and an add to a kind', () => {
    expect(keepOutOfKindBodySchema.parse({ membershipId: 40, reasonCode: 'gone', regionId: LAZIO }).regionId).toBe(LAZIO);
    expect(experienceAdmissionBodySchema.parse({
      decision: 'override', reasonCode: 'missing-from-rule', regionId: LAZIO,
    }).regionId).toBe(LAZIO);
    expect(addToKindBodySchema.parse({ kindId: 5, reasonCode: 'other', regionId: LAZIO }).regionId).toBe(LAZIO);
  });

  it('is a row id: neither zero, nor text, nor past the column', () => {
    for (const regionId of [0, -1, '863100', 1.5, 2_147_483_648]) {
      expect(keepOutOfKindBodySchema.safeParse({ membershipId: 40, reasonCode: 'gone', regionId }).success, String(regionId))
        .toBe(false);
    }
  });

  it('is not taken by an arrival answered on the review page, where none is open', () => {
    expect(arrivalKindBodySchema.parse({ kindId: 5, stays: false, regionId: LAZIO })).not.toHaveProperty('regionId');
  });
});

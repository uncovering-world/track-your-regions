import { describe, expect, it } from 'vitest';
import { namedMembership } from './namedMembership';

describe('the membership an answer names', () => {
  it('is named where the card carries one', () => {
    expect(namedMembership(14546)).toEqual({ membershipId: 14546 });
  });

  it('is left out where the card carries none, so the body is what it was', () => {
    expect(namedMembership(null)).toEqual({});
    expect(namedMembership(undefined)).toEqual({});
  });
});

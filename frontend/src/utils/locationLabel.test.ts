/**
 * The label exists to say which of an experience's points this is, so two points
 * must never get the same one. `ordinal` became nullable when a withdrawal
 * started waiting for the point that replaces it (ADR-0025 decision 5), and
 * `${null + 1}` is `1` — the arithmetic that was inline at four call sites would
 * have given a held point the label a curator-created first point already has.
 */

import { describe, it, expect } from 'vitest';
import { locationLabel } from './locationLabel';

describe('locationLabel', () => {
  it('uses the name the source gave, when there is one', () => {
    expect(locationLabel({ name: 'Raigad Fort', ordinal: 3 })).toBe('Raigad Fort');
  });

  it('numbers an unnamed point from its place in the list', () => {
    // A sync numbers from 1, so its first component reads "Location 2". Preserved
    // exactly: renaming components visitors have been reading for months is a
    // product decision, not this function's.
    expect(locationLabel({ name: null, ordinal: 1 })).toBe('Location 2');
    expect(locationLabel({ name: null, ordinal: 0 })).toBe('Location 1');
  });

  it('gives a point with no place in the list no number, rather than a shared one', () => {
    const held = locationLabel({ name: null, ordinal: null });
    const curatorCreatedFirst = locationLabel({ name: null, ordinal: 0 });
    expect(held).toBe('Location');
    // The assertion that matters: `null + 1` is 1, so the obvious arithmetic makes
    // these two the same string — two different places under one name, one of them
    // about to disappear.
    expect(held).not.toBe(curatorCreatedFirst);
  });

  it('treats an absent name like a null one', () => {
    // The map's own location type declares `name?`, so undefined reaches here.
    expect(locationLabel({ ordinal: 2 })).toBe('Location 3');
  });

  it('treats an absent ordinal like a null one', () => {
    // The type says `ordinal` is required, but the value crosses the API
    // boundary with no runtime validation — a payload that omits the key
    // reaches here as `undefined`, not `null`. `undefined === null` is
    // false, so a check written against only `null` would fall through to
    // `undefined + 1`, which is `NaN` rather than a held point's "Location".
    expect(locationLabel({ name: null } as { name: string | null; ordinal: number | null })).toBe('Location');
  });
});

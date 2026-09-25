import { describe, expect, it } from 'vitest';
import { displayNameOf } from './displayName';

describe('displayNameOf', () => {
  it('answers the name, trimmed', () => {
    expect(displayNameOf('  Ada Lovelace ')).toBe('Ada Lovelace');
  });

  it.each([
    ['missing', null],
    ['undefined', undefined],
    ['empty', ''],
    ['spaces', '   '],
  ])('answers null for a %s name, so the caller\'s fallback applies', (_name, value) => {
    expect(displayNameOf(value)).toBeNull();
  });
});

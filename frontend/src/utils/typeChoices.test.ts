import { describe, expect, it } from 'vitest';
import { narrowToType, offeredType, typeChoices } from './typeChoices';
import { typeLabelFor } from './experienceTypes';

describe('typeChoices (#589)', () => {
  it('offers the types a list holds, the most common first', () => {
    // A World Heritage list: two cultural sites, one natural, one with no type.
    expect(typeChoices([{ type: 'cultural' }, { type: 'natural' }, { type: 'cultural' }, { type: null }]))
      .toEqual([{ type: 'cultural', count: 2 }, { type: 'natural', count: 1 }]);
  });

  it('offers nothing where one type, or none, is all there is', () => {
    expect(typeChoices([{ type: 'cathedral' }, { type: 'cathedral' }])).toEqual([]);
    expect(typeChoices([{ type: null }, {}])).toEqual([]);
  });

  it("names a type as its kind's vocabulary does, and keeps a value it has no word for", () => {
    expect(typeLabelFor(1, 'cultural')).toBe('Cultural');
    expect(typeLabelFor(4, 'gurdwara')).toBe('gurdwara');
  });
});

describe('narrowToType (#589)', () => {
  it('keeps the rows of the chosen type, and every row when none is chosen', () => {
    const rows = [{ id: 1, type: 'cultural' }, { id: 2, type: 'natural' }, { id: 3, type: null }];
    expect(narrowToType(rows, 'natural').map(r => r.id)).toEqual([2]);
    expect(narrowToType(rows, null)).toBe(rows);
  });
});

describe('offeredType (#589)', () => {
  it('drops a chosen type the choices no longer offer', () => {
    // Natural was chosen while the lost places showed; hidden again, one type is left and no chip.
    const choices = [{ type: 'cultural', count: 9 }, { type: 'natural', count: 3 }];
    expect(offeredType(choices, 'natural')).toBe('natural');
    expect(offeredType([], 'natural')).toBeNull();
    expect(offeredType(choices, null)).toBeNull();
  });
});

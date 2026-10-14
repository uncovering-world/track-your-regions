import { describe, expect, it } from 'vitest';
import { entityJson, entityOf, forEachMainItemValue, hasMainValue } from './entityLine.js';
import { at, dumpLine, item } from './dumpLineFixture.js';

// The Dendera zodiac (Q3100139): in Room 325 (Q19119449), in the Egyptian
// Antiquities department (Q3044749), with a coordinate of its own.
const zodiac = dumpLine('Q3100139', 'Dendera zodiac', [
  { property: 31, value: item(860861), qualifier: { property: 7452, item: 71536244 } },
  { property: 276, value: item(19119449) },
  { property: 195, value: item(3044749) },
  { property: 625, value: at(48.8606, 2.3376) },
]);

describe('a dump line read without parsing it (#1434)', () => {
  it('names its entity', () => {
    expect(entityOf(zodiac)).toEqual({ kind: 'item', id: 3100139 });
    expect(entityOf(dumpLine('P625', 'coordinate location', [], { datatype: 'globe-coordinate' })))
      .toEqual({ kind: 'property', id: 625 });
    expect(entityOf('[')).toBeNull();
  });

  it('reads the items its statements name, and not a qualifier\'s', () => {
    const seen: Array<[number, number]> = [];
    forEachMainItemValue(zodiac, (property, value) => seen.push([property, value]));
    expect(seen).toEqual([[31, 860861], [276, 19119449], [195, 3044749]]);
  });

  it('tells a property from one whose number starts the same', () => {
    expect(hasMainValue(zodiac, 625)).toBe(true);
    expect(hasMainValue(zodiac, 62)).toBe(false);
    expect(hasMainValue(zodiac, 279)).toBe(false);
  });

  it('is the entity JSON the parsing pass reads', () => {
    expect(JSON.parse(entityJson(zodiac)).claims.P276[0].mainsnak.datavalue.value.id).toBe('Q19119449');
  });
});

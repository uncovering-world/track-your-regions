/**
 * The words of a crowded city's tail (ADR-0172, #2201): the row that ends a
 * kind's group, counted from the list's `crowdedOut`, in Rome's terms.
 */

import { describe, expect, it } from 'vitest';
import { tailLabel, typeCount } from './tailNotice';

const WORSHIP = 4;
const PUBLIC_ART = 3;
const BRIDGES = 8;

describe('tailLabel', () => {
  it('names the one type a tail holds, in the plural', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [{ type: 'church', count: 37 }]))
      .toBe('37 shadowed churches');
  });

  it('names it in the singular for one', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [{ type: 'church', count: 1 }]))
      .toBe('1 shadowed church');
  });

  it('names the kind and each type, the most numerous first, where it holds several', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [
      { type: 'temple', count: 1 },
      { type: 'church', count: 37 },
      { type: 'chapel', count: 2 },
    ])).toBe('40 shadowed places of worship: 37 churches, 2 chapels, 1 temple');
  });

  it('says "other" for places with no type, last', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [
      { type: null, count: 2 },
      { type: 'church', count: 2 },
    ])).toBe('4 shadowed places of worship: 2 churches, 2 others');
  });

  it('names the kind alone where no place of the tail has a type', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [{ type: null, count: 3 }]))
      .toBe('3 shadowed places of worship');
    expect(tailLabel(WORSHIP, 'Places of worship', [{ type: null, count: 1 }]))
      .toBe('1 shadowed place');
  });

  it('counts works of public art rather than "public arts"', () => {
    expect(tailLabel(PUBLIC_ART, 'Public art', [
      { type: 'sculpture', count: 4 },
      { type: 'fountain', count: 3 },
    ])).toBe('7 shadowed works of public art: 4 sculptures, 3 fountains');
  });

  it('offers nothing where the counts leave nothing out', () => {
    expect(tailLabel(WORSHIP, 'Places of worship', [])).toBeNull();
    expect(tailLabel(WORSHIP, 'Places of worship', [{ type: 'church', count: 0 }])).toBeNull();
  });
});

describe('typeCount', () => {
  it('pluralises a type in its vocabulary\'s own word', () => {
    expect(typeCount(WORSHIP, 'monastery', 2)).toBe('2 monasteries');
    expect(typeCount(WORSHIP, 'holy site', 3)).toBe('3 holy sites');
    expect(typeCount(BRIDGES, 'lock-flight', 2)).toBe('2 flights of locks');
    expect(typeCount(PUBLIC_ART, 'street-art', 1)).toBe('1 piece of street art');
    expect(typeCount(6, 'arch', 2)).toBe('2 arches');
    expect(typeCount(9, 'stairway', 2)).toBe('2 stairways');
  });
});

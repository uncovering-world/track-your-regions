/**
 * The label exists to say which of an object's points this is, so two points
 * of one object must never get the same one (#528, #1268).
 */

import { describe, it, expect } from 'vitest';
import { componentRef, locationLabel, pinLabel, pointFullName } from './locationLabel';

describe('locationLabel', () => {
  it('uses the name the source gave, when there is one', () => {
    expect(locationLabel({ name: 'Raigad Fort', external_ref: '1739-005' })).toBe('Raigad Fort');
  });

  it('names an unnamed part by its component reference', () => {
    // The Via Appia's parts, which UNESCO leaves unnamed.
    expect(locationLabel({ name: null, external_ref: '1708-003' })).toBe('1708-003');
    expect(locationLabel({ name: '  ', external_ref: '1584bis-017' })).toBe('1584bis-017');
  });

  it('names a point with neither by where it is', () => {
    expect(locationLabel({ name: null, external_ref: 'Q185382', latitude: 41.900833, longitude: 12.483056 }))
      .toBe('41.90083, 12.48306');
  });

  it('never gives two unnamed points of one object the same label', () => {
    // Two of the Via Appia's parts, and two points that carry no reference at
    // all, whatever their place in the source's list.
    const parts = [
      { name: null, external_ref: '1708-003', ordinal: 1 },
      { name: null, external_ref: '1708-004', ordinal: 1 },
    ];
    expect(locationLabel(parts[0])).not.toBe(locationLabel(parts[1]));
    const bare = [
      { name: null, latitude: 41.900833, longitude: 12.483056 },
      { name: null, latitude: 41.900925, longitude: 12.483306 },
    ];
    expect(locationLabel(bare[0])).not.toBe(locationLabel(bare[1]));
  });

  it('falls back to a word only where nothing else is known', () => {
    expect(locationLabel({ name: null })).toBe('Point');
  });
});

describe('componentRef', () => {
  it("is UNESCO's part reference, and not a Wikidata id or a whole site's number", () => {
    expect(componentRef({ external_ref: '1363-061' })).toBe('1363-061');
    expect(componentRef({ external_ref: '1584bis-017' })).toBe('1584bis-017');
    expect(componentRef({ external_ref: '540-003b 12' })).toBe('540-003b 12');
    expect(componentRef({ external_ref: 'Q185382' })).toBeNull();
    expect(componentRef({ external_ref: '1708' })).toBeNull();
    expect(componentRef({ external_ref: null })).toBeNull();
  });
});

describe('pointFullName', () => {
  it('names the object, the part and its reference', () => {
    expect(pointFullName('Prehistoric Pile Dwellings around the Alps', { name: 'See', external_ref: '1363-061' }))
      .toBe('Prehistoric Pile Dwellings around the Alps — See (1363-061)');
    expect(pointFullName('Aalto Works', { name: 'Villa Mairea, Pori', external_ref: '1752-013' }))
      .toBe('Aalto Works — Villa Mairea, Pori (1752-013)');
  });

  it('does not repeat the reference of a part named by it', () => {
    expect(pointFullName('Via Appia', { name: null, external_ref: '1708-003' })).toBe('Via Appia — 1708-003');
  });

  it('brackets no Wikidata id', () => {
    expect(pointFullName('Trevi Fountain', { name: 'Trevi Fountain', external_ref: 'Q185382' }))
      .toBe('Trevi Fountain — Trevi Fountain');
  });
});

describe('pinLabel', () => {
  it("leaves a museum's one unnamed point to the museum, on its pin and its dot alike", () => {
    expect(pinLabel({ name: null, external_ref: 'Q19675', latitude: 48.86061, longitude: 2.33764 }, 1)).toBeNull();
  });

  it('names a part of an object with several, by its name and reference or by the reference alone', () => {
    expect(pinLabel({ name: 'Villa Mairea, Pori', external_ref: '1752-013' }, 13)).toBe('Villa Mairea, Pori (1752-013)');
    expect(pinLabel({ name: null, external_ref: '1708-003' }, 21)).toBe('1708-003');
  });
});

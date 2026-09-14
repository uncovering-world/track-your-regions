import { describe, it, expect } from 'vitest';
import { isOsmReaderName, OSM_READER_NAMES, parseOsmReaderName } from './readerChoice.js';

describe('parseOsmReaderName', () => {
  it('reads unset and blank as the mirror, which compose passes an optional variable as', () => {
    expect(parseOsmReaderName(undefined)).toBe('qlever');
    expect(parseOsmReaderName('')).toBe('qlever');
    expect(parseOsmReaderName('  ')).toBe('qlever');
  });

  it('accepts each door by its name', () => {
    for (const name of OSM_READER_NAMES) expect(parseOsmReaderName(name)).toBe(name);
    expect(parseOsmReaderName(' overpass ')).toBe('overpass');
  });

  it('refuses a name it does not have rather than reading it as the default', () => {
    // An operator who wrote this in the middle of an outage must hear it
    // now, not from a run that failed on the mirror an hour later.
    expect(() => parseOsmReaderName('overpas')).toThrow(/OSM_READER names no reader .*"overpas".*qlever, overpass/);
    expect(() => parseOsmReaderName('Overpass')).toThrow(/names no reader/);
  });
});

describe('isOsmReaderName', () => {
  it('is the list, and nothing near it', () => {
    expect(isOsmReaderName('qlever')).toBe(true);
    expect(isOsmReaderName('overpass')).toBe(true);
    expect(isOsmReaderName('osm')).toBe(false);
  });
});

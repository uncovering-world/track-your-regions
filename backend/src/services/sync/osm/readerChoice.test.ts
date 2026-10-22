import { describe, it, expect } from 'vitest';
import { chooseOsmReader, isOsmReaderName, OSM_READER_NAMES, parseOsmReaderName } from './readerChoice.js';

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

describe('chooseOsmReader (ADR-0134)', () => {
  const fresh = async () => true;
  const none = async () => false;

  it('opens the layer while a fresh one is in place and the variable is unset, and the mirror otherwise', async () => {
    expect(await chooseOsmReader(undefined, fresh)).toBe('local');
    expect(await chooseOsmReader('  ', fresh)).toBe('local');
    expect(await chooseOsmReader('', none)).toBe('qlever');
  });

  it('keeps the door an operator named, whatever the layer', async () => {
    expect(await chooseOsmReader('qlever', fresh)).toBe('qlever');
    expect(await chooseOsmReader('overpass', fresh)).toBe('overpass');
    expect(await chooseOsmReader('local', none)).toBe('local');
  });

  it('refuses a name that is no door before it asks about the layer', async () => {
    let asked = false;
    await expect(chooseOsmReader('overpas', async () => { asked = true; return true; })).rejects.toThrow('names no reader');
    expect(asked).toBe(false);
  });
});

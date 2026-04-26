import { describe, it, expect } from 'vitest';
import { parseMarkers, parseGeoTag } from '../markerParser.js';

describe('parseMarkers', () => {
  it('extracts explicit lat/long from marker', () => {
    const text = '{{marker|type=city|name=Cabinda|lat=-5.55|long=12.20}}';
    const result = parseMarkers(text);
    expect(result).toEqual([{ name: 'Cabinda', lat: -5.55, lon: 12.20, wikidataId: null }]);
  });

  it('extracts wikidata ID when no coords', () => {
    const text = '{{marker|type=city|name=[[Luanda]]|wikidata=Q3897}}';
    const result = parseMarkers(text);
    expect(result).toEqual([{ name: 'Luanda', lat: null, lon: null, wikidataId: 'Q3897' }]);
  });

  it('handles mixed markers', () => {
    const text = `
      {{marker|type=city|name=Cabinda|lat=-5.55|long=12.20}}
      {{marker|type=city|name=[[Luanda]]|wikidata=Q3897|lat=-8.84|long=13.23}}
      {{marker|type=city|name=Lobito|wikidata=Q187764}}
    `;
    const result = parseMarkers(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ name: 'Cabinda', lat: -5.55, lon: 12.20 });
    expect(result[1]).toMatchObject({ name: 'Luanda', lat: -8.84, lon: 13.23, wikidataId: 'Q3897' });
    expect(result[2]).toMatchObject({ name: 'Lobito', lat: null, lon: null, wikidataId: 'Q187764' });
  });

  it('strips wikilinks from name', () => {
    const text = '{{marker|type=city|name=[[São Tomé]]|wikidata=Q3921}}';
    const result = parseMarkers(text);
    expect(result[0].name).toBe('São Tomé');
  });

  it('returns empty for no markers', () => {
    expect(parseMarkers('Some regular text')).toEqual([]);
  });

  it('ignores markers without name', () => {
    const text = '{{marker|type=go|lat=1|long=2}}';
    const result = parseMarkers(text);
    expect(result).toEqual([]);
  });
});

describe('parseGeoTag', () => {
  it('extracts geo tag coordinates', () => {
    const text = '{{geo|lat=-12.5|long=18.5|zoom=6}}';
    expect(parseGeoTag(text)).toEqual({ lat: -12.5, lon: 18.5 });
  });

  it('extracts positional geo tag', () => {
    const text = '{{geo|-12.5|18.5|zoom=6}}';
    expect(parseGeoTag(text)).toEqual({ lat: -12.5, lon: 18.5 });
  });

  it('returns null when no geo tag', () => {
    expect(parseGeoTag('No geo here')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { formatCoordinates, parseCoordinates } from './coordinateParser';

describe('parseCoordinates', () => {
  it('parses decimal coordinates', () => {
    expect(parseCoordinates('48.8566, 2.3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(parseCoordinates('-33.8688 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('parses labeled coordinates in both orders', () => {
    expect(parseCoordinates('lat: 48.8566, lng: 2.3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(parseCoordinates('lng: 2.3522, lat: 48.8566')).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('parses DMS coordinates', () => {
    const parsed = parseCoordinates('48°51\'24"N, 2°21\'8"E');
    expect(parsed).not.toBeNull();
    expect(parsed!.lat).toBeCloseTo(48.8566, 3);
    expect(parsed!.lng).toBeCloseTo(2.3522, 3);
  });

  it('parses decimal with directions', () => {
    expect(parseCoordinates('48.8566N, 2.3522E')).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(parseCoordinates('33.8688S, 151.2093E')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('parses Google Maps URLs', () => {
    const parsed = parseCoordinates('https://www.google.com/maps/@48.8566,2.3522,14z');
    expect(parsed).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('returns null for invalid or out-of-range inputs', () => {
    expect(parseCoordinates('')).toBeNull();
    expect(parseCoordinates('not coordinates')).toBeNull();
    expect(parseCoordinates('91, 2.3522')).toBeNull();
    expect(parseCoordinates('48.8566, 181')).toBeNull();
  });
});

describe('formatCoordinates', () => {
  it('formats coordinates with direction suffixes', () => {
    expect(formatCoordinates(48.8566, 2.3522)).toBe('48.8566°N, 2.3522°E');
    expect(formatCoordinates(-33.8688, -151.2093)).toBe('33.8688°S, 151.2093°W');
  });
});

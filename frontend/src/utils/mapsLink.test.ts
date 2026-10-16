/**
 * The links that hand a point to a maps app (#1194, ADR-0115).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapsPlatform, mapsTargets } from './mapsLink';

/** Groeningemuseum in Bruges, as the development catalogue holds its point. */
const groeningemuseum = { latitude: 51.205277777, longitude: 3.226666666 };
const OSM = 'https://www.openstreetmap.org/?mlat=51.205278&mlon=3.226667#map=17/51.205278/3.226667';
const GOOGLE = 'https://www.google.com/maps/search/?api=1&query=51.205278,3.226667';

describe('mapsTargets', () => {
  it('offers OpenStreetMap and Google Maps on a device with no maps app of its own', () => {
    expect(mapsTargets(groeningemuseum, 'Groeningemuseum', 'other')).toEqual([
      { id: 'osm', name: 'OpenStreetMap', href: OSM },
      { id: 'google', name: 'Google Maps', href: GOOGLE },
    ]);
  });

  it("puts Android's own maps app first, through geo:, labelled with the place's name", () => {
    const [first, ...rest] = mapsTargets(groeningemuseum, 'Groeningemuseum', 'android');
    expect(first).toEqual({
      id: 'device', name: 'Maps app', href: 'geo:51.205278,3.226667?q=51.205278,3.226667(Groeningemuseum)',
    });
    expect(rest.map((t) => t.id)).toEqual(['osm', 'google']);
  });

  it('puts Apple Maps first on an Apple device', () => {
    expect(mapsTargets(groeningemuseum, "St Bavo's Cathedral", 'apple')[0]).toEqual({
      id: 'device', name: 'Apple Maps', href: 'https://maps.apple.com/?ll=51.205278,3.226667&q=St%20Bavo%27s%20Cathedral',
    });
  });

  it("keeps a name's characters, brackets included, from becoming part of the link", () => {
    expect(mapsTargets(groeningemuseum, 'A (fake) name & more', 'android')[0].href)
      .toBe('geo:51.205278,3.226667?q=51.205278,3.226667(A%20%28fake%29%20name%20%26%20more)');
  });

  it('offers nothing for a coordinate that is no place on Earth', () => {
    expect(mapsTargets({ latitude: 91, longitude: 3 }, 'x', 'other')).toEqual([]);
    expect(mapsTargets({ latitude: 51, longitude: Number.NaN }, 'x', 'android')).toEqual([]);
  });
});

describe('mapsPlatform', () => {
  afterEach(() => vi.unstubAllGlobals());

  const device = (userAgent: string, platform = '') =>
    vi.stubGlobal('navigator', { userAgent, platform });

  it('tells an Android phone, an iPhone and a Windows desktop apart', () => {
    device('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36', 'Linux armv8l');
    expect(mapsPlatform()).toBe('android');
    device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'iPhone');
    expect(mapsPlatform()).toBe('apple');
    device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', 'Win32');
    expect(mapsPlatform()).toBe('other');
  });
});

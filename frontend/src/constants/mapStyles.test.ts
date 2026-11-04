/**
 * Every map drawn on OpenStreetMap's tiles credits OpenStreetMap (#2350): the
 * tile usage policy and the attribution guidelines ask for the credit on the
 * map, visible without interaction and linked to the copyright page.
 */
import { describe, expect, it } from 'vitest';
import { MAP_STYLE, MUTED_MAP_STYLE, OSM_ATTRIBUTION, OSM_RASTER_SOURCE } from './mapStyles';

// The tiles' URL as a pattern, since a host matched as a substring reads like a URL check, which this is not.
const TILE_URL = /https:\/\/tile\.openstreetmap\.org\//;

/** Every source file of the web, by its path from `src/`, specs left out. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }))
    .map(([path, text]) => [path.replace(/^\/src\//, ''), text]),
);
const filesWhere = (test: (text: string) => boolean) => Object.keys(SOURCES).filter((path) => test(SOURCES[path])).sort();

describe('the OpenStreetMap credit', () => {
  it('links the copyright page', () => {
    expect(OSM_ATTRIBUTION).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap</a> contributors');
  });

  it('is carried by every shared style that draws the tiles', () => {
    for (const style of [MAP_STYLE, MUTED_MAP_STYLE]) {
      expect(style.sources.osm).toBe(OSM_RASTER_SOURCE);
      expect(style.sources.osm.attribution).toBe(OSM_ATTRIBUTION);
    }
  });

  it('comes with the tiles: only the shared source names their host', () => {
    // A map that spelled the tile URL itself could draw the tiles without their credit.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(filesWhere((text) => TILE_URL.test(text))).toEqual(['constants/mapStyles.ts']);
  });

  it('is never hidden by a map that turns its attribution control off', () => {
    const hides = (text: string) => ['attributionControl: false', 'attributionControl={false}'].some((form) => text.includes(form));
    expect(filesWhere(hides)).toEqual([]);
  });
});

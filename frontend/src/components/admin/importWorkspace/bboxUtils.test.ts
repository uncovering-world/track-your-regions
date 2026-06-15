import { describe, it, expect } from 'vitest';
import { computeBbox } from './bboxUtils';

function point(lon: number, lat: number): { geometry: GeoJSON.Geometry } {
  return { geometry: { type: 'Point', coordinates: [lon, lat] } };
}

describe('computeBbox', () => {
  it('returns null for empty features', () => {
    expect(computeBbox([])).toBeNull();
  });

  it('handles a single point', () => {
    const result = computeBbox([point(10, 20)]);
    expect(result).toEqual([10, 20, 10, 20]);
  });

  it('returns a normal bbox for non-crossing features (Europe)', () => {
    // France, Germany — span ~15°, well under 180
    const result = computeBbox([point(-5, 43), point(15, 54)]);
    expect(result).toEqual([-5, 43, 15, 54]);
  });

  it('non-crossing bbox is unchanged when span is exactly 180', () => {
    const result = computeBbox([point(-90, 0), point(90, 0)]);
    expect(result).toEqual([-90, 0, 90, 0]);
  });

  it('antimeridian crossing: +179 and -179 yields narrow shifted bbox, not whole-world', () => {
    // Raw span = 179 − (−179) = 358 > 180 → antimeridian crossing.
    // After shift: -179 → 181, 179 stays 179.
    // Shifted min=179, max=181 → [179, lat, 181, lat] — narrow 2° bbox.
    const result = computeBbox([point(179, 60), point(-179, 60)]);
    expect(result).not.toBeNull();
    const [west, , east] = result!;
    // east − west should be ~2°, not ~358°
    expect(east - west).toBeCloseTo(2, 1);
    expect(west).toBeCloseTo(179, 1);
    expect(east).toBeCloseTo(181, 1);
  });

  it('antimeridian crossing for Russia-like geometry gives east > 180', () => {
    // Simulate points spanning Russia: from -170 (eastern Chukotka) to +45 (western Russia)
    // Raw span = 45 − (−170) = 215 > 180 → crossing detected.
    // After shift: -170 → 190; 45 stays 45. Shifted min=45, max=190.
    const result = computeBbox([point(-170, 65), point(45, 65)]);
    expect(result).not.toBeNull();
    const [west, , east] = result!;
    expect(east).toBeGreaterThan(180);
    expect(west).toBeCloseTo(45, 0);
    expect(east).toBeCloseTo(190, 0);
    // Span should be ~145°, not ~215°
    expect(east - west).toBeCloseTo(145, 0);
  });

  it('handles Polygon geometry', () => {
    const feat: { geometry: GeoJSON.Geometry } = {
      geometry: {
        type: 'Polygon',
        coordinates: [[[10, 50], [20, 50], [20, 60], [10, 60], [10, 50]]],
      },
    };
    const result = computeBbox([feat]);
    expect(result).toEqual([10, 50, 20, 60]);
  });

  it('handles GeometryCollection', () => {
    const feat: { geometry: GeoJSON.Geometry } = {
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [5, 10] },
          { type: 'Point', coordinates: [15, 20] },
        ],
      },
    };
    const result = computeBbox([feat]);
    expect(result).toEqual([5, 10, 15, 20]);
  });
});

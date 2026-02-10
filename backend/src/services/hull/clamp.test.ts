import { describe, it, expect } from 'vitest';
import { normalizeLngForRange, clampPolygonToLngRange, ensureEdgeAt } from './clamp.js';

describe('normalizeLngForRange', () => {
  it('shifts negative lng to positive when targeting positive range', () => {
    // -179 should become 181 when target range is positive (east side of dateline)
    expect(normalizeLngForRange(-179, { min: 150, max: 180 })).toBe(181);
  });

  it('shifts positive lng to negative when targeting negative range', () => {
    // 179 should become -181 when target range is negative (west side of dateline)
    expect(normalizeLngForRange(179, { min: -180, max: -150 })).toBe(-181);
  });

  it('returns lng unchanged when it already fits the target range', () => {
    expect(normalizeLngForRange(170, { min: 150, max: 180 })).toBe(170);
    expect(normalizeLngForRange(-170, { min: -180, max: -150 })).toBe(-170);
  });

  it('returns lng unchanged for ranges spanning zero', () => {
    // Range from -10 to 10 — no wrapping needed
    expect(normalizeLngForRange(5, { min: -10, max: 10 })).toBe(5);
    expect(normalizeLngForRange(-5, { min: -10, max: 10 })).toBe(-5);
  });

  it('handles zero longitude', () => {
    expect(normalizeLngForRange(0, { min: 0, max: 180 })).toBe(0);
    expect(normalizeLngForRange(0, { min: -180, max: 0 })).toBe(0);
  });
});

describe('clampPolygonToLngRange', () => {
  const makePolygon = (coords: [number, number][]): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [[...coords, coords[0]]],  // Close the ring
  });

  it('clamps coordinates exceeding the max longitude', () => {
    const polygon = makePolygon([[190, 10], [170, 10], [170, -10]]);
    const clamped = clampPolygonToLngRange(polygon, 150, 180);
    // 190 was already positive in a positive range, so no normalization needed,
    // but it gets clamped to 180
    expect(clamped.coordinates[0][0][0]).toBe(180);
  });

  it('clamps coordinates below the min longitude', () => {
    const polygon = makePolygon([[-190, 10], [-170, 10], [-170, -10]]);
    const clamped = clampPolygonToLngRange(polygon, -180, -150);
    expect(clamped.coordinates[0][0][0]).toBe(-180);
  });

  it('normalizes wrapped coordinates before clamping', () => {
    // Point at -179° in a positive target range should normalize to 181, then clamp to 180
    const polygon = makePolygon([[-179, 10], [170, 10], [170, -10]]);
    const clamped = clampPolygonToLngRange(polygon, 150, 180);
    expect(clamped.coordinates[0][0][0]).toBe(180);
  });

  it('preserves latitude values', () => {
    const polygon = makePolygon([[170, 45], [175, 50], [160, 40]]);
    const clamped = clampPolygonToLngRange(polygon, 150, 180);
    expect(clamped.coordinates[0][0][1]).toBe(45);
    expect(clamped.coordinates[0][1][1]).toBe(50);
    expect(clamped.coordinates[0][2][1]).toBe(40);
  });

  it('returns type Polygon', () => {
    const polygon = makePolygon([[170, 10], [175, 10], [175, -10]]);
    const clamped = clampPolygonToLngRange(polygon, 150, 180);
    expect(clamped.type).toBe('Polygon');
  });
});

describe('ensureEdgeAt', () => {
  const makePolygon = (coords: [number, number][]): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [[...coords, coords[0]]],
  });

  it('snaps coordinates near the max edge to the edge value', () => {
    // Point at 179.5 is within 1° tolerance of edge at 180 → snap to 180
    const polygon = makePolygon([[179.5, 10], [170, 10], [170, -10]]);
    const result = ensureEdgeAt(polygon, 180, 'max');
    expect(result.coordinates[0][0][0]).toBe(180);
    // Interior points should not be snapped
    expect(result.coordinates[0][1][0]).toBe(170);
  });

  it('snaps coordinates near the min edge to the edge value', () => {
    // Point at -179.5 is within 1° tolerance of edge at -180 → snap to -180
    const polygon = makePolygon([[-179.5, 10], [-170, 10], [-170, -10]]);
    const result = ensureEdgeAt(polygon, -180, 'min');
    expect(result.coordinates[0][0][0]).toBe(-180);
  });

  it('does not snap coordinates far from the edge', () => {
    const polygon = makePolygon([[170, 10], [160, 10], [160, -10]]);
    const result = ensureEdgeAt(polygon, 180, 'max');
    // 170 is 10° from 180, well outside tolerance — should remain unchanged
    expect(result.coordinates[0][0][0]).toBe(170);
  });

  it('preserves latitude when snapping longitude', () => {
    const polygon = makePolygon([[179.8, 42.5], [170, 10], [170, -10]]);
    const result = ensureEdgeAt(polygon, 180, 'max');
    expect(result.coordinates[0][0][0]).toBe(180);
    expect(result.coordinates[0][0][1]).toBe(42.5);
  });
});

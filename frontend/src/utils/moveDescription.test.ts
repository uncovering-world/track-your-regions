import { describe, it, expect } from 'vitest';
import { describeProposedMove, movedBy, moveView, shortWayLongitudeDelta } from './moveDescription';

describe('movedBy', () => {
  it('gives the bearing an arrow is turned by, beside its compass point', () => {
    const north = movedBy({ lon: 4, lat: 49 }, { lon: 4, lat: 49.3 });
    expect(north?.heading).toBe('north');
    expect(north?.degrees).toBeCloseTo(0, 5);
    const west = movedBy({ lon: 10, lat: 0 }, { lon: 9, lat: 0 });
    expect(west?.heading).toBe('west');
    expect(west?.degrees).toBeCloseTo(270, 5);
  });
});

describe('moveView', () => {
  it('zooms a short move in far enough to tell the two points apart', () => {
    // Ephesus, run 146: 158 m. At the zoom a region is framed at, that is five pixels.
    const view = moveView({ lon: 27.340833, lat: 37.939722 }, { lon: 27.33939, lat: 37.94058 });
    expect(view.zoom).toBeGreaterThan(15);
    expect(view.latitude).toBeCloseTo(37.94015, 4);
    expect(view.longitude).toBeCloseTo(27.34011, 4);
  });

  it('keeps a long move on one screen', () => {
    const view = moveView({ lon: 4, lat: 49 }, { lon: 4, lat: 49.3 });
    expect(view.zoom).toBeGreaterThan(8);
    expect(view.zoom).toBeLessThan(11);
  });

  it('centres a move across the antimeridian on the antimeridian, not on Greenwich', () => {
    const view = moveView({ lon: 179.5, lat: -17 }, { lon: -179.5, lat: -17 });
    expect(Math.abs(view.longitude)).toBeCloseTo(180, 5);
  });

  it('measures a move across the antimeridian the short way, for the line drawn along it', () => {
    expect(shortWayLongitudeDelta({ lon: 179.5, lat: -17 }, { lon: -179.5, lat: -17 })).toBeCloseTo(1, 9);
    expect(shortWayLongitudeDelta({ lon: -179.5, lat: -17 }, { lon: 179.5, lat: -17 })).toBeCloseTo(-1, 9);
    expect(shortWayLongitudeDelta({ lon: 27.340833, lat: 37.9 }, { lon: 27.33939, lat: 37.9 })).toBeCloseTo(-0.001443, 6);
  });

  it('answers a finite zoom for two equal points', () => {
    const view = moveView({ lon: 2, lat: 41 }, { lon: 2, lat: 41 });
    expect(view.zoom).toBe(17);
  });
});

describe('describeProposedMove — what a move crosses (#2203)', () => {
  // Kinabalu Park's held move, as the development catalogue held it on 2026-11-01.
  const FROM = { lon: 116.5, lat: 6.25 };
  const TO = { lon: 116.642, lat: 6.147 };
  const KOTA_BELUD = { name: 'Kota Belud', country: 'Malaysia' };
  const RANAU = { name: 'Ranau', country: 'Malaysia' };

  it('names the two divisions where the point crosses from one into the other', () => {
    expect(describeProposedMove(FROM, TO, { from: KOTA_BELUD, to: RANAU, same: false }))
      .toBe('Moved 19.4 km south-east — from Kota Belud into Ranau; check the pin.');
  });

  it('says nothing of regions for a long move inside one division', () => {
    // The Summer Palace: 14.5 km, and still in Beijing.
    const beijing = { name: 'Beijing', country: 'China' };
    expect(describeProposedMove({ lon: 116.27, lat: 40.0 }, { lon: 116.4, lat: 39.92 }, { from: beijing, to: beijing, same: true }))
      .toMatch(/^Moved [0-9.]+ km [a-z-]+\.$/);
  });

  it('says plainly when the country changes, and when a point is in no land division', () => {
    expect(describeProposedMove(FROM, TO, { from: KOTA_BELUD, to: { name: 'Nunukan', country: 'Indonesia' }, same: false }))
      .toContain('out of Kota Belud, Malaysia, into Nunukan, Indonesia: another country');
    // Aegospotami's old point, in the sea.
    expect(describeProposedMove(FROM, TO, { from: null, to: RANAU, same: false }))
      .toContain('from outside any land division into Ranau, Malaysia');
  });

  it('names a crossing between two divisions of one name, which the server tells apart', () => {
    // Washington County, Ohio, into Washington County, Pennsylvania: two leaves, one name.
    const ohio = { name: 'Washington', country: 'United States' };
    expect(describeProposedMove(FROM, TO, { from: ohio, to: ohio, same: false })).toContain('from Washington into Washington');
    expect(describeProposedMove(FROM, TO, { from: RANAU, to: RANAU, same: true })).toMatch(/^Moved [^—]*\.$/);
  });
});

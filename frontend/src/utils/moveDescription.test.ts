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

describe('describeProposedMove — which regions a move changes (#2203)', () => {
  // Comoé National Park's held move, as the development catalogue held it on 2026-11-02.
  const FROM = { lon: -4, lat: 9 };
  const TO = { lon: -3.758, lat: 9.077 };
  const ADMIN = 'Administrative';

  it('names the regions where the move changes a hierarchy\'s leaf', () => {
    expect(describeProposedMove(FROM, TO, [{ worldView: ADMIN, from: 'Savanes', to: 'Zanzan' }]))
      .toBe('Moved 27.9 km east — from Savanes into Zanzan (Administrative); check the pin.');
  });

  it('says nothing of regions for a move that keeps its regions, however long', () => {
    expect(describeProposedMove(FROM, TO, [])).toBe('Moved 27.9 km east.');
    expect(describeProposedMove(FROM, TO, undefined)).toBe('Moved 27.9 km east.');
  });

  it('counts the other hierarchies a move changes, and says a move into or out of every region', () => {
    expect(describeProposedMove(FROM, TO, [
      { worldView: ADMIN, from: 'Mara', to: 'Simiyu' },
      { worldView: 'Wikivoyage Regions', from: 'Serengeti', to: 'Lake Victoria' },
    ])).toContain('from Mara into Simiyu (Administrative, and in 1 other hierarchy)');
    // Aegospotami's old point, at sea.
    expect(describeProposedMove(FROM, TO, [{ worldView: ADMIN, from: null, to: 'Çanakkale' }]))
      .toContain('into Çanakkale, from outside every region (Administrative)');
    expect(describeProposedMove(FROM, TO, [{ worldView: ADMIN, from: 'Çanakkale', to: null }]))
      .toContain('out of Çanakkale, to outside every region (Administrative)');
  });
});

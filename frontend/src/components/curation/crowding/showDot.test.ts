/**
 * A dot the crowded-city window's list lights up is on its map (#2282, the
 * maintainer's ask): one in view is only lit, one off it is brought into view
 * at the zoom the curator chose.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/GuardedMap', () => ({ GuardedMap: () => null }));

import { showDot } from './CrowdingMap';

/** A map whose view covers Berlin's centre, from the Tiergarten to Alexanderplatz. */
function berlinCentre() {
  const inView = ([lon, lat]: [number, number]) => lon >= 13.33 && lon <= 13.42 && lat >= 52.50 && lat <= 52.53;
  return { getBounds: vi.fn(() => ({ contains: inView })), easeTo: vi.fn() };
}

describe('a dot the list lights up', () => {
  it('stays where it is when it is in view: Alexanderplatz is only lit', () => {
    const map = berlinCentre();
    showDot(map as never, 13.413, 52.522);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('is brought into view at the same zoom when it is off the map: Frankfurter Tor', () => {
    const map = berlinCentre();
    showDot(map as never, 13.454, 52.516);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [13.454, 52.516], duration: 400 });
    // No zoom in the call: the curator's zoom is kept.
    expect(map.easeTo.mock.calls[0][0]).not.toHaveProperty('zoom');
  });

  it('does nothing before the map exists', () => {
    expect(() => showDot(null, 13.454, 52.516)).not.toThrow();
  });
});

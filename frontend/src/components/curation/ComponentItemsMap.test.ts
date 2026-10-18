/**
 * What the component-items map frames (#1342), on the Caves of Aggtelek Karst
 * and Slovak Karst: the Koniar plateau component, Ochtinská Aragonite Cave 11 m
 * from its point, and the other places of the site around them.
 */

import { describe, expect, it } from 'vitest';
import { framedShape, POINT_ALONE_ZOOM, type MapFocus, type SitePoint } from './ComponentItemsMap';

const place = (locationId: number, name: string, latitude: number | null, longitude: number | null): SitePoint => ({
  locationId, name, ref: null, latitude, longitude, imageUrl: null, imageCredit: null,
});

const KONIAR = place(7258, 'Component of Koniar plateau (including Ochtinská Aragonite Cave)', 48.6646, 20.3092);
const PLESIVEC = place(7255, 'Component of Plešivec plateau', 48.6116, 20.4334);
const DOBSINA = place(7252, 'Dobšinská Ice Cave', 48.8767, 20.3765);

const focus = (candidate: MapFocus['candidate']): MapFocus => ({
  point: { locationId: 7258, name: KONIAR.name ?? '', latitude: 48.6646, longitude: 20.3092 }, candidate,
});

describe('what the component-items map frames (#1691)', () => {
  it('frames the pair alone, so it stands in the middle of the map', () => {
    const shape = framedShape(focus({
      label: 'Ochtinská Aragonite Cave', latitude: 48.6647, longitude: 20.3093, distance: '11 m away',
    }));
    expect(shape?.coordinates).toEqual([[20.3092, 48.6646], [20.3093, 48.6647]]);
  });

  it('leaves the site\'s other places out of the frame, however near or far they stand', () => {
    const shape = framedShape(focus({ label: 'Ochtinská Aragonite Cave', latitude: 48.6647, longitude: 20.3093, distance: '11 m away' }));
    for (const other of [PLESIVEC, DOBSINA]) {
      expect(shape?.coordinates).not.toContainEqual([other.longitude, other.latitude]);
    }
  });

  it('frames nothing where the candidate has no position: the map stands on the point alone, at street level', () => {
    expect(framedShape(focus(null))).toBeNull();
    expect(POINT_ALONE_ZOOM).toBe(14);
  });
});

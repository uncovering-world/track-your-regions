/**
 * What the component-items map frames (#1342), on the Caves of Aggtelek Karst
 * and Slovak Karst: the Koniar plateau component, Ochtinská Aragonite Cave 11 m
 * from its point, and the other places of the site around them.
 */

import { describe, expect, it } from 'vitest';
import { pairView, POINT_ALONE_ZOOM, type MapFocus, type SitePoint } from './ComponentItemsMap';

const place = (locationId: number, name: string, latitude: number | null, longitude: number | null): SitePoint => ({
  locationId, name, ref: null, latitude, longitude, imageUrl: null, imageCredit: null,
});

const KONIAR = place(7258, 'Component of Koniar plateau (including Ochtinská Aragonite Cave)', 48.6646, 20.3092);
const PLESIVEC = place(7255, 'Component of Plešivec plateau', 48.6116, 20.4334);

const focus = (candidate: MapFocus['candidate']): MapFocus => ({
  point: { locationId: 7258, name: KONIAR.name ?? '', latitude: 48.6646, longitude: 20.3092 }, candidate,
});

const CAVE = { label: 'Ochtinská Aragonite Cave', latitude: 48.6647, longitude: 20.3093, distance: '11 m away' };

describe('where the component-items map stands (#1691)', () => {
  it('stands on the pair, centred on its midpoint', () => {
    const view = pairView(focus(CAVE));
    expect(view.latitude).toBeCloseTo((48.6646 + 48.6647) / 2, 6);
    expect(view.longitude).toBeCloseTo((20.3092 + 20.3093) / 2, 6);
  });

  it('comes close enough on a pair metres apart that its two pins are two, not one', () => {
    // At zoom 12 a pixel is about 25 m here, and the cave's pin covered the component's; at the
    // view's ceiling, 17, a pixel is about 0.4 m and 11 m is some 28 px, a pin's width apart.
    expect(pairView(focus(CAVE)).zoom).toBe(17);
    // A pair a few kilometres apart is shown wider, still centred on its midpoint.
    expect(pairView(focus({ ...CAVE, latitude: PLESIVEC.latitude!, longitude: PLESIVEC.longitude! })).zoom).toBeLessThan(POINT_ALONE_ZOOM);
  });

  it('stands on the point alone, at street level, where the candidate has no position', () => {
    expect(pairView(focus(null))).toEqual({ longitude: 20.3092, latitude: 48.6646, zoom: POINT_ALONE_ZOOM });
  });
});

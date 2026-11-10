import { describe, expect, it } from 'vitest';
import { thinlyLined } from './surroundingsVenues.js';

/** `n` places a kilometre apart along a meridian from `lat`, `lon`, named `prefix` and their position. */
const row = (prefix: string, n: number, lat: number, lon: number) =>
  Array.from({ length: n }, (_, i) => ({ qid: `${prefix}${i}`, lat: lat + i / 111, lon }));

describe('thinlyLined', () => {
  it('names the streets read along their lines with fewer such streets within the radius than the floor, never one of a lined area', async () => {
    // Berlin's thirty lined streets make an area; Valletta's three lined streets do not, nor does a square read at its point count toward one.
    const berlin = row('B', 30, 52.5, 13.4);
    const valletta = row('V', 3, 35.9, 14.5);
    const squares = row('S', 40, 35.9, 14.51);
    const lined = new Set([...berlin, ...valletta].map((place) => place.qid));
    const thin = await thinlyLined([...berlin, ...valletta, ...squares], lined, { radiusKm: 150, venueGroupFloor: 25 });
    expect([...thin].sort()).toEqual(['V0', 'V1', 'V2']);
    // Read in slices, it lets the backend's other work through and names the same streets.
    let yields = 0;
    const sliced = await thinlyLined([...berlin, ...valletta, ...squares], lined, { radiusKm: 150, venueGroupFloor: 25 },
      { due: () => true, yield: async () => { yields += 1; } });
    expect([...sliced].sort()).toEqual(['V0', 'V1', 'V2']);
    expect(yields).toBeGreaterThan(0);
    expect((await thinlyLined(berlin, lined, { radiusKm: 150, venueGroupFloor: 31 })).size).toBe(30);
  });

  it('counts again among the streets left, so none is left with too few lined streets around it', async () => {
    // Sixty lined streets a kilometre apart: the middle ones have 25 within 12.5 km, the ends fewer. Once the ends are read at their
    // points, the streets next to them have too few in turn, and so on: no street is left read against fewer than 25.
    const line = row('L', 60, 57.05, 9.92);
    const lined = new Set(line.map((place) => place.qid));
    expect((await thinlyLined(line, lined, { radiusKm: 12.5, venueGroupFloor: 25 })).size).toBe(60);
    // Where the street keeps 25 lined streets around it, none is lost.
    const core = row('C', 25, 57.05, 9.92);
    expect((await thinlyLined(core, new Set(core.map((place) => place.qid)), { radiusKm: 30, venueGroupFloor: 25 })).size).toBe(0);
  });
});

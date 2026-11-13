import { describe, it, expect } from 'vitest';
import { experienceIdsInView } from './inView';
import type { ViewBounds } from '../../utils/viewBounds';
import type { Experience, ExperienceLocation } from '../../api/experiences';

const exp = (id: number, longitude: number, latitude: number) =>
  ({ id, name: `E${id}`, longitude, latitude } as Experience);
const place = (id: number, longitude: number, latitude: number, in_region = true) =>
  ({ id, longitude, latitude, in_region } as ExperienceLocation);

/** Prague at street zoom, the view #553 was reported from. */
const PRAGUE: ViewBounds = { west: 14.35, south: 50.05, east: 14.50, north: 50.11 };

describe('experienceIdsInView', () => {
  it('holds an object when any one of its places is in view', () => {
    // A serial nomination is here as soon as one of its places is on screen — the
    // Rock Art of the Mediterranean Basin draws 734 of them in Europe, and a
    // planner looking at a city means the one in front of them.
    const ids = experienceIdsInView(
      [exp(1, 0, 0)],
      { 1: [place(10, 100, 40), place(11, 14.42, 50.087), place(12, -70, -30)] },
      PRAGUE,
    );
    expect(ids.has(1)).toBe(true);
  });

  it('drops an object whose every place is elsewhere', () => {
    const ids = experienceIdsInView(
      [exp(1, 14.42, 50.087)],
      { 1: [place(10, 100, 40)] },
      PRAGUE,
    );
    // Its own coordinate is in view, but it is not what the map draws for it:
    // the pins are at its places, and none of them is here.
    expect(ids.has(1)).toBe(false);
  });

  it('falls back to the object’s own point when the batch holds no place for it', () => {
    // That is the stand-in pin the marker builder draws, so the list must agree
    // with it — hiding a row whose pin the reader can see is the failure this
    // replaces, not a smaller version of it.
    const ids = experienceIdsInView([exp(1, 14.42, 50.087)], {}, PRAGUE);
    expect(ids.has(1)).toBe(true);
  });

  it('asks the same subset the map draws: in-region places when there are any', () => {
    // `representablePlaces` prefers the places inside this region; an out-of-region
    // place is not drawn here, so it cannot put the row in view either.
    const ids = experienceIdsInView(
      [exp(1, 0, 0)],
      { 1: [place(10, 100, 40, true), place(11, 14.42, 50.087, false)] },
      PRAGUE,
    );
    expect(ids.has(1)).toBe(false);
  });

  it('uses every place when none of them is in this region', () => {
    const ids = experienceIdsInView(
      [exp(1, 0, 0)],
      { 1: [place(10, 14.42, 50.087, false)] },
      PRAGUE,
    );
    expect(ids.has(1)).toBe(true);
  });

  it('answers with the ids in view and nothing else', () => {
    const ids = experienceIdsInView(
      [exp(1, 14.42, 50.087), exp(2, 2.35, 48.85), exp(3, 14.40, 50.09)],
      {},
      PRAGUE,
    );
    expect([...ids].sort()).toEqual([1, 3]);
  });

  it('keeps a whole whose parts the batch does not hold, which draws no pin to be out of view', () => {
    // An object made of parts has no point of its own (#2122): with none of its
    // parts at hand the map draws nothing for it, and the list keeps the row
    // rather than hiding it for a pin that is nowhere.
    const whole = { ...exp(1175, 100, 40), has_parts: true } as Experience;
    expect(experienceIdsInView([whole], {}, PRAGUE).has(1175)).toBe(true);
    // Its parts at hand, it is in view where one of them is.
    expect(experienceIdsInView([whole], { 1175: [place(10, -5.99, 37.39)] }, PRAGUE).has(1175)).toBe(false);
  });
});

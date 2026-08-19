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

  it('follows the pin when the reader has folded an object', () => {
    // A fold means "draw this as one thing", and the builder then draws it at the
    // object's own coordinate. Testing its places instead would keep the Rock Art
    // of the Mediterranean Basin listed whenever any of its 734 shelters is in
    // view while the map draws one pin elsewhere — and drop an object whose
    // single pin is on screen.
    const folded = new Set([1]);
    const away = experienceIdsInView(
      [exp(1, 100, 40)],
      { 1: [place(10, 14.42, 50.087), place(11, 14.40, 50.09)] },
      PRAGUE,
      folded,
    );
    expect(away.has(1)).toBe(false);

    const here = experienceIdsInView(
      [exp(1, 14.42, 50.087)],
      { 1: [place(10, 100, 40), place(11, 2.35, 48.85)] },
      PRAGUE,
      folded,
    );
    expect(here.has(1)).toBe(true);
  });

  it('ignores a fold where folding is not a question', () => {
    // One drawn place is one pin either way, which is the same test the builder
    // and the fold control apply — so the object stays where its place is.
    const ids = experienceIdsInView(
      [exp(1, 100, 40)],
      { 1: [place(10, 14.42, 50.087)] },
      PRAGUE,
      new Set([1]),
    );
    expect(ids.has(1)).toBe(true);
  });
});

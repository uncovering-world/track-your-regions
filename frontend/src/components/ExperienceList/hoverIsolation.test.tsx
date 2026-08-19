import { describe, it, expect } from 'vitest';
import { hoverRevealsCappedPlace, lostHiddenLabel, outsideViewLabel } from './utils';
import { ExperienceListItem } from './ExperienceListItem';
import { ExperienceExpandedDetails } from './ExperienceExpandedDetails';
import { LocationRow } from './LocationRow';

const isMemo = (component: unknown) =>
  (component as { $$typeof: symbol }).$$typeof === Symbol.for('react.memo');

/**
 * The three wrappers that keep a hover from re-rendering the whole region's list.
 *
 * Which value each of them reads is guarded by `hooks/hoverStore.test.tsx`;
 * these guard the memos that make reading it locally worth anything. Unwrap any
 * one of them and the hover reaches everything below it again — measured at 200
 * rows, one hover cost a 2460 ms frame — while every test in this suite still
 * passes, because the rendered output is identical either way.
 */
describe('hover isolation in the experience list', () => {
  it('memoises the row, so a hover elsewhere does not re-render it', () => {
    expect(isMemo(ExperienceListItem)).toBe(true);
  });

  it('memoises the open card, the tallest thing the list draws', () => {
    // 1749 px on the Historic Centre of Saint Petersburg. Its row re-renders
    // whenever the pointer enters or leaves it, and without this the card was
    // rebuilt with it — picture, chips, works list and every place inside.
    expect(isMemo(ExperienceExpandedDetails)).toBe(true);
  });

  it('memoises the place row, of which one card holds up to 112', () => {
    expect(isMemo(LocationRow)).toBe(true);
  });
});

describe('lostHiddenLabel', () => {
  it('uses the singular English actually wants', () => {
    expect(lostHiddenLabel(1)).toBe('1 in this region no longer exists — show it');
    expect(lostHiddenLabel(3)).toBe('3 in this region no longer exist — show them');
  });
});

describe('outsideViewLabel', () => {
  it('counts without pluralising "more"', () => {
    // The trap is `plural(n, noun)`, this repository's shared helper — #546 is a
    // standing push to use it at the 28 sites that still inline a suffix, and it
    // renders "12 mores" here, because "more" does not take one. The first
    // revision of this label did exactly that, and the singular hid it, since
    // that is the form an eye checks. Both are pinned, so it goes red next time.
    expect(outsideViewLabel(1)).toBe('1 more in this region — show it');
    expect(outsideViewLabel(12)).toBe('12 more in this region — show them all');
  });
});

/**
 * The cap on an open card's places, and the one hover it must not cost.
 *
 * A card shows twenty of an object's in-region places until asked. The reader
 * cannot tell — until the hover comes from the *map*, which names a place
 * rather than an object: the place's row is what draws that hover, and a row
 * past the cap was never mounted. Hovering the marker for the fiftieth of the
 * Historic Centre's ninety-three places highlighted nothing at all, and the
 * list centred the object's row instead of the place.
 */
describe('hoverRevealsCappedPlace', () => {
  const ids = Array.from({ length: 93 }, (_, i) => 1000 + i);

  it('opens the rest for a marker hover on a place past the cap', () => {
    expect(hoverRevealsCappedPlace(ids, ids[49], 'marker')).toBe(true);
  });

  it('leaves it closed for a place the card is already showing', () => {
    expect(hoverRevealsCappedPlace(ids, ids[5], 'marker')).toBe(false);
    // The boundary both ways: twenty shown means indices 0..19.
    expect(hoverRevealsCappedPlace(ids, ids[19], 'marker')).toBe(false);
    expect(hoverRevealsCappedPlace(ids, ids[20], 'marker')).toBe(true);
  });

  it('leaves it closed for a hover that came from the list', () => {
    // A list hover can only have come from a row already on the page, so this
    // would be the card unfolding itself for a reader who did not ask.
    expect(hoverRevealsCappedPlace(ids, ids[49], 'list')).toBe(false);
  });

  it('leaves it closed for no hover, and for a place this object does not have', () => {
    expect(hoverRevealsCappedPlace(ids, null, 'marker')).toBe(false);
    expect(hoverRevealsCappedPlace(ids, 999_999, 'marker')).toBe(false);
  });
});

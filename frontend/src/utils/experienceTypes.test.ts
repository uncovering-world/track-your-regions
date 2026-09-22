/**
 * One closed vocabulary of types per kind, and none for a museum.
 *
 * What is pinned (#814): a kind offers its own list, never cultural / natural /
 * mixed / art to every object whatever its kind; a museum offers none; and a
 * value says which vocabulary it is from, so a monument's type is never
 * explained with UNESCO's sentence.
 */

import { describe, it, expect } from 'vitest';
import { hasExtent, typeOptionsFor, typeVocabularyOf } from './experienceTypes';

const WORLD_HERITAGE = 1;
const ART_MUSEUMS = 2;
const PUBLIC_ART = 3;
const PLACES_OF_WORSHIP = 4;
const ARCHAEOLOGY = 5;

describe('typeOptionsFor', () => {
  it('offers a World Heritage site its three, and public art its two', () => {
    expect(typeOptionsFor(WORLD_HERITAGE).map(o => o.value)).toEqual(['cultural', 'natural', 'mixed']);
    expect(typeOptionsFor(PUBLIC_ART).map(o => o.value)).toEqual(['monument', 'sculpture']);
  });

  it('offers a place of worship its eight types', () => {
    expect(typeOptionsFor(PLACES_OF_WORSHIP).map(o => o.value)).toEqual(
      ['cathedral', 'church', 'chapel', 'monastery', 'mosque', 'temple', 'shrine', 'synagogue'],
    );
  });

  it('offers an art museum nothing: it is a kind, not a type', () => {
    expect(typeOptionsFor(ART_MUSEUMS)).toEqual([]);
    expect(typeOptionsFor(null)).toEqual([]);
    expect(typeOptionsFor(99)).toEqual([]);
  });

  it('offers archaeology the dig and the museum that shows what came out of it', () => {
    // The one kind whose list holds both: a traveller planning Egypt wants
    // Saqqara and the Egyptian Museum on one list, so they are two types of one
    // kind rather than two kinds (ADR-0058) — which is not a contradiction of
    // the line above, since it is *archaeology* the museum is a type of.
    expect(typeOptionsFor(ARCHAEOLOGY).map(o => o.value)).toEqual(['site', 'museum']);
  });

  it('keeps the vocabularies disjoint, so a value names its kind', () => {
    const all = [WORLD_HERITAGE, PUBLIC_ART, PLACES_OF_WORSHIP, ARCHAEOLOGY]
      .flatMap(kind => typeOptionsFor(kind).map(o => o.value));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('typeVocabularyOf', () => {
  it('explains a monument in public art\'s words and a natural site in World Heritage\'s', () => {
    expect(typeVocabularyOf('sculpture')?.what).toMatch(/monument or sculpture/);
    expect(typeVocabularyOf('natural')?.what).toMatch(/World Heritage/);
    expect(typeVocabularyOf('natural')?.what).not.toMatch(/monument/);
  });

  it('explains a mosque as a place of worship', () => {
    expect(typeVocabularyOf('mosque')?.what).toMatch(/place of worship/i);
  });

  it('explains a site and a museum in archaeology\'s words, the same words for both', () => {
    // Both values are one vocabulary's, so the review card says the same thing
    // about a dig and about the museum beside it — which is the claim ADR-0058
    // makes: one kind, told apart by a chip.
    expect(typeVocabularyOf('site')?.what).toMatch(/excavation/i);
    expect(typeVocabularyOf('museum')).toBe(typeVocabularyOf('site'));
    // And not the museums' or public art's: the vocabularies stay disjoint.
    expect(typeVocabularyOf('site')?.what).not.toMatch(/monument or sculpture/);
  });

  it('answers nothing for a value no kind declares', () => {
    // `art` was never a type: the literal every museum row carried is gone.
    expect(typeVocabularyOf('art')).toBeNull();
    expect(typeVocabularyOf(null)).toBeNull();
    expect(typeVocabularyOf(7)).toBeNull();
  });
});

describe('hasExtent', () => {
  it('is the dig alone: a site has an outline, the museum beside it has an address', () => {
    expect(hasExtent(ARCHAEOLOGY, 'site')).toBe(true);
    expect(hasExtent(ARCHAEOLOGY, 'museum')).toBe(false);
  });

  it('is false for every other kind, whatever it is typed', () => {
    // The map asks this *before* reading a place, so a yes here is a request
    // issued. A kind that never has an extent must never cost one.
    expect(hasExtent(ART_MUSEUMS, null)).toBe(false);
    expect(hasExtent(PUBLIC_ART, 'monument')).toBe(false);
    expect(hasExtent(PLACES_OF_WORSHIP, 'cathedral')).toBe(false);
    expect(hasExtent(WORLD_HERITAGE, 'cultural')).toBe(false);
    expect(hasExtent(null, 'site')).toBe(false);
    expect(hasExtent(undefined, undefined)).toBe(false);
  });
});

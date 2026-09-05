/**
 * One closed vocabulary of types per kind, and none for a museum.
 *
 * The dialogs used to offer cultural / natural / mixed / art to every object,
 * whatever its kind, and the review card explained a monument's type with
 * UNESCO's sentence (#814). What is pinned: a kind offers its own list, a
 * museum offers none, and a value says which vocabulary it is from.
 */

import { describe, it, expect } from 'vitest';
import { typeOptionsFor, typeVocabularyOf } from './experienceTypes';

const WORLD_HERITAGE = 1;
const ART_MUSEUMS = 2;
const PUBLIC_ART = 3;

describe('typeOptionsFor', () => {
  it('offers a World Heritage site its three, and public art its two', () => {
    expect(typeOptionsFor(WORLD_HERITAGE).map(o => o.value)).toEqual(['cultural', 'natural', 'mixed']);
    expect(typeOptionsFor(PUBLIC_ART).map(o => o.value)).toEqual(['monument', 'sculpture']);
  });

  it('offers a museum nothing: an art museum is a kind, not a type', () => {
    expect(typeOptionsFor(ART_MUSEUMS)).toEqual([]);
    expect(typeOptionsFor(null)).toEqual([]);
    expect(typeOptionsFor(99)).toEqual([]);
  });

  it('keeps the vocabularies disjoint, so a value names its kind', () => {
    const all = [WORLD_HERITAGE, PUBLIC_ART].flatMap(kind => typeOptionsFor(kind).map(o => o.value));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('typeVocabularyOf', () => {
  it('explains a monument in public art\'s words and a natural site in World Heritage\'s', () => {
    expect(typeVocabularyOf('sculpture')?.what).toMatch(/monument or sculpture/);
    expect(typeVocabularyOf('natural')?.what).toMatch(/World Heritage/);
    expect(typeVocabularyOf('natural')?.what).not.toMatch(/monument/);
  });

  it('answers nothing for a value no kind declares', () => {
    // `art` was never a type: the literal every museum row carried is gone.
    expect(typeVocabularyOf('art')).toBeNull();
    expect(typeVocabularyOf(null)).toBeNull();
    expect(typeVocabularyOf(7)).toBeNull();
  });
});

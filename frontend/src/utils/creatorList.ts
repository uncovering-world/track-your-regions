/**
 * "Ivan Shishkin and Konstantin Savitsky" — the makers of a work, as a sentence.
 *
 * A work often has more than one, and the catalogue stores every one the source
 * names (#720): *Morning in a Pine Forest* is Shishkin's forest and Savitsky's
 * bears, the Moon Museum is six artists, the Fountain of Cybele seven. So every
 * surface that names a maker now names a list, and the two forms below are the
 * two the product actually needs.
 *
 * Its own module for the reason `plural.ts` is one: the sentence is the thing
 * that gets written differently in each of the nine places it appears, and a
 * work reading "Shishkin, Savitsky" on a tile and "Shishkin and Savitsky" on the
 * card beside it is the catalogue disagreeing with itself about a fact.
 */

import { plural } from './plural.js';

/**
 * Every maker, joined.
 *
 * For the surfaces with room to say it: a work's own card, the part a curator is
 * about to answer, a fact table's row. No serial comma, which is the rest of the
 * product's prose.
 */
export function creators(names: readonly string[] | null | undefined): string | null {
  const list = (names ?? []).map(name => name.trim()).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The first maker and how many others there are, for a row with one line to spend.
 *
 * Two names are given whole because two is the common case — 23 of the 30 stored
 * multi-maker works — and because "Ivan Shishkin and Konstantin Savitsky" is the
 * fact rather than a summary of it. Past two, the row would wrap and the fact
 * that survives is *who leads it and how many there are*: "Andy Warhol and 5
 * others" says the Moon Museum is a collaboration, which "Andy Warhol" alone
 * never did.
 */
export function creatorsBrief(names: readonly string[] | null | undefined): string | null {
  const list = (names ?? []).map(name => name.trim()).filter(Boolean);
  if (list.length <= 2) return creators(list);
  return `${list[0]} and ${plural(list.length - 1, 'other')}`;
}

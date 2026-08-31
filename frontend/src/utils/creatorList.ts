/**
 * "Ivan Shishkin and Konstantin Savitsky" — the makers of a work, as a sentence.
 *
 * A work often has more than one, and the catalogue stores every one the source
 * names (#720): *Morning in a Pine Forest* is Shishkin's forest and Savitsky's
 * bears, the Moon Museum is six artists, the Fountain of Cybele seven. So every
 * surface that names a maker now names a list, and the two forms below are the
 * two the product actually needs.
 *
 * **The stored order is not the source's** (ADR-0040). SPARQL exposes no
 * statement order, and the query the pool actually sends answers in reverse of
 * it. So who *leads* a collaboration is a judgement, and it is a curator's — the
 * short form below leads with a name only where one has been made.
 *
 * Its own module for the reason `plural.ts` is one: the sentence is the thing
 * that gets written differently in each of the places it appears, and a work
 * reading "Shishkin, Savitsky" on a tile and "Shishkin and Savitsky" on the card
 * beside it is the catalogue disagreeing with itself about a fact.
 */

import { plural } from './plural.js';

/** The names, trimmed and with the empties dropped — what both forms count. */
function usable(names: readonly string[] | null | undefined): string[] {
  return (names ?? []).map(name => name.trim()).filter(Boolean);
}

/**
 * Every maker, joined.
 *
 * For the surfaces with room to say it: a work's own card, the part a curator is
 * about to answer, a fact table's row. In the stored order, which is what a
 * curator sees and edits — no serial comma, which is the rest of the product's
 * prose.
 */
export function creators(names: readonly string[] | null | undefined): string | null {
  const list = usable(names);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The makers for a row with one line to spend.
 *
 * **Two names are given whole either way**, because "A and B" says they made it
 * together and nothing about which of them leads — and two is the common case,
 * 23 of the 30 stored multi-maker works.
 *
 * Past two, the row cannot hold the list, and what it says next depends on
 * whether anyone has vouched for the order. Unconfirmed it counts them — "6
 * artists" — because leading with a name is a claim about primacy and the stored
 * order is a query planner's, not the source's: the Moon Museum's list arrives
 * with David Novros in front and Andy Warhol last. Once a curator has claimed
 * the column, the first name *is* somebody's answer, and the row leads with it:
 * "Andy Warhol and 5 others", which says the thing is a collaboration where a
 * bare count does not.
 */
export function creatorsBrief(
  names: readonly string[] | null | undefined,
  confirmed = false,
  noun = 'artist',
): string | null {
  const list = usable(names);
  if (list.length <= 2) return creators(list);
  return confirmed
    ? `${list[0]} and ${plural(list.length - 1, 'other')}`
    : plural(list.length, noun);
}

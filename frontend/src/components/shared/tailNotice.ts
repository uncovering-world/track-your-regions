/**
 * The words of a crowded city's tail (ADR-0172, #2201), in both places that
 * show it: the folded row that ends a kind's group in Map mode's region list,
 * and the mark on a search answer the list leaves out.
 *
 * A place is in the tail when ten better-known places of its kind and type
 * stand within 10 km of it. Every kind that crowds takes those two numbers
 * (`experience_kinds.crowding_limit`, `crowding_radius_km`), so the sentence
 * says them rather than reading them off each kind.
 */

import { typeLabelFor } from '../../utils/experienceTypes';

/** The quiet mark beside a search answer the region's list leaves out: one word, explained on hover. */
export const TAIL_MARK = 'shadowed';

/** What the mark means, on hover. */
export const TAIL_REASON = 'Shadowed: ten better-known places of its type stand within 10 km of it, so the region\'s'
  + ' main list leaves it out.';

/** An open tail whose read failed, under its row. */
export const TAIL_FAILED = 'These places could not be loaded. Fold and open the row to try again.';

/** What the row that opens a tail means, on hover. */
export const TAIL_ROW_REASON = 'Shadowed: ten better-known places of their type stand within 10 km of each, so the'
  + ' main list leaves them out.';

/** How many a kind leaves out of one type, as the region's list answers it (`crowdedOut`). */
export interface TailCount {
  type: string | null;
  count: number;
}

/**
 * A type's plural where an `s` alone would be wrong. "Street art" counts no
 * pieces of itself and "flight of locks" pluralises its head.
 */
const IRREGULAR: Record<string, [string, string]> = {
  'street-art': ['piece of street art', 'pieces of street art'],
  'lock-flight': ['flight of locks', 'flights of locks'],
};

/** A kind's own name as a plural count reads it: "places of worship", "works of public art". */
const KIND_NOUNS: Record<number, string> = { 3: 'works of public art' };

/** "church" → "churches", "monastery" → "monasteries", "temple" → "temples". */
function pluralWord(word: string): string {
  if (/(s|sh|ch|x|z)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Types by name, a place with no type last. */
function byType(a: string | null, b: string | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return a.localeCompare(b);
}

/**
 * A type's noun for a count of it: "church" for one, "churches" for more, and
 * "other"/"others" for a place with no type. The type's own word in the kind's
 * vocabulary (`typeLabelFor`), lowercased.
 */
function typeNoun(kindId: number, type: string | null, count: number): string {
  if (type === null) return count === 1 ? 'other' : 'others';
  const irregular = IRREGULAR[type];
  if (irregular) return irregular[count === 1 ? 0 : 1];
  const word = typeLabelFor(kindId, type).toLowerCase();
  return count === 1 ? word : pluralWord(word);
}

/** "1 church", "37 churches", "2 others": the count first. */
export function typeCount(kindId: number, type: string | null, count: number): string {
  return `${count} ${typeNoun(kindId, type, count)}`;
}

/**
 * The folded row that ends a kind's group: "37 shadowed churches", or, where
 * the tail holds several types, "40 shadowed places of worship: 37 churches,
 * 2 chapels, 1 temple", the most numerous first. Null where the counts leave
 * nothing out. The row explains the word on hover (`TAIL_ROW_REASON`).
 */
export function tailLabel(kindId: number, kindName: string, counts: readonly TailCount[]): string | null {
  const shown = counts.filter(entry => entry.count > 0);
  const total = shown.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;
  if (shown.length === 1 && shown[0].type !== null) {
    return `${total} shadowed ${typeNoun(kindId, shown[0].type, total)}`;
  }
  const kindNoun = KIND_NOUNS[kindId] ?? kindName.toLowerCase();
  if (shown.length === 1) return `${total} shadowed ${total === 1 ? 'place' : kindNoun}`;
  const parts = [...shown]
    .sort((a, b) => b.count - a.count || byType(a.type, b.type))
    .map(entry => typeCount(kindId, entry.type, entry.count));
  return `${total} shadowed ${kindNoun}: ${parts.join(', ')}`;
}

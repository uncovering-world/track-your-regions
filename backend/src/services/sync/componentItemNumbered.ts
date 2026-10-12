/**
 * The component-item finder's third door (#1394): an item that carries a
 * component's number under another variant of the inscription. The list
 * numbers Mozu-Furuichi's Osamezuka Kofun `1593bis-006` and Wikidata
 * `1593-006`, so the reference reader, which matches a number exactly, leaves
 * the point without its item. The number is not an identity: an extension can
 * renumber the parts (Pompeii's `829ter-004` is Torre Annunziata's Villa B,
 * Wikidata's `829-004` the Villa of the Papyri), so the name decides
 * (`numberedMatches`) and a curator answers.
 */

import { listRef, parseWhcRef } from './unescoWikidata.js';
import type { CandidateItem } from './componentItemMatching.js';
import { componentNumbers, tooHeavy, type QueryHooks } from './componentItemQueries.js';

/**
 * A component number with its inscription's variant left out, as a key: the
 * property's number and the part. A list reference has its padding dropped
 * (`listRef`); a Wikidata value is read as it stands, so its `087-001` stays
 * a typo rather than Thebes' Temple of Karnak.
 */
export function componentKey(ref: string, fromList: boolean): string | null {
  const parsed = parseWhcRef(fromList ? listRef(ref) : ref);
  return parsed?.part ? `${parsed.site}|${parsed.part.toLowerCase()}` : null;
}

/**
 * The items carrying a point's number under another variant, keyed for the
 * points to look up: an item that carries the point's own reference is the
 * reference reader's, and the point holding it is resolved already.
 */
export function byComponentKey(items: readonly CandidateItem[]): Map<string, CandidateItem[]> {
  const byKey = new Map<string, CandidateItem[]>();
  for (const item of items) {
    for (const key of new Set((item.references ?? []).map(ref => componentKey(ref, false)))) {
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
  }
  return byKey;
}

/** The items under the point's number in another variant than its own. */
export function numberedFor(point: { externalRef: string }, byKey: ReadonlyMap<string, CandidateItem[]>): CandidateItem[] {
  const key = componentKey(point.externalRef, true);
  if (!key) return [];
  const own = listRef(point.externalRef).toLowerCase();
  return (byKey.get(key) ?? []).filter(item => !(item.references ?? []).some(ref => ref.trim().toLowerCase() === own));
}

/**
 * The component numbers, keyed, or none and `unread` where the query service
 * could not answer: the pass then keeps the numbered proposals it made before.
 */
export async function readComponentNumbers(hooks: QueryHooks): Promise<{ byKey: Map<string, CandidateItem[]>; unread: boolean }> {
  try {
    return { byKey: byComponentKey(await componentNumbers(hooks)), unread: false };
  } catch (error) {
    if (!tooHeavy(error)) throw error;
    return { byKey: new Map(), unread: true };
  }
}

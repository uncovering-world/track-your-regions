/**
 * A refusal a place kind makes after its tiers have decided, whichever tier or
 * door admitted the place: a place Wikidata says is gone (`gone.ts`, #2259), a
 * World Heritage site of several components (`serialSite.ts`, #2276). Such a
 * rule reads something other than the item's classes, so it binds every way in
 * by standing after all of them.
 */

import type { FilteredEntity } from '../syncContract.js';

/** How a run's item names itself to a refusal. */
export interface RefusedItemOf<T> {
  id: (item: T) => string;
  name: (item: T) => string;
  type?: (item: T) => string | null | undefined;
}

/**
 * Move every item `reasonOf` gives a reason for from `items` to `filtered`,
 * with that reason and the item's type, so a place the catalogue already
 * offers is refused as any refusal of it is — held for a curator, never
 * deleted. Returns the names it refused, in the run's order.
 */
export function moveRefused<T>(
  items: T[], filtered: FilteredEntity[], of: RefusedItemOf<T>, reasonOf: (item: T) => string | null,
): string[] {
  const kept: T[] = [];
  const refused: string[] = [];
  for (const item of items) {
    const reason = reasonOf(item);
    if (!reason) { kept.push(item); continue; }
    const type = of.type?.(item);
    filtered.push({ externalId: of.id(item), name: of.name(item), reason, ...(type ? { type } : {}) });
    refused.push(of.name(item));
  }
  items.splice(0, items.length, ...kept);
  return refused;
}

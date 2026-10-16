/**
 * What each kind of a region offers to narrow by type (#589): its id, the types
 * its places hold with how many each (`typeChoices`), and how many places it
 * holds. Read off the region's whole list of places, not the part the map's view
 * leaves, so a pan never takes a chip away from under a choice.
 */

import { offeredType, typeChoices, type TypeChoice } from './typeChoices';

export interface KindTypeEntry {
  kindId: number;
  choices: TypeChoice[];
  size: number;
}

interface PlaceKinds {
  kind_id: number;
  kind_name?: string | null;
  type?: string | null;
  kinds?: ReadonlyArray<{ kind_id: number; kind_name: string; type: string | null }> | null;
}

/** Per kind name, what its places offer: a place counts once under each of its kinds, as that kind's type. */
export function kindTypeIndex(places: ReadonlyArray<PlaceKinds>): Map<string, KindTypeEntry> {
  const rows = new Map<string, { kindId: number; types: Array<{ type: string | null }> }>();
  for (const place of places) {
    const kinds = place.kinds ?? [{ kind_id: place.kind_id, kind_name: place.kind_name ?? '', type: place.type ?? null }];
    for (const kind of kinds) {
      const entry = rows.get(kind.kind_name) ?? { kindId: kind.kind_id, types: [] };
      entry.types.push({ type: kind.type });
      rows.set(kind.kind_name, entry);
    }
  }
  return new Map([...rows].map(([name, { kindId, types }]) =>
    [name, { kindId, choices: typeChoices(types), size: types.length }]));
}

/**
 * The types the list and the map narrow by: each chosen type while its kind still
 * offers it, and none where it no longer does — hidden lost places, say — since a
 * choice with no chip left to take it back must narrow nothing.
 */
export function effectiveKindTypes(
  index: ReadonlyMap<string, KindTypeEntry>, chosen: ReadonlyMap<string, string>,
): Map<string, string> {
  const effective = new Map<string, string>();
  for (const [kindName, type] of chosen) {
    const offered = offeredType(index.get(kindName)?.choices ?? [], type);
    if (offered !== null) effective.set(kindName, offered);
  }
  return effective;
}

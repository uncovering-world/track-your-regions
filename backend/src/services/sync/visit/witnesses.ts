/**
 * Whether a place is one a visitor goes to, answered by independent witnesses
 * (#1768). The maintainer decided on 2026-10-20 (#1718) that a place is one
 * when two of four say so, each read from a different source:
 *
 * 1. `guide` — a Wikivoyage article uses the item (`usedByAGuide`, the
 *    `wikivoyage-usage` build);
 * 2. `photos` — at least `PHOTOS_NEEDED` files in the item's Commons category
 *    were taken within `PHOTO_REACH_M` of the place (`commonsPhotos.ts`);
 * 3. `formal` — Wikidata states a heritage designation (P1435), opening hours
 *    (P3025), a visitor count (P1174) or an official website (P856)
 *    (`visitFacts.ts`);
 * 4. `map` — OpenStreetMap maps something there that stands or that visitors
 *    are sent to (`mapWitness`).
 *
 * No one source is enough. Italian Wikivoyage lists Rome so closely that it
 * names the Regia and the Gardens of Sallust, where nothing stands, and
 * mappers tag Rungholt, drowned in 1362, as a dig. Two witnesses vouched for
 * 18 of dry run 178's 20 door sites and for none of its 9 places with nothing
 * to see, and for 76 of the 92 places worth a visit in #1718's set and 1 of
 * its 12 with nothing to see.
 *
 * Kind-agnostic: a kind decides where it asks (Archaeology asks of the places
 * its readership door alone admits, `archaeology/sites.ts`), and this module
 * says what each witness is.
 */

import type { OsmObject } from '../osm/types.js';

export type Witness = 'guide' | 'photos' | 'formal' | 'map';

/** The order a curator and a run's log read the witnesses in. */
export const WITNESSES = ['guide', 'photos', 'formal', 'map'] as const satisfies readonly Witness[];

/** How many witnesses a place needs (#1718). */
export const WITNESSES_NEEDED = 2;

/** Photographs in the item's category taken this close to the place count as taken there. */
export const PHOTO_REACH_M = 1000;
/** And this many of them make the photographs a witness. */
export const PHOTOS_NEEDED = 10;

/**
 * The statements that make the formal witness: a heritage designation, opening
 * hours, a visitor count and an official website. Each is a fact somebody
 * recorded about a place people go to; none says so alone.
 */
export const FORMAL_PROPERTIES = ['P1435', 'P3025', 'P1174', 'P856'] as const;

/** What Wikidata says of a place that bears on the witnesses (`visitFacts.ts`). */
export interface VisitFacts {
  /** Whether any of `FORMAL_PROPERTIES` is stated. */
  formal: boolean;
  /** The item's Commons category (P373), without the namespace, or null. */
  commonsCategory: string | null;
}

/** How each witness is named where a person reads it. */
export const WITNESS_WORDS: Record<Witness, string> = {
  guide: 'a travel guide',
  photos: 'photographs taken there',
  formal: "Wikidata's heritage, hours, visitors or website",
  map: 'the map',
};

/** `historic` values that name something standing a visitor goes to. */
const STANDING_HISTORIC = new Set([
  'temple', 'church', 'monument', 'city_gate', 'fountain', 'bridge', 'aqueduct', 'tomb', 'castle', 'memorial',
]);
/** `tourism` values that send a visitor there. */
const VISITED_TOURISM = new Set(['attraction', 'viewpoint', 'museum']);
/** `amenity` values that stand and are used. */
const STANDING_AMENITY = new Set(['place_of_worship', 'fountain']);
/** `man_made` values that stand. */
const STANDING_MAN_MADE = new Set(['bridge', 'column', 'obelisk']);

/** Whether one object says something stands there or that visitors are sent there. */
function objectWitnesses(tags: Readonly<Record<string, string>>): boolean {
  if (tags.opening_hours) return true;
  if (tags.tourism && VISITED_TOURISM.has(tags.tourism)) return true;
  if (tags.amenity && STANDING_AMENITY.has(tags.amenity)) return true;
  if (tags.man_made && STANDING_MAN_MADE.has(tags.man_made)) return true;
  if (tags.historic && STANDING_HISTORIC.has(tags.historic)) return true;
  // A building the mapper typed: `yes` says only that a building is there,
  // and `ruins` is what both the Temple of Vesta and the Comitium are mapped as.
  return !!tags.building && tags.building !== 'yes' && tags.building !== 'ruins';
}

/**
 * The map's witness: any object carrying the item that stands or that
 * visitors are sent to. A dig or ruins tag alone is not one, since the map
 * draws a dig at Rungholt and at the Comitium alike.
 */
export function mapWitness(objects: readonly OsmObject[]): boolean {
  return objects.some((object) => objectWitnesses(object.tags));
}

/** What each witness answered of one place. */
export type WitnessAnswers = Readonly<Record<Witness, boolean>>;

/** The witnesses that say yes, in their reading order. */
export function witnessesOf(answers: WitnessAnswers): Witness[] {
  return WITNESSES.filter((witness) => answers[witness]);
}

/** Whether a place has the witnesses it needs. */
export const isVisited = (witnesses: readonly Witness[]): boolean => witnesses.length >= WITNESSES_NEEDED;

/** The witnesses, said the way a person reads them: "a travel guide and the map", or "none". */
export function witnessWords(witnesses: readonly Witness[]): string {
  const words = witnesses.map((witness) => WITNESS_WORDS[witness]);
  if (words.length === 0) return 'none';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The types each kind files a place under, and the word a reader sees for each
 * (#2319).
 *
 * A type is a distinction inside a kind whose members a traveller still browses
 * together (ADR-0045): a tower is a pagoda, a minaret or a clock tower before a
 * tower; a square or a street is a stairway, a square, a promenade or a street.
 * The run writes the value onto a membership, and the reader filters by it and
 * names it. A kind's vocabulary is closed, and no two kinds share a value, so a
 * value alone says which kind's vocabulary it belongs to.
 *
 * One declaration for both sides, because the value and its word are one fact:
 * a type the run starts writing with no word beside it would reach a chip as its
 * raw spelling (`lock-flight`), and a word kept apart from the run's list drifts
 * from it with nothing to say so. Each entry carries both, so a type cannot be
 * declared without its word. The backend derives the type it writes from these
 * lists; the reader's options, labels and the review card's explanations read
 * them (`frontend/src/utils/experienceTypes.ts`).
 *
 * The order is the one a kind reads its types in where it reads them in order:
 * Towers, Bridges & engineering marvels, Squares & streets and Parks & gardens
 * file a place under the first type its classes name, so the Pont du Gard, an
 * aqueduct and a bridge, is an aqueduct. A curator's list of options shows the
 * same order. A kind that decides its type another way keeps the order a
 * curator reads best.
 */

/** A type a kind files a place under, and the word a reader sees for it. */
export interface PlaceTypeEntry {
  readonly value: string;
  readonly label: string;
}

/** Cultural, natural or mixed: which criteria a World Heritage site meets. */
export const WORLD_HERITAGE_TYPES = [
  { value: 'cultural', label: 'Cultural' },
  { value: 'natural', label: 'Natural' },
  { value: 'mixed', label: 'Mixed' },
] as const satisfies readonly PlaceTypeEntry[];

export const PUBLIC_ART_TYPES = [
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'fountain', label: 'Fountain' },
  { value: 'street-art', label: 'Street art' },
  { value: 'clock', label: 'Clock' },
] as const satisfies readonly PlaceTypeEntry[];

export const PLACES_OF_WORSHIP_TYPES = [
  { value: 'cathedral', label: 'Cathedral' },
  { value: 'church', label: 'Church' },
  { value: 'chapel', label: 'Chapel' },
  { value: 'monastery', label: 'Monastery' },
  { value: 'mosque', label: 'Mosque' },
  { value: 'temple', label: 'Temple' },
  { value: 'shrine', label: 'Shrine' },
  { value: 'synagogue', label: 'Synagogue' },
  { value: 'sacred mountain', label: 'Sacred mountain' },
  { value: 'holy site', label: 'Holy site' },
] as const satisfies readonly PlaceTypeEntry[];

/** The dig a traveller stands in and the museum that shows what was dug up: one list (ADR-0058). */
export const ARCHAEOLOGY_TYPES = [
  { value: 'site', label: 'Site' },
  { value: 'museum', label: 'Museum' },
] as const satisfies readonly PlaceTypeEntry[];

export const MONUMENTS_TYPES = [
  { value: 'memorial', label: 'Memorial' },
  { value: 'arch', label: 'Arch' },
  { value: 'column', label: 'Column' },
  { value: 'obelisk', label: 'Obelisk' },
  { value: 'monument', label: 'Monument' },
] as const satisfies readonly PlaceTypeEntry[];

/**
 * Read in this order (`towerType`): a pagoda, a minaret or a clock tower before a bell tower, a guyed mast before
 * an observation tower, a tower otherwise. A mast the map tells from a tower people go up is filed `mast` once the
 * run has decided (#2275).
 */
export const TOWERS_TYPES = [
  { value: 'pagoda', label: 'Pagoda' },
  { value: 'minaret', label: 'Minaret' },
  { value: 'clock-tower', label: 'Clock tower' },
  { value: 'bell-tower', label: 'Bell tower' },
  { value: 'mast', label: 'Mast' },
  { value: 'observation-tower', label: 'Observation tower' },
  { value: 'fortified-tower', label: 'Fortified tower' },
  { value: 'tower', label: 'Tower' },
] as const satisfies readonly PlaceTypeEntry[];

/** Read in this order (`bridgeType`): an aqueduct before a bridge, a waterway's works before a dam, a tunnel last. */
export const BRIDGES_TYPES = [
  { value: 'aqueduct', label: 'Aqueduct' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'inclined-plane', label: 'Inclined plane' },
  { value: 'boat-lift', label: 'Boat lift' },
  { value: 'lock-flight', label: 'Flight of locks' },
  { value: 'lock', label: 'Lock' },
  { value: 'dam', label: 'Dam' },
  { value: 'tunnel', label: 'Tunnel' },
] as const satisfies readonly PlaceTypeEntry[];

/** Read in this order (`squareType`): a stairway before a square, a promenade before a street. */
export const SQUARES_TYPES = [
  { value: 'stairway', label: 'Stairway' },
  { value: 'square', label: 'Square' },
  { value: 'promenade', label: 'Promenade' },
  { value: 'street', label: 'Street' },
] as const satisfies readonly PlaceTypeEntry[];

/** Read in this order (`parkType`): Kew is a botanical garden though a garden too. A proposed kind, filled by a dry run (#2254). */
export const PARKS_TYPES = [
  { value: 'botanical-garden', label: 'Botanical garden' },
  { value: 'garden', label: 'Garden' },
  { value: 'park', label: 'Park' },
] as const satisfies readonly PlaceTypeEntry[];

/** Every kind's vocabulary, by the kind's slug in the coverage register (`db/catalogue-coverage/kinds.jsonl`). */
export const TYPE_VOCABULARIES = {
  'world-heritage': WORLD_HERITAGE_TYPES,
  'public-art': PUBLIC_ART_TYPES,
  'places-of-worship': PLACES_OF_WORSHIP_TYPES,
  archaeology: ARCHAEOLOGY_TYPES,
  'monuments-and-memorials': MONUMENTS_TYPES,
  towers: TOWERS_TYPES,
  'bridges-and-engineering': BRIDGES_TYPES,
  'squares-and-streets': SQUARES_TYPES,
  'parks-and-gardens': PARKS_TYPES,
} as const;

/** A kind that files its places under types. */
export type TypedKindSlug = keyof typeof TYPE_VOCABULARIES;

/** The types a kind files a place under: `PlaceTypeOf<'towers'>` is `'pagoda' | … | 'tower'`. */
export type PlaceTypeOf<K extends TypedKindSlug> = (typeof TYPE_VOCABULARIES)[K][number]['value'];

/** A kind's types, in its order, as the values a run writes. */
export function typeValues<K extends TypedKindSlug>(kind: K): readonly PlaceTypeOf<K>[] {
  return TYPE_VOCABULARIES[kind].map((entry) => entry.value) as readonly PlaceTypeOf<K>[];
}

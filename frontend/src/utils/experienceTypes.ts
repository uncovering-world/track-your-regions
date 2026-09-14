/**
 * What types a kind of place has, and what each vocabulary means — decided once.
 *
 * A type is a distinction inside a kind whose members a traveller still browses
 * together (ADR-0045): a World Heritage site is cultural, natural or mixed; a
 * piece of public art is a monument or a sculpture; a place of worship is a
 * cathedral, church, chapel, monastery, mosque, temple, shrine or synagogue. An
 * art museum has no type; Archaeology has two, site and museum, because a
 * traveller browses the dig and its museum as one list (ADR-0058). The literal
 * `art` every museum row used to carry said nothing the kind does not (#814).
 * One closed vocabulary per kind, never one shared enum, which is why a value
 * alone says which kind's vocabulary it belongs to.
 *
 * The dialogs that let a curator set a type offer the kind's own list and
 * nothing else; the review card explains a proposed type in the words of the
 * vocabulary the value is from.
 */

export interface TypeOption {
  value: string;
  label: string;
}

/** A closed vocabulary and what it says about the object. */
export interface TypeVocabulary {
  options: TypeOption[];
  /** The fact on the ground, in the review card's words. */
  what: string;
  /** What a change usually means, and what to check. */
  whenItChanges: string;
}

const WORLD_HERITAGE: TypeVocabulary = {
  options: [
    { value: 'cultural', label: 'Cultural' },
    { value: 'natural', label: 'Natural' },
    { value: 'mixed', label: 'Mixed' },
  ],
  what: 'Cultural, natural or mixed — which kind of criteria the World Heritage site meets.',
  whenItChanges: 'Reclassified by the Centre, usually with an extension; check the criteria row.',
};

const PUBLIC_ART: TypeVocabulary = {
  options: [
    { value: 'monument', label: 'Monument' },
    { value: 'sculpture', label: 'Sculpture' },
  ],
  what: 'Which of the source’s two lists the object came from — monument or sculpture.',
  whenItChanges: 'Reclassified on Wikidata. The same object either way; nothing readers browse by changes.',
};

const PLACES_OF_WORSHIP: TypeVocabulary = {
  options: [
    { value: 'cathedral', label: 'Cathedral' },
    { value: 'church', label: 'Church' },
    { value: 'chapel', label: 'Chapel' },
    { value: 'monastery', label: 'Monastery' },
    { value: 'mosque', label: 'Mosque' },
    { value: 'temple', label: 'Temple' },
    { value: 'shrine', label: 'Shrine' },
    { value: 'synagogue', label: 'Synagogue' },
  ],
  what: 'What kind of place of worship it is, read from Wikidata’s classes: a cathedral before a church, a monastery that is also a cathedral is a cathedral.',
  whenItChanges: 'Retyped on Wikidata. The same place either way; the filter chip it answers to changes.',
};

const ARCHAEOLOGY: TypeVocabulary = {
  options: [
    { value: 'site', label: 'Site' },
    { value: 'museum', label: 'Museum' },
  ],
  what: 'An excavation a traveller stands in, or the museum that shows what was dug up — one list, two chips.',
  whenItChanges: 'Retyped by the run from Wikidata’s classes; the same place either way.',
};

/**
 * The kinds' vocabularies, by the id each kind's source row is seeded with in
 * `db/init/01-schema.sql` (1 World Heritage, 2 Art Museums, 3 Public Art &
 * Monuments, 4 Places of worship, 5 Archaeology). Until the kind table of
 * ADR-0045 §4 lands, a kind is its source row and the id is what every read
 * carries — a name is renamed (#815). A kind absent here has no types; Art
 * Museums is absent on purpose.
 */
const VOCABULARY_BY_KIND: Record<number, TypeVocabulary> = {
  1: WORLD_HERITAGE,
  3: PUBLIC_ART,
  4: PLACES_OF_WORSHIP,
  5: ARCHAEOLOGY,
};

/** The types a curator may set on an object of this kind — none for an art museum. */
export function typeOptionsFor(kindId: number | null | undefined): TypeOption[] {
  return kindId != null ? VOCABULARY_BY_KIND[kindId]?.options ?? [] : [];
}

/** The Archaeology kind, whose holdings were dug up rather than made for a wall. */
const ARCHAEOLOGY_KIND_ID = 5;

/**
 * What a reader calls the things inside an object of this kind: an archaeology
 * museum's case of steles and pottery holds **finds**, every other kind holds
 * **works** (ADR-0058).
 *
 * One rule, because two surfaces say it. Map mode's list (`ArtworksList`) and
 * Discover's section (`ContentsSection`) describe the same British Museum, and a
 * reader who opened it in one and then the other used to be told it held notable
 * finds and then notable works (#885). A kind absent here holds works: the noun
 * is the art museums' and is what every kind but this one has always used.
 */
export function holdingsNoun(kindId: number | null | undefined): 'finds' | 'works' {
  return kindId === ARCHAEOLOGY_KIND_ID ? 'finds' : 'works';
}

/**
 * Whether this place is one the catalogue can draw an outline around: an
 * archaeology **site**, and nothing else it holds today (ADR-0059). An
 * archaeology *museum* is a building at an address, like every other museum,
 * church and monument — a boundary would be its footprint, which answers no
 * question a traveller asks.
 *
 * Asked *before* a read, not after one: the only way to find an extent is the
 * single-experience read, that route sits under `publicReadLimiter` beside the
 * reads that draw the list itself, and a map that asked it of every place the
 * pointer crossed is how a list refuses to load itself (the note at the foot of
 * `api/experienceCardQueries.ts`). So the kind decides, from the row already
 * loaded, whether the question is worth asking at all.
 */
export function hasExtent(
  kindId: number | null | undefined,
  type: string | null | undefined,
): boolean {
  return kindId === ARCHAEOLOGY_KIND_ID && type === 'site';
}

/**
 * The vocabulary a type value belongs to, told from the value: the vocabularies
 * are closed and disjoint, so `natural` is World Heritage's and `sculpture` is
 * public art's wherever the value appears. `null` for a value no kind declares.
 */
export function typeVocabularyOf(value: unknown): TypeVocabulary | null {
  if (typeof value !== 'string') return null;
  return Object.values(VOCABULARY_BY_KIND)
    .find(vocabulary => vocabulary.options.some(option => option.value === value)) ?? null;
}

/**
 * What types a kind of place has, and what each vocabulary means — decided once.
 *
 * A type is a distinction inside a kind whose members a traveller still browses
 * together (ADR-0045): a World Heritage site is cultural, natural or mixed; a
 * piece of public art is a monument or a sculpture. A museum has no type — an
 * art museum and an archaeology museum are two kinds, not two types — and the
 * literal `art` every museum row used to carry said nothing the kind does not
 * (#814). One closed vocabulary per kind, never one shared enum, which is why
 * a value alone says which kind's vocabulary it belongs to.
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

/**
 * The kinds' vocabularies, by the id each kind's source row is seeded with in
 * `db/init/01-schema.sql` (1 World Heritage, 2 Art Museums, 3 Public Art &
 * Monuments). Until the kind table of ADR-0045 §4 lands, a kind is its source
 * row and the id is what every read carries — a name is renamed (#815). A kind
 * absent here has no types; a museum is absent on purpose.
 */
const VOCABULARY_BY_KIND: Record<number, TypeVocabulary> = {
  1: WORLD_HERITAGE,
  3: PUBLIC_ART,
};

/** The types a curator may set on an object of this kind — none for a museum. */
export function typeOptionsFor(categoryId: number | null | undefined): TypeOption[] {
  return categoryId != null ? VOCABULARY_BY_KIND[categoryId]?.options ?? [] : [];
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

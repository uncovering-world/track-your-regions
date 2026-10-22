/**
 * What types a kind of place has, and what each vocabulary means — decided once.
 *
 * A type is a distinction inside a kind whose members a traveller still browses
 * together (ADR-0045): a World Heritage site is cultural, natural or mixed; a
 * piece of public art is a sculpture, a fountain or street art; a monument is a
 * memorial, an arch, a column, an obelisk or a monument; a place of worship is a
 * cathedral, church, chapel, monastery, mosque, temple, shrine or synagogue; a
 * tower is a pagoda, a minaret, a clock tower, a bell tower, an observation tower, a
 * fortified tower or a tower; an engineering work is an aqueduct, a bridge, a
 * dam, a canal or a tunnel; a square or a street is a stairway, a square, a
 * promenade or a street. An
 * art museum has no type; Archaeology has two, site and museum, because a
 * traveller browses the dig and its museum as one list (ADR-0058). An art
 * museum carries no literal `art`: it says nothing the kind does not (#814).
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
    { value: 'sculpture', label: 'Sculpture' },
    { value: 'fountain', label: 'Fountain' },
    { value: 'street-art', label: 'Street art' },
  ],
  what: 'What the work is, read from Wikidata’s classes: a fountain before a sculpture, a mural as street art.',
  whenItChanges: 'Retyped on Wikidata. The same work either way; the filter chip it answers to changes.',
};

const MONUMENTS: TypeVocabulary = {
  options: [
    { value: 'memorial', label: 'Memorial' },
    { value: 'arch', label: 'Arch' },
    { value: 'column', label: 'Column' },
    { value: 'obelisk', label: 'Obelisk' },
    { value: 'monument', label: 'Monument' },
  ],
  what: 'What was raised, read from Wikidata’s classes: the form first — an arch, a column, an obelisk — then a memorial, and a monument otherwise.',
  whenItChanges: 'Retyped on Wikidata. The same monument either way; the filter chip it answers to changes.',
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

const TOWERS: TypeVocabulary = {
  options: [
    { value: 'pagoda', label: 'Pagoda' },
    { value: 'minaret', label: 'Minaret' },
    { value: 'clock-tower', label: 'Clock tower' },
    { value: 'bell-tower', label: 'Bell tower' },
    { value: 'observation-tower', label: 'Observation tower' },
    { value: 'fortified-tower', label: 'Fortified tower' },
    { value: 'tower', label: 'Tower' },
  ],
  what: 'What kind of tower it is, read from Wikidata’s classes: a pagoda, a minaret or a clock tower before a bell tower, a TV tower as an observation tower, and a tower otherwise.',
  whenItChanges: 'Retyped on Wikidata. The same tower either way; the filter chip it answers to changes.',
};

const BRIDGES: TypeVocabulary = {
  options: [
    { value: 'aqueduct', label: 'Aqueduct' },
    { value: 'bridge', label: 'Bridge' },
    { value: 'dam', label: 'Dam' },
    { value: 'canal', label: 'Canal' },
    { value: 'tunnel', label: 'Tunnel' },
  ],
  what: 'What was built, read from Wikidata’s classes: an aqueduct before a bridge, so the Pont du Gard is an aqueduct, and a bridge before a tunnel.',
  whenItChanges: 'Retyped on Wikidata. The same work either way; the filter chip it answers to changes.',
};

const SQUARES: TypeVocabulary = {
  options: [
    { value: 'stairway', label: 'Stairway' },
    { value: 'square', label: 'Square' },
    { value: 'promenade', label: 'Promenade' },
    { value: 'street', label: 'Street' },
  ],
  what: 'What a visitor walks, read from Wikidata’s classes: a stairway before a square, so the Spanish Steps are a stairway, and a promenade before a street.',
  whenItChanges: 'Retyped on Wikidata. The same place either way; the filter chip it answers to changes.',
};

/**
 * The kinds' vocabularies, by the id each kind's source row is seeded with in
 * `db/init/01-schema.sql` (1 World Heritage, 2 Art Museums, 3 Public art,
 * 4 Places of worship, 5 Archaeology, 6 Monuments & memorials, 7 Towers,
 * 8 Bridges & engineering marvels, 9 Squares & streets). Until the kind
 * table of ADR-0045 §4 lands, a kind is its source row and the id is what
 * every read carries — a name is renamed (#815). A kind absent here has no types; Art
 * Museums is absent on purpose.
 */
const VOCABULARY_BY_KIND: Record<number, TypeVocabulary> = {
  1: WORLD_HERITAGE,
  3: PUBLIC_ART,
  4: PLACES_OF_WORSHIP,
  5: ARCHAEOLOGY,
  6: MONUMENTS,
  7: TOWERS,
  8: BRIDGES,
  9: SQUARES,
};

/** The types a curator may set on an object of this kind — none for an art museum. */
export function typeOptionsFor(kindId: number | null | undefined): TypeOption[] {
  return kindId != null ? VOCABULARY_BY_KIND[kindId]?.options ?? [] : [];
}

/** A type as the kind's vocabulary names it ("cultural" reads "Cultural"), its own value where the kind has no word for it. */
export function typeLabelFor(kindId: number | null | undefined, value: string): string {
  return typeOptionsFor(kindId).find(option => option.value === value)?.label ?? value;
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
 * reader who opens it in one and then the other must not be told it holds notable
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

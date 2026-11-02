/**
 * What types a kind of place has, and what each vocabulary means — decided once.
 *
 * A type is a distinction inside a kind whose members a traveller still browses
 * together (ADR-0045): a World Heritage site is cultural, natural or mixed; a
 * piece of public art is a sculpture, a fountain, street art or a clock; a monument is a
 * memorial, an arch, a column, an obelisk or a monument; a place of worship is a
 * cathedral, church, chapel, monastery, mosque, temple, shrine, synagogue, sacred
 * mountain or holy site; a
 * tower is a pagoda, a minaret, a clock tower, a bell tower, an observation tower, a
 * fortified tower or a tower; an engineering work is an aqueduct, a bridge, a
 * dam, an inclined plane, a boat lift, a flight of locks, a lock or a tunnel; a
 * square or a street is a stairway, a square, a
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
    { value: 'clock', label: 'Clock' },
  ],
  what: 'What the work is, read from Wikidata’s classes: a public clock with a show as a clock, a fountain before a sculpture, a mural as street art.',
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
    { value: 'sacred mountain', label: 'Sacred mountain' },
    { value: 'holy site', label: 'Holy site' },
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
    { value: 'inclined-plane', label: 'Inclined plane' },
    { value: 'boat-lift', label: 'Boat lift' },
    { value: 'lock-flight', label: 'Flight of locks' },
    { value: 'lock', label: 'Lock' },
    { value: 'tunnel', label: 'Tunnel' },
  ],
  what: 'What was built, read from Wikidata’s classes: an aqueduct before a bridge, so the Pont du Gard is an aqueduct, and a bridge before a tunnel. On a waterway, a lock Wikidata also files as a dam is a lock (the Soo Locks), unless the dam is a power station, which stays a dam; a lift that is also a lock is a boat lift (the Peterborough Lift Lock); and a flight of locks is a flight before a lock.',
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

/** A type as a chip names it: the vocabulary's word, or the stored value capitalised where it has none ("cultural" reads "Cultural"). */
export function typeWordFor(kindId: number | null | undefined, type: string): string {
  const label = typeLabelFor(kindId, type);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * A membership's kind with its type, as a card names it (#2217): *Monuments &
 * memorials · Arch*. A kind with a vocabulary whose membership carries no type
 * says so, *type not set*, since such a place answers to none of the kind's type
 * filters; a kind with no vocabulary (Art Museums) is named alone.
 */
export function kindWithType(kindId: number | null | undefined, kindName: string, type: string | null | undefined): string {
  if (typeOptionsFor(kindId).length === 0) return kindName;
  return `${kindName} · ${type ? typeWordFor(kindId, type) : 'type not set'}`;
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

/**
 * A type's plural where an `s` alone would be wrong. "Street art" counts no
 * pieces of itself and "flight of locks" pluralises its head.
 */
const IRREGULAR: Record<string, [string, string]> = {
  'street-art': ['piece of street art', 'pieces of street art'],
  'lock-flight': ['flight of locks', 'flights of locks'],
};

/** "church" → "churches", "monastery" → "monasteries", "temple" → "temples". */
function pluralWord(word: string): string {
  if (/(s|sh|ch|x|z)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * A type's noun for a count of it: "church" for one, "churches" for more, and
 * "other"/"others" for a place with no type. The type's own word in the kind's
 * vocabulary (`typeLabelFor`), lowercased. Beside the vocabularies, so a
 * count of a type reads alike wherever one is said: a crowded city's tail and
 * the window a curator sorts it in.
 */
export function typeNoun(kindId: number, type: string | null, count: number): string {
  if (type === null) return count === 1 ? 'other' : 'others';
  const irregular = IRREGULAR[type];
  if (irregular) return irregular[count === 1 ? 0 : 1];
  const word = typeLabelFor(kindId, type).toLowerCase();
  return count === 1 ? word : pluralWord(word);
}

/**
 * A type's plural as a heading or a button leads with it: "Squares",
 * "Churches", "Flights of locks"; the kind's own name for a place with no type.
 */
export function typePluralWord(kindId: number, kindName: string, type: string | null): string {
  const noun = type === null ? kindName : typeNoun(kindId, type, 2);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

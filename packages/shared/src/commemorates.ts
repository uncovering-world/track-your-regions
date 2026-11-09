/**
 * Whom or what a place commemorates (#2144): the value Public art's and
 * Monuments & memorials' runs store as `metadata.commemorates`, the reader's
 * card shows as its "Commemorates" line and a review card words, read alike
 * on both sides (ADR-0065).
 *
 * The value names the subjects and the one step of the reading that named
 * them (`via`): Wikidata's *commemorates* statement first, then English
 * Wikipedia's *Monuments and memorials to …* categories, the main subject and
 * the namesake where each is a person or an event, the *Statues of …*
 * categories, and last the person a statue depicts
 * (`backend/src/services/sync/places/commemorates.ts`). Two values are the same
 * when they name the same items (`sameSubjects`): a label or an article
 * Wikidata re-words, or another step naming the same people, changes nothing
 * a curator is asked about.
 *
 * A curator corrects the list from the place's curation dialog and the value is
 * then theirs (`via: 'curator'`, `CURATOR_COMMEMORATION`), claimed as a website
 * is. Their list may be empty: India Gate commemorating nobody is a decision a
 * run must not undo, and a claim protects only a key the stored row carries, so
 * "nobody" is stored as an empty list rather than as no value. Such a value
 * names nobody: no card line, no subject in the API, and the same as no value
 * to `sameSubjects`.
 */

/** The steps of the reading, in the order they are tried; the first that names anyone answers. */
export const COMMEMORATION_STEPS = [
  'commemorates',
  'memorials-category',
  'main-subject',
  'named-after',
  'statues-category',
  'depicts',
] as const;

export type CommemorationStep = (typeof COMMEMORATION_STEPS)[number];

/** The `via` of a curator's own list: no step of the reading, and the one `via` whose list may be empty. */
export const CURATOR_COMMEMORATION = 'curator';

/**
 * The most subjects a place names, read or listed by a curator: a run keeps the
 * first this many a step yields, and a curator's list may hold as many, so a
 * list a run stored can always be saved back with one name removed.
 */
export const MAX_COMMEMORATED_SUBJECTS = 50;

/** Who named a stored value's subjects: a step of the reading, or a curator. */
export type CommemorationVia = CommemorationStep | typeof CURATOR_COMMEMORATION;

/** One subject: its Wikidata item, its label, and its English Wikipedia article where it has one. */
export interface CommemoratedSubject {
  item: string;
  label: string;
  articleUrl: string | null;
}

/** What `metadata.commemorates` holds: the subjects, and the step or the curator that named them. */
export interface Commemorates {
  via: CommemorationVia;
  subjects: CommemoratedSubject[];
}

const VIAS: ReadonlySet<string> = new Set<string>([...COMMEMORATION_STEPS, CURATOR_COMMEMORATION]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One stored subject, key by key, or null where it names no item or no label. */
function subjectOf(value: unknown): CommemoratedSubject | null {
  if (!isRecord(value) || typeof value.item !== 'string' || typeof value.label !== 'string' || !value.label) return null;
  return { item: value.item, label: value.label, articleUrl: typeof value.articleUrl === 'string' ? value.articleUrl : null };
}

/**
 * A stored value in this shape, key by key, or null where it is none or a
 * reading that names nobody: stored JSON reaches a reader only through the keys
 * named here. A curator's list is answered even empty, since that is their word
 * that the place commemorates nobody; a reader of the subjects shows none.
 */
export function commemoratesOf(value: unknown): Commemorates | null {
  if (!isRecord(value) || typeof value.via !== 'string' || !VIAS.has(value.via) || !Array.isArray(value.subjects)) return null;
  const via = value.via as CommemorationVia;
  const subjects = value.subjects.map(subjectOf).filter((s): s is CommemoratedSubject => s !== null);
  return subjects.length || via === CURATOR_COMMEMORATION ? { via, subjects } : null;
}

/** The items a stored value names, none for anything not in this shape. */
export function subjectItems(value: unknown): string[] {
  return commemoratesOf(value)?.subjects.map(subject => subject.item) ?? [];
}

/**
 * Whether two stored values name the same items, whatever their order, labels,
 * articles or step: a curator's empty list and no value both name nobody.
 */
export function sameSubjects(a: unknown, b: unknown): boolean {
  const [left, right] = [new Set(subjectItems(a)), new Set(subjectItems(b))];
  return left.size === right.size && [...left].every(item => right.has(item));
}

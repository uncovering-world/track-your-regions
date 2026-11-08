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

/** One subject: its Wikidata item, its label, and its English Wikipedia article where it has one. */
export interface CommemoratedSubject {
  item: string;
  label: string;
  articleUrl: string | null;
}

/** What `metadata.commemorates` holds: the subjects, and the step that named them. */
export interface Commemorates {
  via: CommemorationStep;
  subjects: CommemoratedSubject[];
}

const STEPS: ReadonlySet<string> = new Set(COMMEMORATION_STEPS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One stored subject, key by key, or null where it names no item or no label. */
function subjectOf(value: unknown): CommemoratedSubject | null {
  if (!isRecord(value) || typeof value.item !== 'string' || typeof value.label !== 'string' || !value.label) return null;
  return { item: value.item, label: value.label, articleUrl: typeof value.articleUrl === 'string' ? value.articleUrl : null };
}

/**
 * A stored value in this shape, key by key, or null where it is none or names
 * nobody: stored JSON reaches a reader only through the keys named here.
 */
export function commemoratesOf(value: unknown): Commemorates | null {
  if (!isRecord(value) || typeof value.via !== 'string' || !STEPS.has(value.via) || !Array.isArray(value.subjects)) return null;
  const subjects = value.subjects.map(subjectOf).filter((s): s is CommemoratedSubject => s !== null);
  return subjects.length ? { via: value.via as CommemorationStep, subjects } : null;
}

/** The items a stored value names, none for anything not in this shape. */
export function subjectItems(value: unknown): string[] {
  return commemoratesOf(value)?.subjects.map(subject => subject.item) ?? [];
}

/** Whether two stored values name the same items, whatever their order, labels, articles or step. */
export function sameSubjects(a: unknown, b: unknown): boolean {
  const [left, right] = [new Set(subjectItems(a)), new Set(subjectItems(b))];
  return left.size === right.size && [...left].every(item => right.has(item));
}

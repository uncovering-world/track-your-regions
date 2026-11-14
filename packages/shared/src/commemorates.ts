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
 * categories, the person a statue depicts, and last, for a place none of
 * those names, the linked article two language models both read from the
 * lead of its English Wikipedia article as its dedication (#2472)
 * (`backend/src/services/sync/places/commemorates.ts`). Two values are the same
 * when they name the same items in the same roles (`sameSubjects`): a label or
 * an article Wikidata re-words, or another step naming the same people,
 * changes nothing a curator is asked about.
 *
 * A curator corrects the list from the place's curation dialog and the value is
 * then theirs (`via: 'curator'`, `CURATOR_COMMEMORATION`), claimed as a website
 * is. Their list may be empty: India Gate commemorating nobody is a decision a
 * run must not undo, and a claim protects only a key the stored row carries, so
 * "nobody" is stored as an empty list rather than as no value. Such a value
 * names nobody: no card line, no subject in the API, and the same as no value
 * to `sameSubjects`.
 *
 * A holy figure a religious work shows is not whom it commemorates (#2404):
 * Christ the Redeemer depicts Jesus Christ and the Tian Tan Buddha the Buddha,
 * and neither was raised to remember them. The reading keeps such a figure
 * apart, as `metadata.depicts` in the same shape (`Depicts`), and the card
 * says "Depicts: Jesus Christ" on a line of its own. Only the steps that read
 * what a work shows name one (`DEPICTION_STEPS`); a statement or a category
 * that says whom a place is a memorial to stays a dedication. A curator
 * corrects the line as they correct *Commemorates*, and may move a subject
 * from one line to the other (#2421): Big Vishnu depicts Vishnu as well as
 * Garuda. Their list is theirs (`via: 'curator'`), claimed and kept the same way.
 *
 * The same line also names everyone else a work shows, as Wikidata's
 * *depicts* names them (#2436): the people of a scene, figures of fiction,
 * myth and legend, a personification. The Republic Monument in Istanbul
 * commemorates none of its five founders and depicts all five. Nobody the
 * dedication names is named again.
 *
 * A subject may carry the form the work shows it in (#2485), its role, stored
 * without the "as" the card puts before it: the Neptune Fountain in Berlin
 * shows the Rhine, the Elbe, the Oder and the Vistula as women, and the Lady
 * Godiva statue in Coventry shows Lady Godiva as an equestrian. A run reads it
 * from Wikidata's *object of statement has role* on the place's *depicts*
 * statement, a curator types it, and the card names it after the figures that
 * share it (`subjectLineParts`). A subject without one reads as it always has.
 */

/**
 * The sources whose runs read whom a place commemorates and what it depicts:
 * Public art (3) and Monuments & memorials (6), read in one pass. A place
 * either holds may carry both lines, so its curation dialog corrects them, and
 * every other run keeps what the place holds (#2144, #2404, #2421).
 */
export const SUBJECT_LINE_SOURCE_IDS: readonly number[] = [3, 6];

/** The steps of the reading, in the order they are tried; the first that names anyone answers. */
export const COMMEMORATION_STEPS = [
  'commemorates',
  'memorials-category',
  'main-subject',
  'named-after',
  'statues-category',
  'depicts',
  'lead',
] as const;

export type CommemorationStep = (typeof COMMEMORATION_STEPS)[number];

/**
 * The steps that read what a work shows rather than whom it was raised for:
 * the only ones whose holy figures are kept as `metadata.depicts` (#2404).
 */
export const DEPICTION_STEPS = ['main-subject', 'statues-category', 'depicts'] as const satisfies readonly CommemorationStep[];

export type DepictionStep = (typeof DEPICTION_STEPS)[number];

/**
 * The `via` of a reading whose war the place's English Wikipedia lead narrowed
 * to the battle, campaign or other event the place is for (#2404, #2412): the
 * Soviet War Memorial in Treptower Park, said by Wikidata to commemorate World
 * War II, commemorates the Battle of Berlin.
 */
export const WARS_NARROWED_BY_LEAD = 'war-narrowed-by-lead';

/**
 * The `via` of a reading whose war the place's own significant event within it
 * replaced (#2412): Wikidata says the Hiroshima Peace Memorial's significant
 * event is the atomic bombing of Hiroshima, and that is what it commemorates
 * of World War II.
 */
export const WARS_NARROWED_BY_EVENT = 'war-narrowed-by-event';

/**
 * The `via` of a reading that named only a war, replaced by the one person a
 * bust or statue shows (#2412): the bust of Roman Shukhevych in Edmonton,
 * filed under *World War II memorials in Canada*, commemorates him.
 */
export const WARS_NARROWED_TO_PERSON = 'war-narrowed-to-person';

/** The `via` of a curator's own list: no step of the reading, and the one `via` whose list may be empty. */
export const CURATOR_COMMEMORATION = 'curator';

/**
 * The most subjects a place names, read or listed by a curator: a run keeps the
 * first this many a step yields, and a curator's list may hold as many, so a
 * list a run stored can always be saved back with one name removed.
 */
export const MAX_COMMEMORATED_SUBJECTS = 50;

/** The ways a war a reading names is narrowed to what the place is for. */
export type WarNarrowing = typeof WARS_NARROWED_BY_EVENT | typeof WARS_NARROWED_BY_LEAD | typeof WARS_NARROWED_TO_PERSON;

/** Who named a stored value's subjects: a step of the reading, a narrowing of its war, or a curator. */
export type CommemorationVia = CommemorationStep | WarNarrowing | typeof CURATOR_COMMEMORATION;

/** The longest role a subject carries: a short phrase, "women" or "equestrian", never a sentence. */
export const MAX_SUBJECT_ROLE_LENGTH = 60;

/**
 * One subject: its Wikidata item, its label, its English Wikipedia article
 * where it has one, and the form the work shows it in where one is said.
 */
export interface CommemoratedSubject {
  item: string;
  label: string;
  articleUrl: string | null;
  /** The role, without "as" (#2485): `women`, `equestrian`. Absent, never empty, where none is said. */
  role?: string;
}

/** What `metadata.commemorates` holds: the subjects, and the step or the curator that named them. */
export interface Commemorates {
  via: CommemorationVia;
  subjects: CommemoratedSubject[];
}

/**
 * What `metadata.depicts` holds: the holy figures a religious work shows and
 * everyone else Wikidata's *depicts* names, and the step that named the first
 * (`via: 'depicts'` for a work with no holy figure), or the curator that named
 * them. A run's list is never empty; a curator's may be, as their word that
 * the work shows no named figure (#2421).
 */
export interface Depicts {
  via: DepictionStep | typeof CURATOR_COMMEMORATION;
  subjects: CommemoratedSubject[];
}

const VIAS: ReadonlySet<string> = new Set<string>([
  ...COMMEMORATION_STEPS, WARS_NARROWED_BY_EVENT, WARS_NARROWED_BY_LEAD, WARS_NARROWED_TO_PERSON, CURATOR_COMMEMORATION,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A role as it is stored (#2485): its spaces tidied, and the "as" a curator may
 * type before it taken off, since the card says it. Empty where nothing is left.
 */
export function tidyRole(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/^as\s+/i, '');
}

/** One stored subject, key by key, or null where it names no item or no label; a role only where one is said. */
function subjectOf(value: unknown): CommemoratedSubject | null {
  if (!isRecord(value) || typeof value.item !== 'string' || typeof value.label !== 'string' || !value.label) return null;
  const subject = { item: value.item, label: value.label, articleUrl: typeof value.articleUrl === 'string' ? value.articleUrl : null };
  const role = typeof value.role === 'string' ? tidyRole(value.role) : '';
  return role ? { ...subject, role } : subject;
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

const DEPICTION_VIAS: ReadonlySet<string> = new Set<string>([...DEPICTION_STEPS, CURATOR_COMMEMORATION]);

/**
 * A stored `metadata.depicts` in this shape, key by key, or null where it is
 * none or names nobody. A curator's list is kept even when it is empty, as
 * `commemoratesOf` keeps one (#2421): the work shows no named figure.
 */
export function depictsOf(value: unknown): Depicts | null {
  if (!isRecord(value) || typeof value.via !== 'string' || !DEPICTION_VIAS.has(value.via) || !Array.isArray(value.subjects)) return null;
  const via = value.via as Depicts['via'];
  const subjects = value.subjects.map(subjectOf).filter((s): s is CommemoratedSubject => s !== null);
  return subjects.length || via === CURATOR_COMMEMORATION ? { via, subjects } : null;
}

/** The items a stored value names, none for anything not in this shape. */
export function subjectItems(value: unknown): string[] {
  return commemoratesOf(value)?.subjects.map(subject => subject.item) ?? [];
}

/**
 * The items both of a place's lines name, whom it commemorates and what it
 * depicts, each read as stored: none where a subject stands on one line. A
 * curator's edit and the publication of a held line keep it so (#2421), and so
 * does a run beside a curator's claimed line (#2436).
 */
export function onBothLines(commemorates: unknown, depicts: unknown): string[] {
  const depicted = new Set(depictsOf(depicts)?.subjects.map(subject => subject.item) ?? []);
  return subjectItems(commemorates).filter(item => depicted.has(item));
}

/** Each subject a stored value names, as its item and its role: what `sameSubjects` compares. */
function subjectKeys(value: unknown): Set<string> {
  return new Set(commemoratesOf(value)?.subjects.map(subject => `${subject.item} ${subject.role ?? ''}`) ?? []);
}

/**
 * Whether two stored values name the same items in the same roles, whatever
 * their order, labels, articles or step: a curator's empty list and no value
 * both name nobody. A stored `metadata.depicts` is compared the same way, its
 * steps being steps of the reading. A role is part of the subject (#2485): a
 * curator's "the Rhine as women" is not the run's plain "the Rhine", so a
 * reading without the role never reads as the line the curator saved.
 */
export function sameSubjects(a: unknown, b: unknown): boolean {
  const [left, right] = [subjectKeys(a), subjectKeys(b)];
  return left.size === right.size && [...left].every(key => right.has(key));
}

/** What a subject must carry to be grouped by its role: the read's `role: null` and the stored shape's absent role alike. */
export interface RoledSubject {
  role?: string | null;
}

/**
 * The subjects by role (#2485): those without one first, then each role in the
 * order its first figure is listed, each group's figures in their own order.
 */
export function subjectGroups<T extends RoledSubject>(subjects: readonly T[]): { role: string | null; subjects: T[] }[] {
  const groups = new Map<string, T[]>([['', []]]);
  for (const subject of subjects) {
    const role = subject.role ?? '';
    groups.set(role, [...(groups.get(role) ?? []), subject]);
  }
  return [...groups].filter(([, members]) => members.length).map(([role, members]) => ({ role: role || null, subjects: members }));
}

/** One piece of a subject line: a subject the reader's surface names its own way, or the words between. */
export type SubjectLinePart<T> = { subject: T } | { text: string };

/**
 * A line of subjects as a card words it (#2485): "Neptune, Triton; Rhine,
 * Elbe, Oder and Vistula as women". The figures without a role come first,
 * listed with commas as the line always listed them. Each role's figures
 * follow, the last joined with "and" and the role after them. A semicolon
 * parts the groups, since a group holds commas of its own.
 */
export function subjectLineParts<T extends RoledSubject>(subjects: readonly T[]): SubjectLinePart<T>[] {
  return subjectGroups(subjects).flatMap((group, g) => {
    const last = group.subjects.length - 1;
    const names = group.subjects.flatMap((subject, i): SubjectLinePart<T>[] => {
      if (i === 0) return [{ subject }];
      return [{ text: group.role && i === last ? ' and ' : ', ' }, { subject }];
    });
    return [...(g > 0 ? [{ text: '; ' }] : []), ...names, ...(group.role ? [{ text: ` as ${group.role}` }] : [])];
  });
}

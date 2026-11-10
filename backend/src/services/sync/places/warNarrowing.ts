/**
 * A war narrowed to what a memorial is for (#2404, #2412).
 *
 * Wikidata's *commemorates* and English Wikipedia's *World War II memorials in
 * …* categories often name the whole war where the memorial is one event's:
 * the Soviet War Memorial in Treptower Park is said to commemorate World War
 * II, and its article's lead says it commemorates the soldiers who fell in the
 * Battle of Berlin. "World War II" is true and tells this memorial apart from
 * no other of that war. So each war a reading names (`narrowWars`) is replaced
 * by the first of these that names an event within its dates (`within`), an
 * occurrence in Wikidata's class tree and not just an item with dates, as the
 * peninsula of Westerplatte is:
 *
 * 1. The place's own significant event (`P793`): the Hiroshima Peace Memorial
 *    → the atomic bombing of Hiroshima.
 * 2. An event the lead's dedication sentences link, those that say what the
 *    place commemorates, remembers or honours, or who fell: Treptower → the
 *    Battle of Berlin, Mamayev Kurgan → the Battle of Stalingrad, Bucharest's
 *    Arcul de Triumf → Romania in World War I. A link to the war itself, to a
 *    unit, a place or a later war (India Gate's lead names the Third
 *    Anglo-Afghan War of 1919 beside World War I) narrows nothing.
 * 3. Where the categories read the war, an event they name beside it that the
 *    place's story tells, its lead linking it or its significant event naming
 *    it. An event during the war the story does not tell is no subject at all:
 *    the Anielewicz Bunker (Miła 18), the Warsaw Ghetto Uprising's
 *    headquarters, is filed among the 1944 Warsaw Uprising's memorials, and
 *    its lead never names that uprising. The event need only overlap the war
 *    for that: the Monument to the Heroes of Warsaw, raised to the city's
 *    fighters of 1939 to 1945, is filed among Warsaw's Holocaust memorials,
 *    and Wikidata dates the Holocaust from 1933 (#2416).
 * 4. Where the reading names nothing but wars, the one person a bust or statue
 *    shows: the one human `P180` names, or the one human of `P180` and the
 *    lead's links whose whole name the place's own name carries (the bust of
 *    Roman Shukhevych in Edmonton → Roman Shukhevych).
 *
 * The war stays where none does: the Cenotaph in Whitehall and the Menin Gate
 * are raised to a war's dead.
 *
 * The lead is read live, one article at a time (`rvsection=0` answers for one
 * page), and only for the places whose reading names a war. A lead that
 * cannot be read, or a place with no English article, narrows nothing by
 * steps 2 and 3 or by the lead's half of step 4, and drops no event: the
 * reading it would refine is already true, so the run goes on with the war
 * (`fetchLeads`). The place's significant event and a single human `P180`
 * names still narrow it.
 */

import type { CommemoratedSubject, Commemorates, CommemorationVia, WarNarrowing } from '@tyr/shared/commemorates';
import { WARS_NARROWED_BY_EVENT, WARS_NARROWED_BY_LEAD, WARS_NARROWED_TO_PERSON } from '@tyr/shared/commemorates';
import { askWikipediaOnce, enwikiTitleOf, LOG_PREFIX, pagesOf, type CategoryOptions } from '../wikipediaCategories.js';
import { WaitBudget } from '../wikidataUtils.js';
import { articleUrl } from '../subset/values.js';
import type { CommemorationPlace, CommemorationWiki, PlaceReading, SubjectClaims, SubjectKind } from './commemorates.js';
import { wholeNameInPlace } from './placeNames.js';

/** A time span as a sortable number per end: year, month and day, `±YYYYMMDD`. */
export interface Span {
  from: number;
  to: number;
}

/**
 * A sentence of a lead that says what a place commemorates or who it is for:
 * "commemorates", "dedicated to", "in memory of", "in honour of", "fell".
 */
const DEDICATION_SENTENCE = /commemorat|dedicated|memorial (?:to|for|of)|in memory|in honou?r|honou?rs|remember|\bfell\b|fallen|killed|\bdied\b|missing|lost their lives/i;

/** A wiki link, its target and label captured whole; the target is what comes before a pipe or a section mark. */
// eslint-disable-next-line sonarjs/slow-regex -- the negated class `[^\]]+` cannot match the `]` that closes it, so it cannot backtrack across a link; one lead's wikitext at a time
const LINK = /\[\[([^\]]+)\]\]/g;

/** Wikitext without its comments, cut at each opening mark to its close, or to the end where none closes it. */
function withoutComments(wikitext: string): string {
  let out = '';
  let at = 0;
  for (let start = wikitext.indexOf('<!--'); start >= 0; start = wikitext.indexOf('<!--', at)) {
    out += wikitext.slice(at, start);
    const end = wikitext.indexOf('-->', start + 4);
    at = end < 0 ? wikitext.length : end + 3;
  }
  return out + wikitext.slice(at);
}

/** Wikitext without what is not prose: comments, references, templates (nested ones too) and files. */
function proseOf(wikitext: string): string {
  let text = withoutComments(wikitext).replace(/<ref[^>/]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  // Innermost templates first, until none is left: an infobox holds templates of its own.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/\{\{[^{}]*\}\}/g, '');
  }
  return withoutFiles(text);
}

/** Wikitext without its file links, whose captions hold links of their own: cut by counting brackets. */
function withoutFiles(text: string): string {
  let out = '';
  let at = 0;
  for (let start = fileLinkAt(text, 0); start >= 0; start = fileLinkAt(text, at)) {
    out += text.slice(at, start);
    let depth = 0;
    let i = start;
    do {
      if (text.startsWith('[[', i)) { depth++; i += 2; } else if (text.startsWith(']]', i)) { depth--; i += 2; } else i++;
    } while (depth > 0 && i < text.length);
    at = i;
  }
  return out + text.slice(at);
}

/** Where the next file link starts, at or after `from`, or -1. */
function fileLinkAt(text: string, from: number): number {
  const match = /\[\[(?:File|Image):/i.exec(text.slice(from));
  return match ? from + match.index : -1;
}

/** The articles a stretch of prose links, in the order they appear: no namespaced link, first letter raised as a title is. */
function linksOf(prose: string): string[] {
  const titles: string[] = [];
  for (const [, link] of prose.matchAll(LINK)) {
    const title = link.split('|')[0].split('#')[0].trim().replace(/_/g, ' ');
    if (!title || /^[^:]+:/.test(title)) continue;
    titles.push(title.charAt(0).toUpperCase() + title.slice(1));
  }
  return titles;
}

/** The articles the dedication sentences of a lead link, in the order they appear, once each. */
export function dedicationLinks(wikitext: string): string[] {
  const sentences = proseOf(wikitext).split(/(?<=[.!?])\s+/).filter((sentence) => DEDICATION_SENTENCE.test(sentence));
  return [...new Set(sentences.flatMap(linksOf))];
}

/** Every article a lead's prose links, in the order they appear, once each: the events and people of the place's story. */
export function leadLinks(wikitext: string): string[] {
  return [...new Set(linksOf(proseOf(wikitext)))];
}

/** Whether `inner` lies wholly within `outer`. */
export function within(inner: Span, outer: Span): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

/** Whether two spans share a day. */
export function overlaps(a: Span, b: Span): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** What a place says beside its reading that may narrow a war it names, as items. */
export interface WarEvidence {
  /** The place's own significant events (`P793`). */
  events: readonly string[];
  /** The people it depicts (`P180`). */
  depicts: readonly string[];
  /** What its lead links where it says what the place is for; none where the lead was not read. */
  dedicated: readonly string[];
  /** Everything its lead links; null where the lead was not read, which tells no story and drops nothing. */
  linked: readonly string[] | null;
  /** The place's name, which names the one person a bust shows. */
  name?: string;
  /**
   * The lead's links English Wikipedia files as people (`BIOGRAPHY_CATEGORY`):
   * the local subset keeps no item a lead alone names, so whether Roman
   * Shukhevych is a human is asked of his article.
   */
  biographies?: readonly string[];
}

/** A category English Wikipedia files every biography under: a year or century of birth or death, or *Living people*. */
export const BIOGRAPHY_CATEGORY = /^(?:\d{1,4}s? (?:BC )?(?:births|deaths)|\d{1,2}(?:st|nd|rd|th)-century (?:BC )?(?:births|deaths)|Living people)$/;

/**
 * The reading with each war it names replaced by what the place is for within
 * that war, by the first narrowing of the module's list that names anything,
 * or the reading as it was where none does. `via` names the narrowing that
 * replaced the first war; a war dropped for an event the categories named
 * beside it keeps the reading's own `via`, since the categories named both.
 */
export function narrowWars(
  reading: Commemorates,
  evidence: WarEvidence,
  kinds: ReadonlyMap<string, SubjectKind>,
  articles: ReadonlyMap<string, string>,
): Commemorates {
  const spanOfWar = (item: string) => {
    const kind = kinds.get(item);
    return kind?.war ? kind.span : null;
  };
  const wars = reading.subjects.flatMap((subject) => {
    const span = spanOfWar(subject.item);
    return span ? [{ item: subject.item, span }] : [];
  });
  if (!wars.length) return reading;
  const inside = (item: string, war: { item: string; span: Span }) => {
    const kind = kinds.get(item);
    return item !== war.item && Boolean(kind?.occurrence && kind.span && within(kind.span, war.span));
  };
  const story = evidence.linked ? new Set([...evidence.linked, ...evidence.events]) : null;
  const fromCategories = reading.via === 'memorials-category';
  const during = (item: string, war: { item: string; span: Span }) => {
    const kind = kinds.get(item);
    return item !== war.item && Boolean(kind?.occurrence && kind.span && overlaps(kind.span, war.span));
  };
  // An event the categories name during one of their wars that the place's story never tells is no subject (Miła 18).
  const untold = (item: string) => fromCategories && story !== null && !story.has(item) && wars.some((war) => during(item, war));
  const onlyWars = reading.subjects.every((subject) => spanOfWar(subject.item));
  const subjectOf = (item: string): CommemoratedSubject => ({ item, label: kinds.get(item)?.label ?? item, articleUrl: articles.get(item) ?? null });

  const subjects: CommemoratedSubject[] = [];
  let via: CommemorationVia | null = null;
  let changed = false;
  for (const subject of reading.subjects) {
    const war = wars.find((w) => w.item === subject.item);
    if (!war) {
      if (untold(subject.item)) changed = true;
      else subjects.push(subject);
      continue;
    }
    const narrower = narrowerThan(war, inside, { evidence, story, onlyWars, fromCategories, reading, kinds });
    if (!narrower) {
      subjects.push(subject);
      continue;
    }
    changed = true;
    via ??= narrower.via;
    subjects.push(...narrower.items.map(subjectOf));
  }
  if (!changed) return reading;
  const once = subjects.filter((subject, i) => subjects.findIndex((other) => other.item === subject.item) === i);
  return { via: via ?? reading.via, subjects: once };
}

/** What `narrowerThan` reads beside the war. */
interface NarrowingContext {
  evidence: WarEvidence;
  story: ReadonlySet<string> | null;
  onlyWars: boolean;
  fromCategories: boolean;
  reading: Commemorates;
  kinds: ReadonlyMap<string, SubjectKind>;
}

/** The first narrowing of a war that names anything, with the `via` it is stored under; null where none does. */
function narrowerThan(
  war: { item: string; span: Span },
  inside: (item: string, war: { item: string; span: Span }) => boolean,
  { evidence, story, onlyWars, fromCategories, reading, kinds }: NarrowingContext,
): { items: string[]; via: WarNarrowing | null } | null {
  const own = evidence.events.filter((item) => inside(item, war));
  if (own.length) return { items: own, via: WARS_NARROWED_BY_EVENT };
  const dedicated = evidence.dedicated.filter((item) => inside(item, war));
  if (dedicated.length) return { items: dedicated, via: WARS_NARROWED_BY_LEAD };
  const told = fromCategories && story ? reading.subjects.map((s) => s.item).filter((item) => story.has(item) && inside(item, war)) : [];
  if (told.length) return { items: told, via: null };
  const person = onlyWars ? personShown(evidence, kinds) : null;
  return person ? { items: [person], via: WARS_NARROWED_TO_PERSON } : null;
}

/** The one person a bust or statue shows: the one human `P180` names, or the one of `P180` and the lead's links its name carries. */
function personShown(evidence: WarEvidence, kinds: ReadonlyMap<string, SubjectKind>): string | null {
  const human = (item: string) => Boolean(kinds.get(item)?.human) || Boolean(evidence.biographies?.includes(item));
  const depicted = [...new Set(evidence.depicts.filter((item) => kinds.get(item)?.human))];
  if (depicted.length === 1) return depicted[0];
  const people = [...new Set([...depicted, ...(evidence.linked ?? []).filter(human)])]
    .map((item) => ({ item, label: kinds.get(item)?.label ?? '', articleUrl: null }));
  const named = wholeNameInPlace(people, evidence.name);
  return named.length === 1 ? named[0].item : null;
}

/**
 * Each reading that names a war, narrowed in place (`narrowWars`): the leads
 * of those places are read, every item they link resolved, and what a linked
 * item is learnt through `kindsOf`, the run's reading of what a subject is.
 * A link the place's name carries is asked of English Wikipedia's categories
 * too, where the run does not know it as a human: it may be the person a bust
 * shows. `kinds` and `articles` learn the linked items.
 */
export async function narrowWarReadings(
  places: readonly CommemorationPlace[],
  readings: ReadonlyMap<string, PlaceReading>,
  claims: ReadonlyMap<string, SubjectClaims>,
  stores: { kinds: Map<string, SubjectKind>; articles: Map<string, string> },
  wiki: CommemorationWiki,
  kindsOf: (items: string[]) => Promise<Map<string, SubjectKind>>,
): Promise<void> {
  const { kinds, articles } = stores;
  const asked = places.filter((place) => readings.get(place.qid)?.commemorates?.subjects.some((subject) => kinds.get(subject.item)?.war));
  if (!asked.length) return;
  const titleOf = new Map(asked.flatMap((place) => {
    const title = enwikiTitleOf(place.articleUrl);
    return title ? [[place.qid, title] as const] : [];
  }));
  const leads = titleOf.size ? await wiki.leads([...new Set(titleOf.values())]) : new Map<string, string>();
  const linksOfPlace = new Map([...titleOf].flatMap(([qid, title]) => {
    const lead = leads.get(title);
    return lead ? [[qid, { dedicated: dedicationLinks(lead), linked: leadLinks(lead) }] as const] : [];
  }));
  const titles = [...new Set([...linksOfPlace.values()].flatMap(({ linked }) => linked))];
  const resolved = titles.length ? await wiki.articleItems(titles) : new Map<string, { item: string }>();
  const items = new Map([...resolved].map(([title, { item }]) => [title, item]));
  const unknown = [...new Set([...items.values(), ...asked.flatMap((place) => {
    const own = claims.get(place.qid);
    return own ? [...own.significantEvents, ...own.depicts] : [];
  })])].filter((item) => !kinds.has(item));
  for (const [item, kind] of await kindsOf(unknown)) kinds.set(item, kind);
  for (const [title, item] of items) if (!articles.has(item)) articles.set(item, articleUrl(title));
  const itemsOf = (list: readonly string[]) => list.map((title) => items.get(title)).filter((item): item is string => Boolean(item));
  const biographies = await biographiesNamed(asked, linksOfPlace, items, kinds, wiki);
  for (const place of asked) {
    const reading = readings.get(place.qid);
    if (!reading?.commemorates) continue;
    const links = linksOfPlace.get(place.qid);
    const own = claims.get(place.qid);
    reading.commemorates = narrowWars(reading.commemorates, {
      events: own?.significantEvents ?? [],
      depicts: own?.depicts ?? [],
      dedicated: links ? itemsOf(links.dedicated) : [],
      linked: links ? itemsOf(links.linked) : null,
      name: place.label,
      biographies,
    }, kinds, articles);
  }
}

/**
 * Of the lead links each place's name carries, the items whose English
 * article is a biography (`BIOGRAPHY_CATEGORY`) and that the run does not
 * already know as a human.
 */
async function biographiesNamed(
  places: readonly CommemorationPlace[],
  linksOfPlace: ReadonlyMap<string, { linked: string[] }>,
  items: ReadonlyMap<string, string>,
  kinds: ReadonlyMap<string, SubjectKind>,
  wiki: CommemorationWiki,
): Promise<string[]> {
  const titleOf = new Map<string, string>();
  for (const place of places) {
    const linked = (linksOfPlace.get(place.qid)?.linked ?? []).flatMap((title) => {
      const item = items.get(title);
      const kind = item ? kinds.get(item) : undefined;
      return item && kind && !kind.human ? [{ title, subject: { item, label: kind.label, articleUrl: null } }] : [];
    });
    const named = new Set(wholeNameInPlace(linked.map(({ subject }) => subject), place.label).map((subject) => subject.item));
    for (const { title, subject } of linked) if (named.has(subject.item)) titleOf.set(subject.item, title);
  }
  if (!titleOf.size) return [];
  const categories = await wiki.categories([...new Set(titleOf.values())]);
  return [...titleOf].filter(([, title]) => (categories.get(title) ?? []).some((category) => BIOGRAPHY_CATEGORY.test(category))).map(([item]) => item);
}

/** One page's lead as `prop=revisions` answers it under `formatversion=2`. */
interface RevisionPage {
  revisions?: { slots?: { main?: { content?: string } } }[];
}

/**
 * The wikitext of each article's lead (section 0), by the title asked; an
 * article the API has no page for has no entry. One ask per article, since a
 * section is answered for one page at a time. A lead that cannot be read, its
 * retries spent or the host refusing it, has no entry either and is logged:
 * its war stays as the reading named it. A cancelled run stops here.
 */
export async function fetchLeads(titles: readonly string[], options: CategoryOptions): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const budget = options.budget ?? new WaitBudget(0);
  for (const title of titles) {
    if (options.isCancelled?.()) break;
    try {
      const answer = await askWikipediaOnce({
        action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0',
        redirects: '1', format: 'json', formatversion: '2', titles: title,
      }, options, budget, `the lead of ${title}`);
      const content = (pagesOf(answer)[0] as unknown as RevisionPage | undefined)?.revisions?.[0]?.slots?.main?.content;
      if (content) out.set(title, content);
    } catch (error) {
      if (options.isCancelled?.()) throw error;
      console.warn(`${LOG_PREFIX} the lead of ${title} was not read, its war stays: ${error instanceof Error ? error.message : String(error)}`);
    }
    await options.pause?.();
  }
  return out;
}

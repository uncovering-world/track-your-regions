/**
 * Whom or what a place commemorates (#2144): the subjects the card of a place
 * Public art or Monuments & memorials offers names on its "Commemorates" line,
 * read in six steps, the first that names anyone answering. A later step is
 * not read for a place an earlier one answered. Towers, Bridges & engineering
 * marvels and Squares & streets read none of it (`WRITTEN_BY_SOURCES`): their
 * namesake is the engineer or the patron, and the Eiffel Tower does not
 * commemorate Gustave Eiffel.
 *
 * 1. `P547` *commemorates*, every item value: the Lincoln Memorial →
 *    Abraham Lincoln.
 * 2. English Wikipedia's *Monuments and memorials to X*, *Memorials to X* or
 *    *Monuments to X* category of the place's article, X a name resolved to
 *    the article titled X exactly and that article to its item: the Statue of
 *    Unity is filed under *Memorials to Vallabhbhai Patel*.
 * 3. `P921` *main subject*, a value that is a person or an event: the
 *    Hermannsdenkmal → Arminius.
 * 4. `P138` *named after*, the same: the Alexander Column → Alexander I of
 *    Russia, where the Brandenburg Gate's namesake is a town and names
 *    nobody.
 * 5. *Statues of X*, resolved as in step 2.
 * 6. `P180` *depicts*, a person only: Nelson's Column → Horatio Nelson, and
 *    not the lions or the battles on its plinth.
 *
 * Step 2 also reads English Wikipedia's *Monuments and memorials related to X*
 * or *concerning X*, *X monuments and memorials* and *X memorials in Y*, X a
 * person or an event there, since those titles also name classes (*Military
 * monuments and memorials*): the National Monument of Scotland → the
 * Napoleonic Wars, Mamayev Kurgan (*World War II memorials in Russia*) →
 * World War II, which its lead then narrows to the Battle of Stalingrad.
 *
 * What a work shows is not always whom it was raised for (#2404). A holy
 * figure — a deity in Wikidata's class tree, Jesus Christ among them, or a
 * person the churches canonised, the Buddha among them — that a step reading
 * what a work shows names (3, 5 and 6, `DEPICTION_STEPS`) is kept as what the
 * place depicts, never as its dedication: Christ the Redeemer depicts Jesus
 * Christ. The first of those steps to name one answers it, whether or not a
 * dedication was read. A step that names only holy figures leaves the
 * dedication to the steps after it.
 *
 * A group is no dedication. A work filed under several *Statues of*
 * categories shows many figures, and those categories name nothing of it, not
 * even what it depicts: the Holy Trinity Column in Olomouc, under *Statues of
 * Jesus* and *Statues of the Virgin Mary*, shows the Trinity, the Virgin and
 * dozens of saints. A work that depicts more than `MAX_DEDICATED_FIGURES`
 * people is a scene, and of them only those whose name the place's own name
 * carries are its dedication: the Luther Monument in Worms commemorates Martin
 * Luther and not the eight reformers and princes around him, and Istanbul's
 * Republic Monument, naming none of its five founders, names no dedication.
 *
 * Statements are read at their best rank, in the item's order; a category's
 * subjects by item id. A person is `P31` human (Q5); an event carries a point
 * in time (`P585`), a start (`P580`) or an end (`P582`). A value with no label
 * in any language names nobody a reader can read, and is not taken. A
 * subject's article is Wikidata's English sitelink, or, for one a category
 * named, the article its title resolved to.
 *
 * Wikidata is read through the run's door, from the local subset where the run
 * reads it (`subset/commemorates.ts`). English Wikipedia's categories are read
 * from the copy of its structure where one is built, and from the live API
 * otherwise (`commemorationWiki`), which follows a redirect where the copy holds
 * none (`wikipediaStructure.ts`).
 */

import {
  DEPICTION_STEPS, MAX_COMMEMORATED_SUBJECTS, type CommemoratedSubject, type Commemorates, type CommemorationStep, type Depicts,
  type DepictionStep,
} from '@tyr/shared/commemorates';
import { chunk, fetchEnglishArticles, values, type SparqlFn } from '../wikidataQueries.js';
import {
  delay, extractQid, isQid, LABEL_LANGS, SPARQL_DELAY_MS, SPARQL_WAIT_BUDGET_MS, WaitBudget, waitMessage, WIKIDATA_USER_AGENT,
  type SparqlBinding,
} from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { DEITY, OCCURRENCE, spanOf, subsetSubjectClaims, subsetSubjectKinds, WAR } from '../subset/commemorates.js';
import { articleUrl } from '../subset/values.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureArticleItems, structureCategories } from '../wikipediaStructure.js';
import { enwikiTitleOf, fetchWikipediaCategories, type CategoryOptions } from '../wikipediaCategories.js';
import { resolveWikipediaArticles } from '../wikipediaArticles.js';
import { fetchLeads, narrowWarReadings, type Span } from './warNarrowing.js';
import { namedInPlace } from './placeNames.js';
import type { SyncProgress } from '../types.js';

const BATCH = 50;

const NO_CLAIMS: SubjectClaims = { commemorates: [], mainSubjects: [], namedAfter: [], depicts: [], significantEvents: [] };

/** The items a place names, by property, at their best rank. */
export interface SubjectClaims {
  /** `P547` commemorates. */
  commemorates: string[];
  /** `P921` main subject. */
  mainSubjects: string[];
  /** `P138` named after. */
  namedAfter: string[];
  /** `P180` depicts. */
  depicts: string[];
  /** `P793` significant event, which may narrow a war the reading names (`warNarrowing.ts`). */
  significantEvents: string[];
}

/** What a value is: its label, whether it is a person or an event, and whether it is a holy figure. */
export interface SubjectKind {
  label: string;
  human: boolean;
  event: boolean;
  /** A deity (`P31` under Q178885) or a person canonised (`P411`): what a religious work shows. */
  holy: boolean;
  /** A war (`P31` under Q198), which the place's lead may narrow (`warNarrowing.ts`). */
  war: boolean;
  /** An occurrence (`P31` under Q1190554): what a war may be narrowed to, where an item with dates may be a peninsula. */
  occurrence: boolean;
  /** When it happened: its start (`P580`) or point in time (`P585`) to its end (`P582`), where Wikidata says. */
  span: Span | null;
}

/** The items English Wikipedia's categories of a place's article name, by step, in item order. */
export interface FiledSubjects {
  /** *Monuments and memorials to X*: anyone. */
  memorials: string[];
  /** *Monuments and memorials related to X*, *X monuments and memorials*: a person or an event. */
  concerning: string[];
  statues: string[];
  /** How many *Statues of* categories the article is filed under, resolved or not. */
  statueCategories: number;
}

/** The two values of one place: whom it commemorates, and the holy figures it depicts. */
export interface PlaceReading {
  commemorates: Commemorates | null;
  depicts: Depicts | null;
}

/**
 * The most people a work may depict for them all to be whom it was raised
 * for: Mount Rushmore's four presidents and Cape Town's four laureates on
 * Nobel Square are, the nine figures of the Luther Monument in Worms and the
 * five founders on Istanbul's Republic Monument are a scene, of whom only the
 * one the place is named for is its dedication (#2404).
 */
export const MAX_DEDICATED_FIGURES = 4;

/**
 * English Wikipedia as the reading reads it: each article's categories, the
 * item of each article titled exactly so, and the wikitext of an article's
 * lead, which narrows a war (`warNarrowing.ts`).
 */
export interface CommemorationWiki {
  categories(titles: string[]): Promise<Map<string, string[]>>;
  articleItems(titles: string[]): Promise<Map<string, string>>;
  leads(titles: string[]): Promise<Map<string, string>>;
}

/** The place the reading is asked about: its item, and its English Wikipedia article. */
export interface CommemorationPlace {
  qid: string;
  articleUrl: string | null;
  /** The place's name, which says whom of a group scene it is for (`MAX_DEDICATED_FIGURES`). */
  label?: string;
}

/**
 * A category that names whom a place is a memorial to, X captured. X is a
 * name: it starts with a capital letter, and a leading *the* is not X's.
 * English Wikipedia writes a class of people with a small letter inside a
 * category title (*Statues of military personnel*, *Statues of men in
 * Poland*), and a class is nobody a card can name.
 */
export const MEMORIALS_CATEGORY = /^(?:Monuments and memorials|Memorials|Monuments) to (?:the )?(\p{Lu}.*)$/u;

/**
 * Categories that name what a memorial concerns, X captured: *Monuments and
 * memorials related to the Napoleonic Wars*, *Warsaw Uprising monuments and
 * memorials*, *World War I memorials in New Zealand*. They name classes too
 * (*Military monuments and memorials*), so X counts only where it is a person
 * or an event.
 */
export const CONCERNING_CATEGORIES: readonly RegExp[] = [
  /^(?:Monuments and memorials|Memorials|Monuments) (?:related to|concerning) (?:the )?(\p{Lu}.*)$/u,
  /^(?:The )?(\p{Lu}.*?) monuments and memorials$/u,
  // Not *Monuments and memorials in Warsaw*, which says where and not what.
  /^(?:The )?(?!Monuments and memorials )(\p{Lu}.*?) (?:monuments and memorials|memorials) in \p{Lu}.*$/u,
];

/** A category that names whom a statue shows, X captured, as `MEMORIALS_CATEGORY`. */
export const STATUES_CATEGORY = /^Statues of (?:the )?(\p{Lu}.*)$/u;

/** The article titles the categories name under `pattern`, in the categories' order, once each. */
export function categoryTitles(categories: readonly string[], pattern: RegExp): string[] {
  return [...new Set(categories.map((category) => pattern.exec(category)?.[1]?.trim()).filter((x): x is string => Boolean(x)))];
}

/** Item ids by their number, the order a category's subjects are read in. */
const byItem = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));

type Accepts = (kind: SubjectKind) => boolean;
const anyone: Accepts = () => true;
const humanOrEvent: Accepts = (kind) => kind.human || kind.event;
const human: Accepts = (kind) => kind.human;
const humanEventOrHoly: Accepts = (kind) => kind.human || kind.event || kind.holy;

const SHOWS: ReadonlySet<CommemorationStep> = new Set<CommemorationStep>(DEPICTION_STEPS);

/** What a step found: the dedication it names, and the holy figures it shows. */
interface Found {
  dedicated: CommemoratedSubject[];
  holy: CommemoratedSubject[];
}

/** One step: what it reads, which values it takes, and what it keeps of what it found where that is a group. */
type Step = [CommemorationStep, ReadonlyArray<readonly [readonly string[], Accepts]>, (found: Found) => Found];

const asFound = (found: Found) => found;

/** The values a step accepts, once each in its order: its holy figures apart where the step reads what a work shows. */
function subjectsOfStep(
  lists: Step[1], shows: boolean, kinds: ReadonlyMap<string, SubjectKind>, articles: ReadonlyMap<string, string>,
): Found {
  const dedicated: CommemoratedSubject[] = [];
  const holy: CommemoratedSubject[] = [];
  const seen = new Set<string>();
  for (const [items, accepts] of lists) {
    for (const item of items) {
      const kind = kinds.get(item);
      if (seen.has(item) || !kind || !accepts(kind)) continue;
      seen.add(item);
      (shows && kind.holy ? holy : dedicated).push({ item, label: kind.label, articleUrl: articles.get(item) ?? null });
    }
  }
  return { dedicated, holy };
}

/**
 * The two values of one place: the accepted values of the first step that
 * names a dedication, and the holy figures of the first step reading what the
 * work shows that names one, each with its labels and articles, at most
 * `MAX_COMMEMORATED_SUBJECTS` of them, or null where no step does.
 */
export function readingOfPlace(
  claims: SubjectClaims,
  filed: FiledSubjects,
  kinds: ReadonlyMap<string, SubjectKind>,
  articles: ReadonlyMap<string, string>,
  placeName?: string,
): PlaceReading {
  const steps: readonly Step[] = [
    ['commemorates', [[claims.commemorates, anyone]], asFound],
    ['memorials-category', [[filed.memorials, anyone], [filed.concerning, humanOrEvent]], asFound],
    ['main-subject', [[claims.mainSubjects, humanEventOrHoly]], asFound],
    ['named-after', [[claims.namedAfter, humanOrEvent]], asFound],
    ['statues-category', [[filed.statues, anyone]], (found) => (filed.statueCategories > 1 ? { dedicated: [], holy: [] } : found)],
    ['depicts', [[claims.depicts, human]], ({ dedicated, holy }) => ({
      dedicated: dedicated.length > MAX_DEDICATED_FIGURES ? namedInPlace(dedicated, placeName) : dedicated, holy,
    })],
  ];
  const reading: PlaceReading = { commemorates: null, depicts: null };
  for (const [via, lists, ofGroup] of steps) {
    const { dedicated, holy } = ofGroup(subjectsOfStep(lists, SHOWS.has(via), kinds, articles));
    if (!reading.commemorates && dedicated.length) {
      reading.commemorates = { via, subjects: dedicated.slice(0, MAX_COMMEMORATED_SUBJECTS) };
    }
    if (!reading.depicts && holy.length) reading.depicts = { via: via as DepictionStep, subjects: holy };
  }
  // A figure the dedication already names is not said twice: the Statue of St.
  // Wenceslas commemorates him, and depicting him adds nothing.
  const dedicatedTo = new Set(reading.commemorates?.subjects.map((subject) => subject.item));
  const shown = reading.depicts?.subjects.filter((subject) => !dedicatedTo.has(subject.item)) ?? [];
  return {
    commemorates: reading.commemorates,
    depicts: reading.depicts && shown.length ? { via: reading.depicts.via, subjects: shown.slice(0, MAX_COMMEMORATED_SUBJECTS) } : null,
  };
}

/** Which binding of the live answer each list of a place's claims is read from. */
const CLAIM_COLUMNS: ReadonlyArray<[string, keyof SubjectClaims]> = [
  ['commemorates', 'commemorates'], ['subject', 'mainSubjects'], ['namesake', 'namedAfter'], ['depicts', 'depicts'],
  ['happened', 'significantEvents'],
];

/** What one row of the live answer adds to its place's claims: one statement. */
function addClaim(claims: SubjectClaims, row: SparqlBinding): void {
  for (const [column, list] of CLAIM_COLUMNS) {
    const value = extractQid(row[column]?.value ?? '');
    if (isQid(value)) claims[list].push(value);
  }
}

/** The claims of each place, as `subsetSubjectClaims` answers; a place that names none has no entry. */
export async function fetchSubjectClaims(sparql: SparqlFn, qids: string[]): Promise<Map<string, SubjectClaims>> {
  if (readsSubset(sparql)) return subsetSubjectClaims(qids);
  const out = new Map<string, SubjectClaims>();
  for (const batch of chunk(qids, BATCH)) {
    const rows = await sparql(`
      SELECT ?e ?commemorates ?subject ?namesake ?depicts ?happened WHERE {
        VALUES ?e { ${values(batch)} }
        { ?e wdt:P547 ?commemorates } UNION { ?e wdt:P921 ?subject } UNION { ?e wdt:P138 ?namesake } UNION { ?e wdt:P180 ?depicts }
        UNION { ?e wdt:P793 ?happened }
      }`, { kind: 'edges', label: `whom or what ${batch.length} places commemorate` });
    for (const row of rows) {
      const qid = extractQid(row.e?.value ?? '');
      if (!isQid(qid)) continue;
      const claims = out.get(qid) ?? { commemorates: [], mainSubjects: [], namedAfter: [], depicts: [], significantEvents: [] };
      addClaim(claims, row);
      out.set(qid, claims);
    }
  }
  // The live answer has no statement order: by item, as a category's subjects are.
  for (const claims of out.values()) for (const [, list] of CLAIM_COLUMNS) claims[list].sort(byItem);
  return out;
}

/** Each value's label and what it is, as `subsetSubjectKinds` answers; a value with no label has no entry. */
export async function fetchSubjectKinds(sparql: SparqlFn, qids: string[]): Promise<Map<string, SubjectKind>> {
  if (readsSubset(sparql)) return subsetSubjectKinds(qids);
  const out = new Map<string, SubjectKind>();
  for (const batch of chunk(qids, BATCH)) {
    const rows = await sparql(`
      SELECT ?v ?vLabel ?human ?event ?holy ?war ?occurrence ?start ?end ?at WHERE {
        VALUES ?v { ${values(batch)} }
        OPTIONAL { ?v wdt:P31 wd:Q5 . BIND(true AS ?human) }
        OPTIONAL { ?v wdt:P585|wdt:P580|wdt:P582 ?when . BIND(true AS ?event) }
        OPTIONAL {
          { ?v p:P31 ?cls . ?cls ps:P31/wdt:P279* wd:${DEITY} . FILTER NOT EXISTS { ?cls wikibase:rank wikibase:DeprecatedRank } }
          UNION { ?v wdt:P411 ?canonised }
          BIND(true AS ?holy)
        }
        OPTIONAL { ?v wdt:P31/wdt:P279* wd:${WAR} . BIND(true AS ?war) }
        OPTIONAL { ?v wdt:P31/wdt:P279* wd:${OCCURRENCE} . BIND(true AS ?occurrence) }
        OPTIONAL { ?v wdt:P580 ?start }
        OPTIONAL { ?v wdt:P582 ?end }
        OPTIONAL { ?v wdt:P585 ?at }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
      }`, { kind: 'entities', label: `what ${batch.length} commemorated subjects are` });
    for (const row of rows) {
      const qid = extractQid(row.v?.value ?? '');
      const label = row.vLabel?.value;
      // The label service answers an item it has no name for with its id, which names nobody.
      if (!isQid(qid) || !label || isQid(label)) continue;
      const known = out.get(qid);
      const times = { start: row.start?.value, end: row.end?.value, at: row.at?.value };
      out.set(qid, {
        label,
        human: Boolean(row.human) || Boolean(known?.human),
        event: Boolean(row.event) || Boolean(known?.event),
        holy: Boolean(row.holy) || Boolean(known?.holy),
        war: Boolean(row.war) || Boolean(known?.war),
        occurrence: Boolean(row.occurrence) || Boolean(known?.occurrence),
        span: known?.span ?? spanOf(times.start ?? times.at, times.end ?? times.at),
      });
    }
  }
  return out;
}

/**
 * The items each place's article is filed as a memorial to, as concerning and
 * as a statue of, how many statues categories it is in, and the article each
 * of those items was resolved from.
 */
async function readFiled(places: readonly CommemorationPlace[], wiki: CommemorationWiki): Promise<{
  filed: Map<string, FiledSubjects>; articles: Map<string, string>;
}> {
  const titleOfPlace = new Map(places.flatMap((place) => {
    const title = enwikiTitleOf(place.articleUrl);
    return title ? [[place.qid, title] as const] : [];
  }));
  const categories = await wiki.categories([...new Set(titleOfPlace.values())]);
  const named = new Map([...titleOfPlace].map(([qid, title]) => {
    const filed = categories.get(title) ?? [];
    return [qid, {
      memorials: categoryTitles(filed, MEMORIALS_CATEGORY),
      concerning: [...new Set(CONCERNING_CATEGORIES.flatMap((pattern) => categoryTitles(filed, pattern)))],
      statues: categoryTitles(filed, STATUES_CATEGORY),
    }] as const;
  }));
  const asked = [...new Set([...named.values()].flatMap(({ memorials, concerning, statues }) => [...memorials, ...concerning, ...statues]))];
  const items = asked.length ? await wiki.articleItems(asked) : new Map<string, string>();
  const itemsOf = (titles: readonly string[]) => [...new Set(titles.map((title) => items.get(title)).filter((q): q is string => Boolean(q)))].sort(byItem);
  return {
    filed: new Map([...named].map(([qid, { memorials, concerning, statues }]) => [qid, {
      memorials: itemsOf(memorials), concerning: itemsOf(concerning), statues: itemsOf(statues), statueCategories: statues.length,
    }])),
    articles: new Map([...items].map(([title, item]) => [item, articleUrl(title)])),
  };
}

const NONE: FiledSubjects = { memorials: [], concerning: [], statues: [], statueCategories: 0 };

/**
 * The reading of every place asked about, by its item; a place no step
 * answers has no entry. `sparql` is the run's door to Wikidata, `wiki` its
 * door to English Wikipedia's categories (`commemorationWiki`).
 */
export async function readCommemorates(
  places: readonly CommemorationPlace[], sparql: SparqlFn, wiki: CommemorationWiki,
): Promise<Map<string, PlaceReading>> {
  if (!places.length) return new Map();
  const claims = await fetchSubjectClaims(sparql, [...new Set(places.map((place) => place.qid))]);
  const { filed, articles: resolved } = await readFiled(places, wiki);
  const values = [...new Set([
    ...[...claims.values()].flatMap((c) => [...c.commemorates, ...c.mainSubjects, ...c.namedAfter, ...c.depicts]),
    ...[...filed.values()].flatMap((f) => [...f.memorials, ...f.concerning, ...f.statues]),
  ])];
  const [kinds, sitelinks] = await Promise.all([fetchSubjectKinds(sparql, values), fetchEnglishArticles(sparql, values)]);
  // Wikidata's sitelink first; the article a category's title resolved to where the item carries none.
  const articles = new Map([...resolved, ...sitelinks]);
  const known = new Map(kinds);
  const out = new Map<string, PlaceReading>();
  for (const { qid, label } of places) {
    const reading = readingOfPlace(claims.get(qid) ?? NO_CLAIMS, filed.get(qid) ?? NONE, known, articles, label);
    if (reading.commemorates || reading.depicts) out.set(qid, reading);
  }
  await narrowWarReadings(places, out, claims, { kinds: known, articles }, wiki, (items) => fetchSubjectKinds(sparql, items));
  return out;
}

/**
 * English Wikipedia's categories read from the copy of its structure
 * (ADR-0121), and the leads, which the copy does not hold, asked live.
 */
export function structureWiki(options: CategoryOptions): CommemorationWiki {
  return {
    categories: structureCategories,
    articleItems: async (titles) => new Map((await structureArticleItems(titles)).map((a) => [a.title, a.item])),
    leads: (titles) => fetchLeads(titles, options),
  };
}

/** English Wikipedia asked of the live API. */
function liveWiki(options: CategoryOptions): CommemorationWiki {
  return {
    categories: (titles) => fetchWikipediaCategories(titles, options),
    articleItems: async (titles) => {
      const resolved = await resolveWikipediaArticles(titles.map((title) => `en:${title}`), options);
      return new Map([...resolved].map(([tag, item]) => [tag.slice('en:'.length), item]));
    },
    leads: (titles) => fetchLeads(titles, options),
  };
}

/**
 * The run's door to English Wikipedia: the copy of its structure where one is
 * built, the live API otherwise, on the run's patience and with its cancel heard.
 */
export async function commemorationWiki(progress: SyncProgress): Promise<CommemorationWiki> {
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const options: CategoryOptions = {
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    budget,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikipedia', wait, budget); },
  };
  return (await latestStructure()) ? structureWiki(options) : liveWiki(options);
}

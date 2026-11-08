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

import type { CommemoratedSubject, Commemorates, CommemorationStep } from '@tyr/shared/commemorates';
import { chunk, fetchEnglishArticles, values, type SparqlFn } from '../wikidataQueries.js';
import {
  delay, extractQid, isQid, LABEL_LANGS, SPARQL_DELAY_MS, SPARQL_WAIT_BUDGET_MS, WaitBudget, waitMessage, WIKIDATA_USER_AGENT,
  type SparqlBinding,
} from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { subsetSubjectClaims, subsetSubjectKinds } from '../subset/commemorates.js';
import { articleUrl } from '../subset/values.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureArticleItems, structureCategories } from '../wikipediaStructure.js';
import { enwikiTitleOf, fetchWikipediaCategories, type CategoryOptions } from '../wikipediaCategories.js';
import { resolveWikipediaArticles } from '../wikipediaArticles.js';
import type { SyncProgress } from '../types.js';

const BATCH = 50;

const NO_CLAIMS: SubjectClaims = { commemorates: [], mainSubjects: [], namedAfter: [], depicts: [] };

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
}

/** What a value is: its label, and whether it is a person or an event. */
export interface SubjectKind {
  label: string;
  human: boolean;
  event: boolean;
}

/** The items English Wikipedia's categories of a place's article name, by step, in item order. */
export interface FiledSubjects {
  memorials: string[];
  statues: string[];
}

/** English Wikipedia as the category steps read it: each article's categories, and the item of each article titled exactly so. */
export interface CommemorationWiki {
  categories(titles: string[]): Promise<Map<string, string[]>>;
  articleItems(titles: string[]): Promise<Map<string, string>>;
}

/** The place the reading is asked about: its item, and its English Wikipedia article. */
export interface CommemorationPlace {
  qid: string;
  articleUrl: string | null;
}

/**
 * A category that names whom a place is a memorial to, X captured. X is a
 * name: it starts with a capital letter, and a leading *the* is not X's.
 * English Wikipedia writes a class of people with a small letter inside a
 * category title (*Statues of military personnel*, *Statues of men in
 * Poland*), and a class is nobody a card can name.
 */
export const MEMORIALS_CATEGORY = /^(?:Monuments and memorials|Memorials|Monuments) to (?:the )?(\p{Lu}.*)$/u;

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

/**
 * The subjects of one place: the accepted values of the first step that
 * accepts any, with their labels and articles, or null where no step does.
 */
export function subjectsOfPlace(
  claims: SubjectClaims,
  filed: FiledSubjects,
  kinds: ReadonlyMap<string, SubjectKind>,
  articles: ReadonlyMap<string, string>,
): Commemorates | null {
  const steps: ReadonlyArray<[CommemorationStep, readonly string[], Accepts]> = [
    ['commemorates', claims.commemorates, anyone],
    ['memorials-category', filed.memorials, anyone],
    ['main-subject', claims.mainSubjects, humanOrEvent],
    ['named-after', claims.namedAfter, humanOrEvent],
    ['statues-category', filed.statues, anyone],
    ['depicts', claims.depicts, human],
  ];
  for (const [via, items, accepts] of steps) {
    const subjects: CommemoratedSubject[] = [];
    for (const item of new Set(items)) {
      const kind = kinds.get(item);
      if (kind && accepts(kind)) subjects.push({ item, label: kind.label, articleUrl: articles.get(item) ?? null });
    }
    if (subjects.length) return { via, subjects };
  }
  return null;
}

/** Which binding of the live answer each list of a place's claims is read from. */
const CLAIM_COLUMNS: ReadonlyArray<[string, keyof SubjectClaims]> = [
  ['commemorates', 'commemorates'], ['subject', 'mainSubjects'], ['namesake', 'namedAfter'], ['depicts', 'depicts'],
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
      SELECT ?e ?commemorates ?subject ?namesake ?depicts WHERE {
        VALUES ?e { ${values(batch)} }
        { ?e wdt:P547 ?commemorates } UNION { ?e wdt:P921 ?subject } UNION { ?e wdt:P138 ?namesake } UNION { ?e wdt:P180 ?depicts }
      }`, { kind: 'edges', label: `whom or what ${batch.length} places commemorate` });
    for (const row of rows) {
      const qid = extractQid(row.e?.value ?? '');
      if (!isQid(qid)) continue;
      const claims = out.get(qid) ?? { commemorates: [], mainSubjects: [], namedAfter: [], depicts: [] };
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
      SELECT ?v ?vLabel ?human ?event WHERE {
        VALUES ?v { ${values(batch)} }
        OPTIONAL { ?v wdt:P31 wd:Q5 . BIND(true AS ?human) }
        OPTIONAL { ?v wdt:P585|wdt:P580|wdt:P582 ?when . BIND(true AS ?event) }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
      }`, { kind: 'entities', label: `what ${batch.length} commemorated subjects are` });
    for (const row of rows) {
      const qid = extractQid(row.v?.value ?? '');
      const label = row.vLabel?.value;
      // The label service answers an item it has no name for with its id, which names nobody.
      if (!isQid(qid) || !label || isQid(label)) continue;
      const known = out.get(qid);
      out.set(qid, { label, human: Boolean(row.human) || Boolean(known?.human), event: Boolean(row.event) || Boolean(known?.event) });
    }
  }
  return out;
}

/**
 * The items each place's article is filed as a memorial to and as a statue of,
 * and the article each of those items was resolved from.
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
    return [qid, { memorials: categoryTitles(filed, MEMORIALS_CATEGORY), statues: categoryTitles(filed, STATUES_CATEGORY) }] as const;
  }));
  const asked = [...new Set([...named.values()].flatMap(({ memorials, statues }) => [...memorials, ...statues]))];
  const items = asked.length ? await wiki.articleItems(asked) : new Map<string, string>();
  const itemsOf = (titles: string[]) => [...new Set(titles.map((title) => items.get(title)).filter((q): q is string => Boolean(q)))].sort(byItem);
  return {
    filed: new Map([...named].map(([qid, { memorials, statues }]) => [qid, { memorials: itemsOf(memorials), statues: itemsOf(statues) }])),
    articles: new Map([...items].map(([title, item]) => [item, articleUrl(title)])),
  };
}

const NONE: FiledSubjects = { memorials: [], statues: [] };

/**
 * The subjects of every place asked about, by its item; a place no step
 * answers has no entry. `sparql` is the run's door to Wikidata, `wiki` its
 * door to English Wikipedia's categories (`commemorationWiki`).
 */
export async function readCommemorates(
  places: readonly CommemorationPlace[], sparql: SparqlFn, wiki: CommemorationWiki,
): Promise<Map<string, Commemorates>> {
  if (!places.length) return new Map();
  const claims = await fetchSubjectClaims(sparql, [...new Set(places.map((place) => place.qid))]);
  const { filed, articles: resolved } = await readFiled(places, wiki);
  const values = [...new Set([...claims.values(), ...filed.values()].flatMap((lists) => Object.values(lists) as string[][]).flat())];
  const [kinds, sitelinks] = await Promise.all([fetchSubjectKinds(sparql, values), fetchEnglishArticles(sparql, values)]);
  // Wikidata's sitelink first; the article a category's title resolved to where the item carries none.
  const articles = new Map([...resolved, ...sitelinks]);
  const out = new Map<string, Commemorates>();
  for (const { qid } of places) {
    const subjects = subjectsOfPlace(claims.get(qid) ?? NO_CLAIMS, filed.get(qid) ?? NONE, kinds, articles);
    if (subjects) out.set(qid, subjects);
  }
  return out;
}

/** English Wikipedia's categories read from the copy of its structure (ADR-0121). */
export function structureWiki(): CommemorationWiki {
  return {
    categories: structureCategories,
    articleItems: async (titles) => new Map((await structureArticleItems(titles)).map((a) => [a.title, a.item])),
  };
}

/** English Wikipedia's categories asked of the live API, on the run's patience and with its cancel heard. */
function liveWiki(progress: SyncProgress): CommemorationWiki {
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const options: CategoryOptions = {
    userAgent: WIKIDATA_USER_AGENT,
    isCancelled: () => progress.cancel,
    pause: () => delay(SPARQL_DELAY_MS),
    budget,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikipedia', wait, budget); },
  };
  return {
    categories: (titles) => fetchWikipediaCategories(titles, options),
    articleItems: async (titles) => {
      const resolved = await resolveWikipediaArticles(titles.map((title) => `en:${title}`), options);
      return new Map([...resolved].map(([tag, item]) => [tag.slice('en:'.length), item]));
    },
  };
}

/** The run's door to English Wikipedia's categories: the copy where one is built, the live API otherwise. */
export async function commemorationWiki(progress: SyncProgress): Promise<CommemorationWiki> {
  return (await latestStructure()) ? structureWiki() : liveWiki(progress);
}

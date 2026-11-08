/**
 * Whom or what a place commemorates (#2144): the six steps, the first that
 * names anyone answering, on the places the reading was measured on. Every id
 * is the development subset's (2026-11-08): the Lincoln Memorial (Q213559)
 * commemorates Abraham Lincoln (Q91); the Statue of Unity (Q7604504) is filed
 * under *Memorials to Vallabhbhai Patel* (Q9455); the Hermannsdenkmal
 * (Q664245) is about Arminius (Q68880); the Alexander Column (Q907366) is named
 * after Alexander I of Russia (Q15193); Nelson's Column (Q842089) depicts
 * Horatio Nelson (Q83235), a lion (Q140), battle (Q178561) and the battles of
 * the Nile (Q243979), Cape St. Vincent (Q373401) and Trafalgar (Q171416); the
 * Brandenburg Gate (Q82425) is named after Brandenburg an der Havel (Q3931).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../subset/commemorates.js', () => ({ subsetSubjectClaims: vi.fn(), subsetSubjectKinds: vi.fn() }));
vi.mock('../subset/kit.js', async (actual) => ({ ...(await actual<object>()), subsetEnglishArticles: vi.fn() }));

import { subsetSubjectClaims, subsetSubjectKinds } from '../subset/commemorates.js';
import { subsetEnglishArticles } from '../subset/kit.js';
import { subsetOnlyDoor } from '../subset/reader.js';
import type { SparqlFn } from '../wikidataQueries.js';
import {
  categoryTitles, fetchSubjectClaims, fetchSubjectKinds, MEMORIALS_CATEGORY, readCommemorates, STATUES_CATEGORY, subjectsOfPlace,
  type CommemorationWiki, type SubjectClaims, type SubjectKind,
} from './commemorates.js';

const LINCOLN_MEMORIAL = 'Q213559';
const LINCOLN = 'Q91';
const STATUE_OF_UNITY = 'Q7604504';
const PATEL = 'Q9455';
const HERMANNSDENKMAL = 'Q664245';
const ARMINIUS = 'Q68880';
const ALEXANDER_COLUMN = 'Q907366';
const ALEXANDER_I = 'Q15193';
const NELSONS_COLUMN = 'Q842089';
const NELSON = 'Q83235';
const LION = 'Q140';
const BATTLE = 'Q178561';
const NILE = 'Q243979';
const CAPE_ST_VINCENT = 'Q373401';
const TRAFALGAR = 'Q171416';
const BRANDENBURG_GATE = 'Q82425';
const BRANDENBURG_AN_DER_HAVEL = 'Q3931';

const article = (title: string) => `https://en.wikipedia.org/wiki/${title}`;
const claims = (over: Partial<SubjectClaims> = {}): SubjectClaims => ({ commemorates: [], mainSubjects: [], namedAfter: [], depicts: [], ...over });
const person = (label: string): SubjectKind => ({ label, human: true, event: false });
const event = (label: string): SubjectKind => ({ label, human: false, event: true });
const thing = (label: string): SubjectKind => ({ label, human: false, event: false });

const KINDS = new Map<string, SubjectKind>([
  [LINCOLN, person('Abraham Lincoln')],
  [PATEL, person('Sardar Vallabhbhai Patel')],
  [ARMINIUS, person('Arminius')],
  [ALEXANDER_I, person('Alexander I of Russia')],
  [NELSON, person('Horatio Nelson')],
  [LION, thing('lion')],
  [BATTLE, thing('battle')],
  [NILE, event('Battle of the Nile')],
  [CAPE_ST_VINCENT, event('Battle of Cape St. Vincent')],
  [TRAFALGAR, event('Battle of Trafalgar')],
  [BRANDENBURG_AN_DER_HAVEL, thing('Brandenburg an der Havel')],
]);
const ARTICLES = new Map([[LINCOLN, article('Abraham_Lincoln')], [NELSON, article('Horatio_Nelson,_1st_Viscount_Nelson')]]);
const NOTHING_FILED = { memorials: [], statues: [] };

describe('the steps of the reading', () => {
  it('takes every item Wikidata says the place commemorates first, whatever else it names', () => {
    expect(subjectsOfPlace(claims({ commemorates: [LINCOLN], namedAfter: [LINCOLN], depicts: [LINCOLN] }), NOTHING_FILED, KINDS, ARTICLES))
      .toEqual({ via: 'commemorates', subjects: [{ item: LINCOLN, label: 'Abraham Lincoln', articleUrl: article('Abraham_Lincoln') }] });
  });

  it('takes a memorials category before the main subject, with no article where the item has none', () => {
    expect(subjectsOfPlace(claims({ mainSubjects: [PATEL], depicts: [PATEL] }), { memorials: [PATEL], statues: [] }, KINDS, ARTICLES))
      .toEqual({ via: 'memorials-category', subjects: [{ item: PATEL, label: 'Sardar Vallabhbhai Patel', articleUrl: null }] });
  });

  it('takes a main subject that is a person or an event', () => {
    expect(subjectsOfPlace(claims({ mainSubjects: [ARMINIUS] }), NOTHING_FILED, KINDS, ARTICLES)?.via).toBe('main-subject');
    expect(subjectsOfPlace(claims({ mainSubjects: [TRAFALGAR] }), NOTHING_FILED, KINDS, ARTICLES)?.subjects.map((s) => s.item)).toEqual([TRAFALGAR]);
  });

  it('takes a namesake that is a person, and names nobody for a gate named after a town', () => {
    expect(subjectsOfPlace(claims({ namedAfter: [ALEXANDER_I] }), NOTHING_FILED, KINDS, ARTICLES))
      .toEqual({ via: 'named-after', subjects: [{ item: ALEXANDER_I, label: 'Alexander I of Russia', articleUrl: null }] });
    expect(subjectsOfPlace(claims({ namedAfter: [BRANDENBURG_AN_DER_HAVEL] }), NOTHING_FILED, KINDS, ARTICLES)).toBeNull();
  });

  it('takes a statues category before what is depicted', () => {
    expect(subjectsOfPlace(claims({ depicts: [NELSON] }), { memorials: [], statues: [LINCOLN] }, KINDS, ARTICLES)?.via).toBe('statues-category');
  });

  it('takes only the people a column depicts, not its lions or the battles on its plinth', () => {
    const nelsons = claims({ depicts: [NELSON, LION, BATTLE, NILE, CAPE_ST_VINCENT, TRAFALGAR] });
    expect(subjectsOfPlace(nelsons, NOTHING_FILED, KINDS, ARTICLES)).toEqual({
      via: 'depicts', subjects: [{ item: NELSON, label: 'Horatio Nelson', articleUrl: article('Horatio_Nelson,_1st_Viscount_Nelson') }],
    });
  });

  it('keeps the statement order, names an item once, and takes no value without a label', () => {
    expect(subjectsOfPlace(claims({ commemorates: [TRAFALGAR, NILE, TRAFALGAR, 'Q999999999'] }), NOTHING_FILED, KINDS, ARTICLES)?.subjects
      .map((s) => s.item)).toEqual([TRAFALGAR, NILE]);
  });
});

describe('the categories that name a subject', () => {
  it('reads X off the memorials and statues categories, a leading the dropped', () => {
    const filed = ['Memorials to Vallabhbhai Patel', 'Monuments and memorials to Horatio Nelson', 'Monuments to the Holocaust',
      'Monuments and memorials in London', 'Statues of Miguel de Cervantes'];
    expect(categoryTitles(filed, MEMORIALS_CATEGORY)).toEqual(['Vallabhbhai Patel', 'Horatio Nelson', 'Holocaust']);
    expect(categoryTitles(filed, STATUES_CATEGORY)).toEqual(['Miguel de Cervantes']);
  });

  it('reads no class of people English Wikipedia writes with a small letter', () => {
    // The Bronze Soldier of Tallinn and the Little Insurrectionist are filed so.
    expect(categoryTitles(['Statues of military personnel', 'Statues of men in Poland'], STATUES_CATEGORY)).toEqual([]);
  });
});

describe('reading the places of a run', () => {
  const wiki = (categories: Record<string, string[]>, items: Record<string, string>): CommemorationWiki => ({
    categories: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, categories[t] ?? []]))),
    articleItems: vi.fn(async (titles: string[]) => new Map(titles.flatMap((t) => (items[t] ? [[t, items[t]] as const] : [])))),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subsetSubjectClaims).mockResolvedValue(new Map([
      [LINCOLN_MEMORIAL, claims({ commemorates: [LINCOLN], namedAfter: [LINCOLN], depicts: [LINCOLN] })],
      [STATUE_OF_UNITY, claims({ mainSubjects: [PATEL], depicts: [PATEL] })],
      [HERMANNSDENKMAL, claims({ mainSubjects: [ARMINIUS] })],
      [ALEXANDER_COLUMN, claims({ namedAfter: [ALEXANDER_I] })],
      [NELSONS_COLUMN, claims({ depicts: [NELSON, LION, BATTLE, NILE, CAPE_ST_VINCENT, TRAFALGAR] })],
      [BRANDENBURG_GATE, claims({ namedAfter: [BRANDENBURG_AN_DER_HAVEL] })],
    ]));
    vi.mocked(subsetSubjectKinds).mockImplementation(async (ids) => new Map(ids.flatMap((id) => (KINDS.has(id) ? [[id, KINDS.get(id)!] as const] : []))));
    vi.mocked(subsetEnglishArticles).mockImplementation(async (ids) => new Map(ids.flatMap((id) => (ARTICLES.has(id) ? [[id, ARTICLES.get(id)!] as const] : []))));
  });

  it('answers each place by its first step, and nothing for the Brandenburg Gate', async () => {
    const places = [
      { qid: LINCOLN_MEMORIAL, articleUrl: article('Lincoln_Memorial') },
      { qid: STATUE_OF_UNITY, articleUrl: article('Statue_of_Unity') },
      { qid: HERMANNSDENKMAL, articleUrl: article('Hermannsdenkmal') },
      { qid: ALEXANDER_COLUMN, articleUrl: article('Alexander_Column') },
      { qid: NELSONS_COLUMN, articleUrl: article('Nelson%27s_Column') },
      { qid: BRANDENBURG_GATE, articleUrl: article('Brandenburg_Gate') },
    ];
    // "Horatio Nelson" is a redirect, which the copy holds no page for: the category names nobody.
    const read = wiki(
      { 'Statue of Unity': ['Memorials to Vallabhbhai Patel'], "Nelson's Column": ['Monuments and memorials to Horatio Nelson'] },
      { 'Vallabhbhai Patel': PATEL },
    );
    const found = await readCommemorates(places, subsetOnlyDoor(), read);
    expect(Object.fromEntries([...found].map(([qid, value]) => [qid, [value.via, value.subjects.map((s) => s.item)]]))).toEqual({
      [LINCOLN_MEMORIAL]: ['commemorates', [LINCOLN]],
      [STATUE_OF_UNITY]: ['memorials-category', [PATEL]],
      [HERMANNSDENKMAL]: ['main-subject', [ARMINIUS]],
      [ALEXANDER_COLUMN]: ['named-after', [ALEXANDER_I]],
      [NELSONS_COLUMN]: ['depicts', [NELSON]],
    });
    expect(read.articleItems).toHaveBeenCalledWith(['Vallabhbhai Patel', 'Horatio Nelson']);
    // Patel's article is the one his category's title resolved to, where Wikidata's sitelink is not read.
    expect(found.get(STATUE_OF_UNITY)?.subjects[0].articleUrl).toBe(article('Vallabhbhai_Patel'));
  });

  it('asks no category of a place with no English article', async () => {
    const read = wiki({}, {});
    const found = await readCommemorates([{ qid: HERMANNSDENKMAL, articleUrl: null }], subsetOnlyDoor(), read);
    expect(found.get(HERMANNSDENKMAL)?.via).toBe('main-subject');
    expect(read.categories).toHaveBeenCalledWith([]);
    expect(read.articleItems).not.toHaveBeenCalled();
  });
});

describe('the live twins', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const entity = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}` });

  it('read the four statements of each place, by item where the answer has no statement order', async () => {
    const sparql = vi.fn<SparqlFn>(async () => [
      { e: entity(NELSONS_COLUMN), depicts: entity(TRAFALGAR) },
      { e: entity(NELSONS_COLUMN), depicts: entity(NELSON) },
      { e: entity(LINCOLN_MEMORIAL), commemorates: entity(LINCOLN) },
      { e: entity(ALEXANDER_COLUMN), namesake: entity(ALEXANDER_I) },
      { e: entity(HERMANNSDENKMAL), subject: entity(ARMINIUS) },
    ]);
    const answer = await fetchSubjectClaims(sparql, [NELSONS_COLUMN, LINCOLN_MEMORIAL, ALEXANDER_COLUMN, HERMANNSDENKMAL]);
    expect(answer.get(NELSONS_COLUMN)?.depicts).toEqual([NELSON, TRAFALGAR]);
    expect(answer.get(LINCOLN_MEMORIAL)?.commemorates).toEqual([LINCOLN]);
    expect(answer.get(ALEXANDER_COLUMN)?.namedAfter).toEqual([ALEXANDER_I]);
    expect(answer.get(HERMANNSDENKMAL)?.mainSubjects).toEqual([ARMINIUS]);
    expect(subsetSubjectClaims).not.toHaveBeenCalled();
  });

  it('read what each value is, and no label the service answers with an id', async () => {
    const sparql = vi.fn<SparqlFn>(async () => [
      { v: entity(NELSON), vLabel: { value: 'Horatio Nelson' }, human: { value: 'true' } },
      { v: entity(TRAFALGAR), vLabel: { value: 'Battle of Trafalgar' }, event: { value: 'true' } },
      { v: entity(LION), vLabel: { value: 'lion' } },
      { v: entity('Q999999999'), vLabel: { value: 'Q999999999' } },
    ]);
    const answer = await fetchSubjectKinds(sparql, [NELSON, TRAFALGAR, LION, 'Q999999999']);
    expect(answer.get(NELSON)).toEqual(person('Horatio Nelson'));
    expect(answer.get(TRAFALGAR)).toEqual(event('Battle of Trafalgar'));
    expect(answer.get(LION)).toEqual(thing('lion'));
    expect(answer.has('Q999999999')).toBe(false);
  });
});

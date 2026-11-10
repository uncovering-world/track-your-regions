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
 *
 * What a religious work shows (#2404), from the same subset on 2026-11-09:
 * Christ the Redeemer (Q79961) is about Jesus Christ (Q302); the Column of
 * Marcus Aurelius (Q265384) is named after him (Q1430) and depicts Paul the
 * Apostle (Q9200), whose statue has stood on it since 1589; the Holy Trinity
 * Column in Olomouc (Q742362) is filed under *Statues of Jesus* and *Statues
 * of the Virgin Mary*; the Plague Column in Vienna (Q688614) commemorates the
 * Holy Trinity (Q37090) and the plague (Q133780); the Republic Monument in
 * Istanbul (Q1143790) depicts Atatürk (Q5152), Aralov (Q2636506), Voroshilov
 * (Q186185), Çakmak (Q328331) and İnönü (Q183297); the Statue of St.
 * Wenceslas (Q3497632) commemorates and depicts him (Q196527).
 *
 * A war narrowed by the place's own significant event (#2412): the Hiroshima
 * Peace Memorial (Q231140) names the atomic bombing of Hiroshima (Q703203).
 *
 * A category's title that is a redirect (#2416): Our Lady of the Rockies
 * (Q7111031) is filed under *Statues of the Virgin Mary*, a redirect to Mary
 * (Q345); the National Monument to the Forefathers (Q4343546) under
 * *Monuments and memorials to the Pilgrims*, a redirect to pilgrimage
 * (Q1644573).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../subset/commemorates.js', async (actual) => ({ ...(await actual<object>()), subsetSubjectClaims: vi.fn(), subsetSubjectKinds: vi.fn() }));
vi.mock('../subset/kit.js', async (actual) => ({ ...(await actual<object>()), subsetEnglishArticles: vi.fn() }));

import { subsetSubjectClaims, subsetSubjectKinds } from '../subset/commemorates.js';
import { subsetEnglishArticles } from '../subset/kit.js';
import { subsetOnlyDoor } from '../subset/reader.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { MAX_COMMEMORATED_SUBJECTS } from '@tyr/shared/commemorates';
import {
  categoryTitles, CONCERNING_CATEGORIES, fetchSubjectClaims, fetchSubjectKinds, MAX_DEDICATED_FIGURES, MEMORIALS_CATEGORY, readCommemorates,
  readingOfPlace, STATUES_CATEGORY, type CommemorationWiki, type FiledSubjects, type ResolvedArticle, type SubjectClaims, type SubjectKind,
} from './commemorates.js';
import { namedInPlace } from './placeNames.js';

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
const JESUS = 'Q302';
const MARCUS_AURELIUS = 'Q1430';
const PAUL = 'Q9200';
const HOLY_TRINITY = 'Q37090';
const PLAGUE = 'Q133780';
const WENCESLAS = 'Q196527';
const REPUBLIC_FOUNDERS = ['Q5152', 'Q2636506', 'Q186185', 'Q328331', 'Q183297'];
const TREPTOW_MEMORIAL = 'Q48441';
const WW2 = 'Q362';
const BATTLE_OF_BERLIN = 'Q154182';
const HIROSHIMA_PEACE_MEMORIAL = 'Q231140';
const OUR_LADY_OF_THE_ROCKIES = 'Q7111031';
const MARY = 'Q345';
const FOREFATHERS = 'Q4343546';
const PILGRIMAGE = 'Q1644573';
const BOMBING_OF_HIROSHIMA = 'Q703203';

const article = (title: string) => `https://en.wikipedia.org/wiki/${title}`;
const claims = (over: Partial<SubjectClaims> = {}): SubjectClaims => ({
  commemorates: [], mainSubjects: [], namedAfter: [], depicts: [], significantEvents: [], ...over,
});
const NOT: Omit<SubjectKind, 'label'> = { human: false, event: false, holy: false, classical: false, war: false, occurrence: false, span: null };
const person = (label: string): SubjectKind => ({ ...NOT, label, human: true });
const event = (label: string): SubjectKind => ({ ...NOT, label, event: true, occurrence: true });
const thing = (label: string): SubjectKind => ({ ...NOT, label });
const holy = (label: string, human = true): SubjectKind => ({ ...NOT, label, human, holy: true });

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
  [JESUS, holy('Jesus Christ')],
  [MARCUS_AURELIUS, person('Marcus Aurelius')],
  [PAUL, holy('Paul the Apostle')],
  [HOLY_TRINITY, holy('Holy Trinity', false)],
  [PLAGUE, event('plague')],
  [WENCESLAS, holy('Saint Wenceslaus I, Duke of Bohemia')],
  [MARY, holy('Mary')],
  [PILGRIMAGE, thing('pilgrimage')],
  ...REPUBLIC_FOUNDERS.map((item, i) => [item, person(`Founder ${i + 1}`)] as const),
  [WW2, { ...event('World War II'), war: true, span: { from: 19390901, to: 19450902 } }],
  [BATTLE_OF_BERLIN, { ...event('Battle of Berlin'), span: { from: 19450416, to: 19450502 } }],
  [BOMBING_OF_HIROSHIMA, { ...event('atomic bombing of Hiroshima'), span: { from: 19450806, to: 19450806 } }],
]);
const ARTICLES = new Map([[LINCOLN, article('Abraham_Lincoln')], [NELSON, article('Horatio_Nelson,_1st_Viscount_Nelson')]]);
const NOTHING_FILED: FiledSubjects = { memorials: [], concerning: [], statues: [], statueCategories: 0 };
const filedAs = (over: Partial<FiledSubjects>): FiledSubjects => ({ ...NOTHING_FILED, ...over });

/** Whom the place commemorates, as the card's "Commemorates" line names them. */
const subjectsOfPlace = (c: SubjectClaims, f: FiledSubjects, k: ReadonlyMap<string, SubjectKind>, a: ReadonlyMap<string, string>) =>
  readingOfPlace(c, f, k, a).commemorates;

describe('the steps of the reading', () => {
  it('takes every item Wikidata says the place commemorates first, whatever else it names', () => {
    expect(subjectsOfPlace(claims({ commemorates: [LINCOLN], namedAfter: [LINCOLN], depicts: [LINCOLN] }), NOTHING_FILED, KINDS, ARTICLES))
      .toEqual({ via: 'commemorates', subjects: [{ item: LINCOLN, label: 'Abraham Lincoln', articleUrl: article('Abraham_Lincoln') }] });
  });

  it('takes a memorials category before the main subject, with no article where the item has none', () => {
    expect(subjectsOfPlace(claims({ mainSubjects: [PATEL], depicts: [PATEL] }), filedAs({ memorials: [PATEL] }), KINDS, ARTICLES))
      .toEqual({ via: 'memorials-category', subjects: [{ item: PATEL, label: 'Sardar Vallabhbhai Patel', articleUrl: null }] });
  });

  it('keeps at most as many subjects as a curator may save back', () => {
    // Synthetic items: a war memorial naming its dead one by one.
    const dead = Array.from({ length: MAX_COMMEMORATED_SUBJECTS + 10 }, (_, i) => `Q${900000001 + i}`);
    const kinds = new Map(dead.map((item, i) => [item, person(`Soldier ${i + 1}`)]));
    const read = subjectsOfPlace(claims({ commemorates: dead }), NOTHING_FILED, kinds, ARTICLES);
    expect(read?.subjects.map((subject) => subject.item)).toEqual(dead.slice(0, MAX_COMMEMORATED_SUBJECTS));
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
    expect(subjectsOfPlace(claims({ depicts: [NELSON] }), filedAs({ statues: [LINCOLN], statueCategories: 1 }), KINDS, ARTICLES)?.via).toBe('statues-category');
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

describe('what a work shows (#2404)', () => {
  it('reads a holy figure a statue is about as what it depicts, never as whom it commemorates', () => {
    expect(readingOfPlace(claims({ mainSubjects: [JESUS] }), NOTHING_FILED, KINDS, ARTICLES)).toEqual({
      commemorates: null,
      depicts: { via: 'main-subject', subjects: [{ item: JESUS, label: 'Jesus Christ', articleUrl: null }] },
    });
  });

  it('takes a holy figure that is no person as a main subject, where a dedication would take only a person or an event', () => {
    const guanYin = 'Q715162';
    const kinds = new Map([...KINDS, [guanYin, holy('Guan Yin', false)]]);
    expect(readingOfPlace(claims({ mainSubjects: [guanYin] }), NOTHING_FILED, kinds, ARTICLES).depicts?.subjects.map((s) => s.item))
      .toEqual([guanYin]);
  });

  it('reads the dedication and the figure on top side by side, and leaves a statement naming a holy figure a dedication', () => {
    const column = readingOfPlace(claims({ namedAfter: [MARCUS_AURELIUS], depicts: [PAUL] }), NOTHING_FILED, KINDS, ARTICLES);
    expect([column.commemorates?.via, column.commemorates?.subjects.map((s) => s.item)]).toEqual(['named-after', [MARCUS_AURELIUS]]);
    expect([column.depicts?.via, column.depicts?.subjects.map((s) => s.item)]).toEqual(['depicts', [PAUL]]);
    const plagueColumn = readingOfPlace(claims({ commemorates: [HOLY_TRINITY, PLAGUE] }), NOTHING_FILED, KINDS, ARTICLES);
    expect(plagueColumn.commemorates?.subjects.map((s) => s.item)).toEqual([HOLY_TRINITY, PLAGUE]);
    expect(plagueColumn.depicts).toBeNull();
  });

  it('does not say twice a figure the dedication already names', () => {
    const statue = readingOfPlace(claims({ commemorates: [WENCESLAS], depicts: [WENCESLAS] }), NOTHING_FILED, KINDS, ARTICLES);
    expect(statue.commemorates?.subjects.map((s) => s.item)).toEqual([WENCESLAS]);
    expect(statue.depicts).toBeNull();
  });

  it('reads nothing off the statues categories of a group, not even the holy figure among them', () => {
    // Olomouc: Statues of Jesus and Statues of the Virgin Mary, the second a title the copy resolves to nothing.
    const olomouc = readingOfPlace(claims(), filedAs({ statues: [JESUS], statueCategories: 2 }), KINDS, ARTICLES);
    expect(olomouc).toEqual({ commemorates: null, depicts: null });
    expect(subjectsOfPlace(claims(), filedAs({ statues: [LINCOLN, NELSON], statueCategories: 2 }), KINDS, ARTICLES)).toBeNull();
  });

  it(`reads of a scene of more than ${MAX_DEDICATED_FIGURES} people only whom the place is named for, and all of four`, () => {
    // The Republic Monument names none of its five founders; a monument named for the first is his.
    expect(subjectsOfPlace(claims({ depicts: REPUBLIC_FOUNDERS }), NOTHING_FILED, KINDS, ARTICLES)).toBeNull();
    expect(readingOfPlace(claims({ depicts: REPUBLIC_FOUNDERS }), NOTHING_FILED, KINDS, ARTICLES, 'Republic Monument').commemorates).toBeNull();
    expect(readingOfPlace(claims({ depicts: REPUBLIC_FOUNDERS }), NOTHING_FILED, KINDS, ARTICLES, 'Founder Monument')
      .commemorates?.subjects.map((s) => s.item)).toEqual(REPUBLIC_FOUNDERS);
    expect(subjectsOfPlace(claims({ depicts: REPUBLIC_FOUNDERS.slice(0, MAX_DEDICATED_FIGURES) }), NOTHING_FILED, KINDS, ARTICLES)?.subjects)
      .toHaveLength(MAX_DEDICATED_FIGURES);
  });
});

describe('whom of a scene a place is named for', () => {
  it('reads a depicted person by a name of four letters or more the place carries, whatever its case', () => {
    // The Luther Monument in Worms (Q1877884) depicts Martin Luther (Q9554) and Jan Hus (Q43977) among seven others.
    const luther = { item: 'Q9554', label: 'Martin Luther', articleUrl: null };
    const hus = { item: 'Q43977', label: 'Jan Hus', articleUrl: null };
    expect(namedInPlace([luther, hus], 'Luther monument Worms')).toEqual([luther]);
    expect(namedInPlace([luther, hus], 'Reformation Monument')).toEqual([]);
    expect(namedInPlace([luther, hus], undefined)).toEqual([]);
  });
});

describe('the categories that name a subject', () => {
  it('reads X off the memorials and statues categories, a leading the dropped', () => {
    const filed = ['Memorials to Vallabhbhai Patel', 'Monuments and memorials to Horatio Nelson', 'Monuments to the Holocaust',
      'Monuments and memorials in London', 'Statues of Miguel de Cervantes'];
    expect(categoryTitles(filed, MEMORIALS_CATEGORY)).toEqual(['Vallabhbhai Patel', 'Horatio Nelson', 'Holocaust']);
    expect(categoryTitles(filed, STATUES_CATEGORY)).toEqual(['Miguel de Cervantes']);
  });

  it('reads X off the categories of what a memorial concerns, a class among them that the reading then takes for nobody', () => {
    const filed = ['Monuments and memorials related to Napoleonic Wars', 'Warsaw Uprising monuments and memorials',
      'World War I memorials in New Zealand', 'Military monuments and memorials', 'Monuments and memorials in Warsaw'];
    expect([...new Set(CONCERNING_CATEGORIES.flatMap((pattern) => categoryTitles(filed, pattern)))])
      .toEqual(['Napoleonic Wars', 'Warsaw Uprising', 'Military', 'World War I']);
  });

  it('takes a category of what a memorial concerns only where it names a person or an event', () => {
    const military = 'Q8473';
    const kinds = new Map([...KINDS, [military, thing('military')]]);
    expect(subjectsOfPlace(claims(), filedAs({ concerning: [military] }), kinds, ARTICLES)).toBeNull();
    expect(subjectsOfPlace(claims(), filedAs({ concerning: [military, TRAFALGAR] }), kinds, ARTICLES)?.subjects.map((s) => s.item))
      .toEqual([TRAFALGAR]);
  });

  it('reads no class of people English Wikipedia writes with a small letter', () => {
    // The Bronze Soldier of Tallinn and the Little Insurrectionist are filed so.
    expect(categoryTitles(['Statues of military personnel', 'Statues of men in Poland'], STATUES_CATEGORY)).toEqual([]);
  });
});

describe('reading the places of a run', () => {
  /** English Wikipedia: each article's categories, the items of titles, and the items titles only redirect to. */
  const wiki = (categories: Record<string, string[]>, items: Record<string, string>, redirects: Record<string, string> = {}): CommemorationWiki => ({
    categories: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, categories[t] ?? []]))),
    articleItems: vi.fn(async (titles: string[]) => new Map<string, ResolvedArticle>(titles.flatMap((t): Array<[string, ResolvedArticle]> => {
      if (items[t]) return [[t, { item: items[t], redirected: false }]];
      return redirects[t] ? [[t, { item: redirects[t], redirected: true }]] : [];
    }))),
    leads: vi.fn(async () => new Map<string, string>()),
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
      [TREPTOW_MEMORIAL, claims({ commemorates: [WW2] })],
      [HIROSHIMA_PEACE_MEMORIAL, claims({ significantEvents: [BOMBING_OF_HIROSHIMA] })],
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
    const found = new Map([...await readCommemorates(places, subsetOnlyDoor(), read)].map(([qid, reading]) => [qid, reading.commemorates!]));
    expect(Object.fromEntries([...found].map(([qid, value]) => [qid, [value.via, value.subjects.map((s) => s.item)]]))).toEqual({
      [LINCOLN_MEMORIAL]: ['commemorates', [LINCOLN]],
      [STATUE_OF_UNITY]: ['memorials-category', [PATEL]],
      [HERMANNSDENKMAL]: ['main-subject', [ARMINIUS]],
      [ALEXANDER_COLUMN]: ['named-after', [ALEXANDER_I]],
      [NELSONS_COLUMN]: ['depicts', [NELSON]],
    });
    expect(read.articleItems).toHaveBeenCalledWith(['Vallabhbhai Patel', 'Horatio Nelson']);
    // No reading names a war, so no lead is asked for.
    expect(read.leads).not.toHaveBeenCalled();
    // Patel's article is the one his category's title resolved to, where Wikidata's sitelink is not read.
    expect(found.get(STATUE_OF_UNITY)?.subjects[0].articleUrl).toBe(article('Vallabhbhai_Patel'));
  });

  it('narrows a war to the battle the lead of the place says it commemorates', async () => {
    const read = wiki({}, { 'Battle of Berlin': BATTLE_OF_BERLIN });
    vi.mocked(read.leads).mockResolvedValue(new Map([['Soviet War Memorial (Treptower Park)',
      'The memorial commemorates the soldiers who fell in the [[Battle of Berlin]].']]));
    const found = await readCommemorates([
      { qid: TREPTOW_MEMORIAL, articleUrl: article('Soviet_War_Memorial_(Treptower_Park)') },
      { qid: LINCOLN_MEMORIAL, articleUrl: article('Lincoln_Memorial') },
    ], subsetOnlyDoor(), read);
    expect(read.leads).toHaveBeenCalledWith(['Soviet War Memorial (Treptower Park)']);
    expect(found.get(TREPTOW_MEMORIAL)?.commemorates).toEqual({
      via: 'war-narrowed-by-lead', subjects: [{ item: BATTLE_OF_BERLIN, label: 'Battle of Berlin', articleUrl: article('Battle_of_Berlin') }],
    });
    expect(found.get(LINCOLN_MEMORIAL)?.commemorates?.via).toBe('commemorates');
  });

  it('narrows a war its categories read to the significant event Wikidata names for the place', async () => {
    const read = wiki({ 'Hiroshima Peace Memorial': ['World War II memorials in Japan'] }, { 'World War II': WW2 });
    vi.mocked(read.leads).mockResolvedValue(new Map([['Hiroshima Peace Memorial', 'The ruin serves as a memorial to the people killed in the bombing.']]));
    const found = await readCommemorates([
      { qid: HIROSHIMA_PEACE_MEMORIAL, articleUrl: article('Hiroshima_Peace_Memorial'), label: 'Hiroshima Peace Memorial' },
    ], subsetOnlyDoor(), read);
    expect(found.get(HIROSHIMA_PEACE_MEMORIAL)?.commemorates).toEqual({
      via: 'war-narrowed-by-event', subjects: [{ item: BOMBING_OF_HIROSHIMA, label: 'atomic bombing of Hiroshima', articleUrl: null }],
    });
  });

  it('takes a category\'s subject only a redirect names where it is a person, an event or a holy figure (#2416)', async () => {
    // *Virgin Mary* redirects to Mary, mother of Jesus; *Pilgrims* to Pilgrimage, which no memorial to the Pilgrims is for.
    const read = wiki(
      { 'Our Lady of the Rockies': ['Statues of the Virgin Mary'], 'National Monument to the Forefathers': ['Monuments and memorials to the Pilgrims'] },
      {}, { 'Virgin Mary': MARY, Pilgrims: PILGRIMAGE },
    );
    const found = await readCommemorates([
      { qid: OUR_LADY_OF_THE_ROCKIES, articleUrl: article('Our_Lady_of_the_Rockies') },
      { qid: FOREFATHERS, articleUrl: article('National_Monument_to_the_Forefathers') },
    ], subsetOnlyDoor(), read);
    expect(found.get(OUR_LADY_OF_THE_ROCKIES)?.depicts?.subjects.map((s) => s.item)).toEqual([MARY]);
    expect(found.has(FOREFATHERS)).toBe(false);
  });

  it('judges a redirect per place: another place naming the same item by its title lifts nothing', async () => {
    // A place written for the test, filed under a category whose title is Pilgrimage's own.
    const shrine = 'Q900000001';
    const read = wiki(
      { 'National Monument to the Forefathers': ['Monuments and memorials to the Pilgrims'], 'Fixture shrine': ['Monuments and memorials to Pilgrimage'] },
      { Pilgrimage: PILGRIMAGE }, { Pilgrims: PILGRIMAGE },
    );
    const found = await readCommemorates([
      { qid: FOREFATHERS, articleUrl: article('National_Monument_to_the_Forefathers') },
      { qid: shrine, articleUrl: article('Fixture_shrine') },
    ], subsetOnlyDoor(), read);
    expect(found.has(FOREFATHERS)).toBe(false);
    expect(found.get(shrine)?.commemorates?.subjects.map((s) => s.item)).toEqual([PILGRIMAGE]);
  });

  it('asks no category of a place with no English article', async () => {
    const read = wiki({}, {});
    const found = await readCommemorates([{ qid: HERMANNSDENKMAL, articleUrl: null }], subsetOnlyDoor(), read);
    expect(found.get(HERMANNSDENKMAL)?.commemorates?.via).toBe('main-subject');
    expect(read.categories).toHaveBeenCalledWith([]);
    expect(read.articleItems).not.toHaveBeenCalled();
  });
});

describe('the live twins', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const entity = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}` });

  it('read the five statements of each place, by item where the answer has no statement order', async () => {
    const sparql = vi.fn<SparqlFn>(async () => [
      { e: entity(NELSONS_COLUMN), depicts: entity(TRAFALGAR) },
      { e: entity(NELSONS_COLUMN), depicts: entity(NELSON) },
      { e: entity(LINCOLN_MEMORIAL), commemorates: entity(LINCOLN) },
      { e: entity(ALEXANDER_COLUMN), namesake: entity(ALEXANDER_I) },
      { e: entity(HERMANNSDENKMAL), subject: entity(ARMINIUS) },
      { e: entity(HIROSHIMA_PEACE_MEMORIAL), happened: entity(BOMBING_OF_HIROSHIMA) },
    ]);
    const answer = await fetchSubjectClaims(sparql, [NELSONS_COLUMN, LINCOLN_MEMORIAL, ALEXANDER_COLUMN, HERMANNSDENKMAL, HIROSHIMA_PEACE_MEMORIAL]);
    expect(answer.get(NELSONS_COLUMN)?.depicts).toEqual([NELSON, TRAFALGAR]);
    expect(answer.get(LINCOLN_MEMORIAL)?.commemorates).toEqual([LINCOLN]);
    expect(answer.get(ALEXANDER_COLUMN)?.namedAfter).toEqual([ALEXANDER_I]);
    expect(answer.get(HERMANNSDENKMAL)?.mainSubjects).toEqual([ARMINIUS]);
    expect(answer.get(HIROSHIMA_PEACE_MEMORIAL)?.significantEvents).toEqual([BOMBING_OF_HIROSHIMA]);
    expect(subsetSubjectClaims).not.toHaveBeenCalled();
  });

  it('read what each value is, and no label the service answers with an id', async () => {
    const sparql = vi.fn<SparqlFn>(async () => [
      { v: entity(NELSON), vLabel: { value: 'Horatio Nelson' }, human: { value: 'true' } },
      { v: entity(TRAFALGAR), vLabel: { value: 'Battle of Trafalgar' }, event: { value: 'true' }, occurrence: { value: 'true' } },
      { v: entity(LION), vLabel: { value: 'lion' } },
      { v: entity('Q999999999'), vLabel: { value: 'Q999999999' } },
    ]);
    const answer = await fetchSubjectKinds(sparql, [NELSON, TRAFALGAR, LION, 'Q999999999']);
    expect(answer.get(NELSON)).toEqual(person('Horatio Nelson'));
    expect(sparql.mock.calls[0][0]).toContain('wdt:P411');
    expect(sparql.mock.calls[0][0]).toContain('wd:Q1190554');
    expect(answer.get(TRAFALGAR)).toEqual(event('Battle of Trafalgar'));
    expect(answer.get(LION)).toEqual(thing('lion'));
    expect(answer.has('Q999999999')).toBe(false);
  });

  it('read a holy figure, a war and its span', async () => {
    const sparql = vi.fn<SparqlFn>(async () => [
      { v: entity(JESUS), vLabel: { value: 'Jesus Christ' }, human: { value: 'true' }, holy: { value: 'true' } },
      { v: entity(WW2), vLabel: { value: 'World War II' }, event: { value: 'true' }, war: { value: 'true' }, occurrence: { value: 'true' }, conflict: { value: 'true' },
        start: { value: '1939-09-01T00:00:00Z' }, end: { value: '1945-09-02T00:00:00Z' } },
    ]);
    const answer = await fetchSubjectKinds(sparql, [JESUS, WW2]);
    expect(answer.get(JESUS)).toEqual(holy('Jesus Christ'));
    expect(answer.get(WW2)).toEqual(KINDS.get(WW2));
  });
});

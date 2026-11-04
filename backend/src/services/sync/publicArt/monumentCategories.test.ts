/**
 * The monuments-category entrance of Monuments & memorials (#2171): what
 * English Wikipedia files under a *Monuments and memorials in/of …* category,
 * read from the copy of its categories, and what the kind's rule makes of a
 * candidate only the category names.
 *
 * Every case is a real item with the classes, containers and statements the
 * development subset of 2026-10-19 holds for it, read on 2026-11-04.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SparqlFn } from '../wikidataQueries.js';
import type { EntityFacts } from './queries.js';

const mocks = vi.hoisted(() => ({
  latestStructure: vi.fn(),
  structureItemsInCategories: vi.fn(),
  structureCategoriesOfItems: vi.fn(),
  fetchClassObjects: vi.fn(),
  fetchRootsOfClasses: vi.fn(),
  admittedWithFact: vi.fn(),
  heldByOtherSources: vi.fn(),
}));
vi.mock('../admission.js', () => ({ admittedWithFact: mocks.admittedWithFact, heldByOtherSources: mocks.heldByOtherSources }));
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: mocks.latestStructure }));
vi.mock('../wikipediaStructure.js', () => ({
  structureItemsInCategories: mocks.structureItemsInCategories,
  structureCategoriesOfItems: mocks.structureCategoriesOfItems,
}));
vi.mock('./monumentCategoryQueries.js', () => ({ fetchClassObjects: mocks.fetchClassObjects }));
vi.mock('./streetArtQueries.js', () => ({ fetchRootsOfClasses: mocks.fetchRootsOfClasses }));

import {
  categoryNote, enterMonumentCategories, filedAsMonument, heldByCategory, MONUMENTS_CATEGORY, readMonumentCategories,
  type MonumentCategoryReading,
} from './monumentCategories.js';
import { publicArtVerdict, type FiledAsMonument, type PublicArtFacts } from './publicArtTest.js';
import { buildTrees, VESSEL_ROOTS } from './classes.js';
import { MONUMENTS_RULE } from './kindRules.js';
import { goneWorkReason } from '../places/gone.js';

const sparql = vi.fn<SparqlFn>(async () => []);

const SOUTH_DAKOTA = ['Monuments and memorials in South Dakota'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.admittedWithFact.mockResolvedValue(new Map());
  mocks.heldByOtherSources.mockResolvedValue(new Set());
});

describe('the monuments-category entrance (#2171)', () => {
  it('names every item filed directly under a monuments category of the copy', async () => {
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    mocks.structureItemsInCategories.mockResolvedValue(['Q1442518', 'Q699448', 'Q83497']);
    expect(await enterMonumentCategories()).toEqual(['Q1442518', 'Q699448', 'Q83497']);
    expect(mocks.structureItemsInCategories).toHaveBeenCalledWith(MONUMENTS_CATEGORY);
    // In and of, never "to": a category of memorials to a person files people's tributes.
    const category = /^Monuments_and_memorials_(in|of)_/i;
    expect(MONUMENTS_CATEGORY).toBe(category.source);
    expect(category.test('Monuments_and_memorials_in_South_Dakota')).toBe(true);
    expect(category.test('Monuments_and_memorials_of_the_Soviet_Union')).toBe(true);
    expect(category.test('Monuments_and_memorials_to_Abraham_Lincoln')).toBe(false);
  });

  it('names no place another kind already holds, and keeps naming its own held places (#2342)', async () => {
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    // Mount Rushmore is held by no kind; Trafalgar Square is a square of Squares & streets, the Chapel Bridge a bridge.
    mocks.structureItemsInCategories.mockResolvedValue(['Q83497', 'Q129143', 'Q25225']);
    mocks.heldByOtherSources.mockResolvedValue(new Set(['Q129143', 'Q25225']));
    expect(await enterMonumentCategories()).toEqual(['Q83497']);
    expect(mocks.heldByOtherSources).toHaveBeenCalledWith(6, ['Q83497', 'Q129143', 'Q25225']);
    // A place Monuments & memorials itself holds by the categories is named whatever other kind holds it too.
    mocks.admittedWithFact.mockResolvedValue(new Map([['Q129143', ['Monuments and memorials in London']]]));
    expect((await enterMonumentCategories()).sort()).toEqual(['Q129143', 'Q83497']);
  });

  it('reads no category when no copy is built, and says so', async () => {
    mocks.latestStructure.mockResolvedValue(null);
    expect(await enterMonumentCategories()).toEqual([]);
    expect(mocks.structureItemsInCategories).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('the monuments categories are not read'));
  });

  it('names every place the source holds by the categories, whether or not the copy files it now (ADR-0175 decision 6)', async () => {
    // Mount Rushmore, published by a curator through the entrance; Patuxai, filed now.
    mocks.admittedWithFact.mockResolvedValue(new Map<string, unknown>([['Q83497', SOUTH_DAKOTA], ['Q2171009', []], ['Q2171010', 'not a list']]));
    mocks.latestStructure.mockResolvedValue(null);
    expect(await enterMonumentCategories()).toEqual(['Q83497']);
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    mocks.structureItemsInCategories.mockResolvedValue(['Q1442518']);
    expect(await enterMonumentCategories()).toEqual(['Q1442518', 'Q83497']);
    // Monuments & memorials' own rows, by the fact the run writes beside its note.
    expect(mocks.admittedWithFact).toHaveBeenCalledWith(6, 'wikipediaCategories');
    expect([...await heldByCategory()]).toEqual([['Q83497', SOUTH_DAKOTA]]);
  });
});

describe('what the verdict reads of the category\'s candidates (#2171)', () => {
  it('asks the categories that file them, whether each is a class, and the vessel roots of their classes', async () => {
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    const categories = new Map([['Q83497', ['Monuments and memorials in South Dakota']]]);
    const classObjects = new Map([['Q654476', { instances: 8781, subclass: true }]]);
    const roots = new Map([['Q898771', ['Q11446']]]);
    mocks.structureCategoriesOfItems.mockResolvedValue(categories);
    mocks.fetchClassObjects.mockResolvedValue(classObjects);
    mocks.fetchRootsOfClasses.mockResolvedValue(roots);
    const facts = new Map([
      ['Q83497', { classes: ['Q8502'] }],
      ['Q600180', { classes: ['Q898771'] }],
    ]) as unknown as ReadonlyMap<string, EntityFacts>;

    expect(await readMonumentCategories(sparql, ['Q83497', 'Q600180', 'Q654476'], facts)).toEqual({ categories, classObjects, roots });
    expect(mocks.structureCategoriesOfItems).toHaveBeenCalledWith(['Q83497', 'Q600180', 'Q654476'], MONUMENTS_CATEGORY);
    expect(mocks.fetchClassObjects).toHaveBeenCalledWith(sparql, ['Q83497', 'Q600180', 'Q654476']);
    expect(mocks.fetchRootsOfClasses).toHaveBeenCalledWith(sparql, ['Q8502', 'Q898771'], Object.keys(VESSEL_ROOTS));
  });

  it('keeps a held place\'s last-read categories where the copy files it no more, or is not built', async () => {
    mocks.admittedWithFact.mockResolvedValue(new Map([['Q83497', SOUTH_DAKOTA], ['Q1442518', ['Monuments and memorials in Vientiane']]]));
    mocks.fetchClassObjects.mockResolvedValue(new Map());
    mocks.fetchRootsOfClasses.mockResolvedValue(new Map());
    // The copy files Patuxai under Laos now, and Mount Rushmore under nothing that matches.
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    mocks.structureCategoriesOfItems.mockResolvedValue(new Map([['Q1442518', ['Monuments and memorials in Laos']]]));
    const refiled = await readMonumentCategories(sparql, ['Q83497', 'Q1442518'], new Map());
    expect([...refiled.categories].sort()).toEqual([['Q1442518', ['Monuments and memorials in Laos']], ['Q83497', SOUTH_DAKOTA]]);
    // No copy: the copy is not asked, and every held place keeps what it was last read under.
    mocks.latestStructure.mockResolvedValue(null);
    mocks.structureCategoriesOfItems.mockClear();
    const unread = await readMonumentCategories(sparql, ['Q83497'], new Map());
    expect(mocks.structureCategoriesOfItems).not.toHaveBeenCalled();
    expect([...unread.categories]).toEqual([['Q83497', SOUTH_DAKOTA]]);
  });

  it('asks nothing of no candidate', async () => {
    expect(await readMonumentCategories(sparql, [], new Map())).toEqual({ categories: new Map(), classObjects: new Map(), roots: new Map() });
    expect(mocks.structureCategoriesOfItems).not.toHaveBeenCalled();
  });

  it('names the categories in the curator\'s note', () => {
    expect(categoryNote({ categories: ['Monuments and memorials in South Dakota'] }))
      .toBe('Named by English Wikipedia\'s "Monuments and memorials in South Dakota"; no class of Wikidata names it a monument or memorial.');
  });
});

// The classes and containers as the subset holds them.
const MOUNTAIN = 'Q8502';
const BUILT_STRUCTURE = 'Q811979';
const KULTURDENKMAL = 'Q11691318';
const HERITAGE_ENSEMBLE = 'Q1516079';
const HERITAGE_SITE = 'Q358';
const MAUSOLEUM = 'Q162875';
const MONUMENT = 'Q4989906';
const DEFUNCT_PRISON = 'Q113150763';
const PRISON_MUSEUM = 'Q10500763';
const MARBLE_SCULPTURE = 'Q837249';
const CULTURAL_PROPERTY = 'Q2065736';
const STATUE = 'Q179700';
const GENRE_OF_SCULPTURE = 'Q18783400';
const COMMUNITY_ACTION_GROUP = 'Q1021128';
const THINK_TANK = 'Q155271';
const NONPROFIT = 'Q163740';
const AVIATION_ACCIDENT = 'Q744913';
const HEAVY_CRUISER = 'Q898771';
const BATTLESHIP = 'Q182531';
const MUSEUM = 'Q33506';
const ART_MUSEUM = 'Q207694';
const MUSEUM_OF_ITALY = 'Q17431399';

const trees = buildTrees({
  sculptural: ['Q860861', STATUE],
  fountain: ['Q483453'],
  commemorative: ['Q575759'],
  museum: [MUSEUM, ART_MUSEUM, MUSEUM_OF_ITALY, PRISON_MUSEUM],
  worship: ['Q1370598'],
  lost: ['Q4140840'],
});

const facts = (over: Partial<PublicArtFacts>): PublicArtFacts => ({
  qid: 'Q1', classes: [], containers: [], collections: [], commemorates: [], depicts: [], genres: [], subjects: [],
  onEarth: true, lat: 0, lon: 0, ...over,
});

/** The reading of the subset: what files each candidate, which are classes, and the vessels' roots. */
const reading: MonumentCategoryReading = {
  categories: new Map([
    ['Q83497', ['Monuments and memorials in South Dakota']],
    ['Q1442518', ['Monuments and memorials in Laos']],
    ['Q699448', ['Monuments and memorials in Germany']],
    ['Q1946569', ['Monuments and memorials in Cuba']],
    ['Q3345501', ['Monuments and memorials in India']],
  ]),
  classObjects: new Map([['Q654476', { instances: 8781, subclass: true }]]),
  roots: new Map([[HEAVY_CRUISER, ['Q11446']], [BATTLESHIP, ['Q11446']]]),
};
const filed = (e: PublicArtFacts): FiledAsMonument => filedAsMonument(e.qid, e.classes, reading);
const verdictOf = (e: PublicArtFacts) => publicArtVerdict(e, trees, MONUMENTS_RULE, undefined, filed(e));
const reasonOf = (e: PublicArtFacts): string => {
  const v = verdictOf(e);
  expect(v.pass).toBe(false);
  return (v as { reason: string }).reason;
};

describe('what the category answers for a candidate no class of the kind names (#2171)', () => {
  const admitted: Array<[string, PublicArtFacts]> = [
    ['Mount Rushmore, typed a mountain', facts({ qid: 'Q83497', classes: [MOUNTAIN], lat: 43.8789, lon: -103.4592 })],
    ['Patuxai, typed a built structure', facts({ qid: 'Q1442518', classes: [BUILT_STRUCTURE], lat: 17.9706, lon: 102.6186 })],
    ['the Monument to the Battle of the Nations, typed a heritage ensemble and site', facts({
      qid: 'Q699448', classes: [KULTURDENKMAL, HERITAGE_ENSEMBLE, HERITAGE_SITE], lat: 51.3122, lon: 12.4131,
    })],
    ['the Che Guevara Mausoleum, typed nothing but a mausoleum', facts({ qid: 'Q1946569', classes: [MAUSOLEUM], lat: 22.4026, lon: -79.9794 })],
    ['the Cellular Jail, typed a defunct prison and a prison museum', facts({
      qid: 'Q3345501', classes: [DEFUNCT_PRISON, PRISON_MUSEUM], lat: 11.675, lon: 92.748,
    })],
  ];

  for (const [what, e] of admitted) {
    it(`admits ${what}, as the category's witness answers its classes`, () => {
      // Without the category, the classes refuse it.
      expect(publicArtVerdict(e, trees, MONUMENTS_RULE).pass).toBe(false);
      // With it, the place passes for the frame to decide, and the row says the kind answered its vetoes.
      expect(verdictOf(e)).toEqual({ pass: true, type: 'monument', artwork: true });
    });
  }

  it('leaves the Skanderbeg Monument to its own class: the kind admits it without the category', () => {
    const skanderbeg = facts({ qid: 'Q609021', classes: [MONUMENT], depicts: ['Q160614'], lat: 41.3275, lon: 19.8189 });
    expect(publicArtVerdict(skanderbeg, trees, MONUMENTS_RULE)).toEqual({ pass: true, type: 'monument', artwork: false });
  });
});

describe('what the category does not answer (#2171)', () => {
  it('refuses David as the Galleria dell\'Accademia\'s work, held where it stands', () => {
    const david = facts({
      qid: 'Q179900', classes: [MARBLE_SCULPTURE, CULTURAL_PROPERTY, STATUE], lat: 43.7767, lon: 11.2595,
      containers: [{ qid: 'Q10855544', label: 'Galleria dell\'Accademia', classes: [ART_MUSEUM, MUSEUM_OF_ITALY, MUSEUM], relation: 'located in' }],
    });
    expect(verdictOf(david)).toEqual({
      pass: false, reason: 'inside Galleria dell\'Accademia: a work of a museum, not a monument or memorial', heldIn: ['Q10855544'],
    });
  });

  it('refuses the khachkar as a type of place, not one place (#2248)', () => {
    expect(reasonOf(facts({ qid: 'Q654476', classes: [GENRE_OF_SCULPTURE], lat: null, lon: null })))
      .toBe('a type of place, not one place: Wikidata names 8,781 items as instances of it (#2248): not a monument or memorial');
    // A class with no instance the subset holds is a type all the same.
    const subclass = filedAsMonument('Q7321974', [], { ...reading, classObjects: new Map([['Q7321974', { instances: 0, subclass: true }]]) });
    expect(publicArtVerdict(facts({ qid: 'Q7321974' }), trees, MONUMENTS_RULE, undefined, subclass))
      .toEqual({ pass: false, reason: 'a type of place, not one place: Wikidata makes it a subclass of another class (#2248): not a monument or memorial' });
  });

  it('refuses Last Address, which is no class on the subset, for having no point of its own', () => {
    expect(reasonOf(facts({ qid: 'Q18408321', classes: [COMMUNITY_ACTION_GROUP], lat: null, lon: null })))
      .toBe('no coordinates of its own (P625)');
  });

  it('refuses the Woodrow Wilson International Center for Scholars as an institution, by the kind\'s kill', () => {
    expect(reasonOf(facts({ qid: 'Q872975', classes: [THINK_TANK, NONPROFIT], lat: null, lon: null })))
      .toBe('not a monument or memorial: nonprofit organization');
  });

  it('refuses ValuJet Flight 592 as an event', () => {
    expect(reasonOf(facts({ qid: 'Q947452', classes: [AVIATION_ACCIDENT], lat: 25.9131, lon: -80.5781 })))
      .toBe('not a monument or memorial: aviation accident');
    // The pulling down of Saddam Hussein's statue in 2003 is filed as a monument of Baghdad.
    expect(reasonOf(facts({ qid: 'Q5451242', classes: ['Q17781833'], lat: 33.3149, lon: 44.4194 })))
      .toBe('not a monument or memorial: destruction');
  });

  it('refuses USS Indianapolis and USS Oklahoma as ships whose wrecks no kind holds, and keeps a museum ship', () => {
    expect(reasonOf(facts({ qid: 'Q600180', classes: [HEAVY_CRUISER], lat: 12.0333, lon: 134.8 })))
      .toBe('a ship, which no kind holds yet: not a monument or memorial');
    expect(reasonOf(facts({ qid: 'Q948229', classes: [BATTLESHIP], lat: 24.9667, lon: -150.1 })))
      .toBe('a ship, which no kind holds yet: not a monument or memorial');
    // A vessel the item also types a museum is boarded: USS LST-325 is a museum ship.
    const museumShip = facts({ qid: 'Q6119988', classes: [BATTLESHIP, MUSEUM], lat: 37.97, lon: -87.57 });
    expect(publicArtVerdict(museumShip, trees, MONUMENTS_RULE, undefined, filed(museumShip)).pass).toBe(true);
  });

  it('passes the Georgi Dimitrov Mausoleum to the frame, where its end of existence refuses it as gone', () => {
    const dimitrov = facts({ qid: 'Q1509145', classes: [MAUSOLEUM], lat: 42.6959, lon: 23.3263 });
    expect(verdictOf(dimitrov).pass).toBe(true);
    // The subset states its inception in 1949 and its end in 1999, and nothing that says it stands.
    expect(goneWorkReason({
      ended: true, endedYear: 1999, endedAt: { year: 1999, month: 8, day: 27, precision: 11 }, use: [], conservation: [], heritage: false,
      designatedSince: [], inceptions: [{ year: 1949, month: 7, day: 10, precision: 11 }], placedSince: [], events: [],
    })).toBe('removed in 1999');
  });
});

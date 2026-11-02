/**
 * A survey's filing is typed by its kind's own rule, read off the item's
 * classes (#2246). These hold what is counted and what is asked: a kind with
 * no types is asked nothing, a kind's trees are read once however many kinds
 * share them, and with no subset nothing is typed and the reason is said.
 * The classes are the subset's own for the items named: San Luigi dei Francesi
 * and Santa Maria del Popolo are church buildings (Q16970), the Blue Mosque a
 * mosque (Q32815), St Peter's a major basilica (Q124936) among others, the
 * Capuchin Crypt a crypt (Q192619), the Trevi Fountain a sculpture (Q860861) and
 * a fountain (Q483453).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../dumps/wikidata/subsetTables.js', () => ({ latestSubset: vi.fn(), entitiesAreHeld: vi.fn() }));
vi.mock('../sync/publicArt/queries.js', async original => ({ ...(await original<object>()), fetchEntityFacts: vi.fn() }));

import { entitiesAreHeld, latestSubset } from '../dumps/wikidata/subsetTables.js';
import { fetchEntityFacts, type EntityFacts } from '../sync/publicArt/queries.js';
import { readsSubset } from '../sync/subset/reader.js';
import type { PlaceKind } from '../sync/places/gather.js';
import { filingKey, readFilingTypes, TYPE_RULES, typeFilings, type FilingToType, type TypeRule } from './entryTypes.js';

const mockedLatest = latestSubset as unknown as ReturnType<typeof vi.fn>;
const mockedHeld = entitiesAreHeld as unknown as ReturnType<typeof vi.fn>;
const mockedFacts = fetchEntityFacts as unknown as ReturnType<typeof vi.fn>;

const CLASSES = new Map<string, string[]>([
  ['Q638283', ['Q16970', 'Q1649443']], // San Luigi dei Francesi
  ['Q869513', ['Q16970', 'Q120560']], // Santa Maria del Popolo
  ['Q12512', ['Q124936', 'Q2713379', 'Q2319498', 'Q317557', 'Q15487029']], // St Peter's Basilica
  ['Q80541', ['Q32815', 'Q35112127']], // Blue Mosque
  ['Q5037115', ['Q192619']], // Capuchin Crypt
  ['Q185382', ['Q860861', 'Q483453']], // Trevi Fountain
]);

/** A stand-in for a kind's rule: what the real one reads off the subset's class trees, here one class per type. */
const byClass = (types: Record<string, string>) => (classes: readonly string[]) =>
  classes.map(cls => types[cls]).find(type => type !== undefined) ?? null;

const filing = (regionSlug: string, slug: string, wikidata: string | null, kindSlug = 'places-of-worship', kindId = 4): FilingToType =>
  ({ regionSlug, slug, kindSlug, kindId, wikidata });

const FILINGS: FilingToType[] = [
  filing('rome', 'san-luigi-dei-francesi', 'Q638283'),
  filing('rome', 'santa-maria-del-popolo', 'Q869513'),
  filing('rome', 'st-peter-s-basilica', 'Q12512'),
  filing('istanbul', 'blue-mosque', 'Q80541'),
  // Classes no type of the stand-in fits, and an entry with no item: a street Wikidata has no item for.
  filing('rome', 'capuchin-crypt', 'Q5037115'),
  filing('rome', 'via-margutta', null, 'squares-and-streets', 9),
  // Filed under a kind with no types: neither typed nor counted.
  filing('rome', 'pantheon', 'Q99309', 'archaeology', 5),
];

describe('typing the filings', () => {
  const typed = typeFilings(FILINGS, new Map([
    [4, byClass({ Q16970: 'church', Q32815: 'mosque' })],
    [9, byClass({})],
  ]), CLASSES);

  it('files each under the type its kind\'s rule gives the item\'s classes', () => {
    expect(typed.types).toEqual(new Map([
      [filingKey('rome', 'san-luigi-dei-francesi', 'places-of-worship'), 'church'],
      [filingKey('rome', 'santa-maria-del-popolo', 'places-of-worship'), 'church'],
      [filingKey('istanbul', 'blue-mosque', 'places-of-worship'), 'mosque'],
    ]));
  });

  it('counts as untyped a filing whose classes no type fits, and as unread one whose item says nothing', () => {
    expect(typed).toMatchObject({ typed: 3, untyped: 3, unread: 1, skipped: null });
  });
});

describe('reading the types from the subset', () => {
  beforeEach(() => {
    mockedLatest.mockReset();
    mockedHeld.mockReset();
    mockedFacts.mockReset();
  });

  it('types nothing where no subset is built, says why, and asks nothing of Wikidata', async () => {
    mockedLatest.mockResolvedValue(null);

    const typed = await readFilingTypes(FILINGS);

    expect(typed).toMatchObject({ typed: 0, untyped: 6, unread: 6 });
    expect(typed.skipped).toMatch(/no local Wikidata subset is built/);
    expect(mockedFacts).not.toHaveBeenCalled();
  });

  it('asks nothing at all where no filing is under a kind with types', async () => {
    const typed = await readFilingTypes([filing('rome', 'pantheon', 'Q99309', 'archaeology', 5)]);

    expect(typed).toEqual({ types: new Map(), typed: 0, untyped: 0, unread: 0, skipped: null });
    expect(mockedLatest).not.toHaveBeenCalled();
  });

  it('reads a gather kind\'s trees once for every kind that shares them, and the classes through the subset\'s door', async () => {
    mockedLatest.mockResolvedValue({ dumpDate: '2026-10-19' });
    mockedHeld.mockResolvedValue(true);
    mockedFacts.mockImplementation(async (door: unknown, qids: string[]) => {
      expect(readsSubset(door as never)).toBe(true);
      return new Map(qids.flatMap(qid => (CLASSES.has(qid) ? [[qid, { classes: CLASSES.get(qid) } as EntityFacts]] : [])));
    });
    const trees = vi.fn(async () => ({ Q16970: 'church', Q32815: 'mosque', Q483453: 'fountain' }));
    const shared = { trees } as unknown as PlaceKind<unknown>;
    const rule: TypeRule = { kind: shared, typeOf: (classes, kindTrees) => byClass(kindTrees as Record<string, string>)(classes) };
    const trevi = filing('rome', 'trevi-fountain', 'Q185382', 'public-art', 3);

    const typed = await readFilingTypes([...FILINGS, trevi], new Map([[4, rule], [3, rule], [9, rule]]));

    expect(trees).toHaveBeenCalledTimes(1);
    expect(typed.types.get(filingKey('rome', 'trevi-fountain', 'public-art'))).toBe('fountain');
    expect(typed).toMatchObject({ typed: 4, untyped: 3, unread: 1, skipped: null });
  });
});

describe('the kinds with types', () => {
  it('are the six kinds a crowded city shows ten of a type of, each typed by its regional declaration', () => {
    expect([...TYPE_RULES.keys()].sort((a, b) => a - b)).toEqual([3, 4, 6, 7, 8, 9]);
    for (const rule of TYPE_RULES.values()) expect(rule.typeOf).toBeTypeOf('function');
  });
});

/**
 * The type a survey's entry takes within a kind (#2246): what the kind's own
 * rule files a place of the entry item's classes under — a church, a mosque, a
 * bridge, a square. A crowded city shows a kind's `crowding_limit` best-known
 * places of a type within its radius (ADR-0172), and the coverage report asks
 * of a survey what the map shows, type by type.
 *
 * One rule, one runtime: the type is the kind's surroundings declaration's
 * `typeOf`, the one the surroundings tier groups a place's neighbours by, over the
 * class trees the kind's gather reads (`PlaceKind.trees`). The trees and each
 * item's classes are read from the local Wikidata subset through the door a run
 * on the subset reads (`subsetOnlyDoor`), which refuses any question the subset
 * has no twin for, so a load asks the query service nothing. With no subset
 * built nothing is typed, and the load's summary says so.
 */

import { entitiesAreHeld, latestSubset } from '../dumps/wikidata/subsetTables.js';
import { ARCHAEOLOGY_TYPES } from '../sync/archaeology/surroundingsSites.js';
import { BRIDGES_SURROUNDINGS } from '../sync/bridges/kind.js';
import { publicArtSurroundings } from '../sync/landmarkSyncService.js';
import type { PlaceKind } from '../sync/places/gather.js';
import type { SurroundingsKind } from '../sync/places/surroundingsTier.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE } from '../sync/publicArt/kindRules.js';
import { fetchEntityFacts } from '../sync/publicArt/queries.js';
import { SQUARES_SURROUNDINGS } from '../sync/squares/kind.js';
import { subsetOnlyDoor } from '../sync/subset/reader.js';
import { TOWERS_SURROUNDINGS } from '../sync/towers/kind.js';
import { chunk, type QueryRunner } from '../sync/wikidataQueries.js';
import { WORSHIP_SURROUNDINGS } from '../sync/worshipSyncService.js';

/** What a kind's type is read with: the gather kind whose trees its rule reads, and the rule's `typeOf` over them. */
export type TypeRule = Pick<SurroundingsKind<unknown, unknown>, 'kind' | 'typeOf'>;

/**
 * The kinds whose places have types, by `experience_kinds` id, each filled by
 * the source of the same id: the six kinds of the place pass with a surroundings
 * declaration, and Archaeology, whose museums and sites a crowded city counts
 * apart (ADR-0179). A kind absent here files every entry under no type.
 */
export const TYPE_RULES: ReadonlyMap<number, TypeRule> = new Map<number, TypeRule>([
  [3, publicArtSurroundings(PUBLIC_ART_RULE)],
  [4, WORSHIP_SURROUNDINGS],
  [5, ARCHAEOLOGY_TYPES],
  [6, publicArtSurroundings(MONUMENTS_RULE)],
  [7, TOWERS_SURROUNDINGS],
  [8, BRIDGES_SURROUNDINGS],
  [9, SQUARES_SURROUNDINGS],
]);

/** One filing of an entry under a kind of the catalogue, with the item its type is read from. */
export interface FilingToType {
  regionSlug: string;
  slug: string;
  kindSlug: string;
  /** The `experience_kinds` row the register's kind is. */
  kindId: number;
  wikidata: string | null;
}

export interface FilingTypes {
  /** The type of each filing that has one, by `filingKey`. */
  types: Map<string, string>;
  /** Filings under a kind with types that got one. */
  typed: number;
  /** Filings under a kind with types that got none: no item, an item the subset says nothing of, or classes no type of the kind fits. */
  untyped: number;
  /** Of `untyped`, those with no item or an item whose classes the subset does not hold. */
  unread: number;
  /** Why nothing was typed, where nothing could be. */
  skipped: string | null;
}

export const filingKey = (regionSlug: string, slug: string, kindSlug: string): string => `${regionSlug}\n${slug}\n${kindSlug}`;

/**
 * The types of `filings` under the kinds `typers` types, from the classes each
 * item carries. A filing under a kind with no typer is neither typed nor
 * counted: its kind has no types to file it under.
 */
export function typeFilings(
  filings: readonly FilingToType[],
  typers: ReadonlyMap<number, (classes: readonly string[]) => string | null>,
  classes: ReadonlyMap<string, readonly string[]>,
): FilingTypes {
  const types = new Map<string, string>();
  let untyped = 0;
  let unread = 0;
  for (const filing of filings) {
    const typer = typers.get(filing.kindId);
    if (!typer) continue;
    const own = filing.wikidata === null ? [] : classes.get(filing.wikidata) ?? [];
    const type = own.length === 0 ? null : typer(own);
    if (type === null) {
      untyped += 1;
      if (own.length === 0) unread += 1;
      continue;
    }
    types.set(filingKey(filing.regionSlug, filing.slug, filing.kindSlug), type);
  }
  return { types, typed: types.size, untyped, unread, skipped: null };
}

/** The subset answers per batch of items, as the gather asks it. */
const FACT_BATCH = 500;

/** A runner over the subset's door: the subset is our own database, so nothing is paced and nothing is shown. */
function subsetRunner(): QueryRunner {
  return { sparql: subsetOnlyDoor(), phase: () => {}, step: async () => {} };
}

/** The types of `filings` read from the local Wikidata subset, under the kinds `rules` types. */
export async function readFilingTypes(
  filings: readonly FilingToType[], rules: ReadonlyMap<number, TypeRule> = TYPE_RULES,
): Promise<FilingTypes> {
  const asked = filings.filter(filing => rules.has(filing.kindId));
  const none = { types: new Map<string, string>(), typed: 0, untyped: asked.length, unread: asked.length };
  if (asked.length === 0) return { ...none, skipped: null };
  if (!(await latestSubset()) || !(await entitiesAreHeld())) {
    return { ...none, skipped: 'no local Wikidata subset is built, so no entry was typed (build it under Public Dumps)' };
  }
  const run = subsetRunner();
  // Public art and Monuments & memorials read one gather kind's trees: read once.
  const trees = new Map<PlaceKind<unknown>, unknown>();
  const typers = new Map<number, (classes: readonly string[]) => string | null>();
  for (const kindId of new Set(asked.map(filing => filing.kindId))) {
    const rule = rules.get(kindId) as TypeRule;
    if (!trees.has(rule.kind)) trees.set(rule.kind, await rule.kind.trees(run));
    const kindTrees = trees.get(rule.kind);
    typers.set(kindId, own => rule.typeOf?.(own, kindTrees) ?? null);
  }
  const classes = new Map<string, readonly string[]>();
  const items = [...new Set(asked.flatMap(filing => (filing.wikidata === null ? [] : [filing.wikidata])))];
  for (const batch of chunk(items, FACT_BATCH)) {
    for (const [qid, facts] of await fetchEntityFacts(run.sparql, batch)) classes.set(qid, facts.classes);
  }
  return typeFilings(asked, typers, classes);
}

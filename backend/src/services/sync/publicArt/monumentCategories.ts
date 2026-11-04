/**
 * The monuments-category entrance of Monuments & memorials (#2171): what
 * English Wikipedia files as a monument where Wikidata types it as something
 * else. Mount Rushmore is typed a mountain, Patuxai a built structure and the
 * Monument to the Battle of the Nations a heritage ensemble, and no class of
 * the kind names them; English Wikipedia files each directly under a
 * *Monuments and memorials in …* category, read from the copy of its category
 * structure (ADR-0121).
 *
 * The entrance names the candidates and nothing else. The kind's own frame
 * decides them as it decides every candidate — the world bars over the kind's
 * pool (ADR-0175) and the surroundings tier (ADR-0178) — with the category in
 * place of a class of the kind (`publicArtVerdict`'s `filed`), and every
 * arrival waits for a curator, whose note names the category. Public art reads
 * nothing of it.
 */

import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { admittedWithFact, heldByOtherSources } from '../admission.js';
import { structureCategoriesOfItems, structureItemsInCategories } from '../wikipediaStructure.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { fetchClassObjects, type ClassObject } from './monumentCategoryQueries.js';
import { fetchRootsOfClasses } from './streetArtQueries.js';
import { VESSEL_ROOTS } from './classes.js';
import type { EntityFacts } from './queries.js';
import type { FiledAsMonument } from './publicArtTest.js';

const LOG_PREFIX = '[Landmark Sync]';

/** The source that holds monuments: Monuments & memorials' (`experience_sources` id 6). */
const MONUMENTS_SOURCE_ID = 6;

/** The membership fact the categories that named a place are kept under (`WikidataLandmark.wikipediaCategories`). */
const CATEGORIES_FACT = 'wikipediaCategories';

/** The entrance's name on the kind's share (`KindShare.enteredBy`). */
export const MONUMENTS_CATEGORY_ENTRANCE = 'English Wikipedia\'s monuments categories';

/**
 * The categories the entrance reads, as the dump writes their titles: *Monuments
 * and memorials in South Dakota*, *Monuments and memorials of the Soviet Union*.
 * Measured on the copy of 2026-10-01: 826 categories file 6,127 items directly.
 */
export const MONUMENTS_CATEGORY = '^Monuments_and_memorials_(in|of)_';

/**
 * The places the source holds as admitted by the monuments categories, with
 * the categories that named them when last read (`facts.wikipediaCategories`).
 */
export async function heldByCategory(): Promise<Map<string, string[]>> {
  const held = new Map<string, string[]>();
  for (const [qid, value] of await admittedWithFact(MONUMENTS_SOURCE_ID, CATEGORIES_FACT)) {
    const titles = Array.isArray(value) ? value.filter((title): title is string => typeof title === 'string') : [];
    if (titles.length) held.set(qid, titles);
  }
  return held;
}

/**
 * Every item filed directly under one of the monuments categories that no
 * other kind holds, and every place the source holds by them. A place another
 * kind already offers is not named: the maintainer's decision was about the
 * monuments the catalogue holds under no kind, and whether such a place is a
 * monument too is #2342's recommendation to make. A place the source holds
 * that the copy cannot be read for, or that English Wikipedia has filed
 * elsewhere since, is judged by the category it was last read under rather
 * than refused for its classes (ADR-0175 decision 6), as the street-art
 * entrance keeps its held places.
 */
export async function enterMonumentCategories(): Promise<string[]> {
  const named = new Set<string>();
  if (await latestStructure()) {
    const filed = await structureItemsInCategories(MONUMENTS_CATEGORY);
    const elsewhere = await heldByOtherSources(MONUMENTS_SOURCE_ID, filed);
    for (const qid of filed) if (!elsewhere.has(qid)) named.add(qid);
    if (elsewhere.size) console.log(`${LOG_PREFIX} The monuments categories file ${elsewhere.size} places another kind holds: not named`);
  } else {
    // The live API lists a category's members, not the categories whose title
    // matches: without the copy this half reads nothing.
    console.log(`${LOG_PREFIX} No copy of English Wikipedia's categories is built: the monuments categories are not read`);
  }
  const fromCategories = named.size;
  const held = await heldByCategory();
  for (const qid of held.keys()) named.add(qid);
  console.log(`${LOG_PREFIX} English Wikipedia's monuments categories named ${named.size} items: ${fromCategories} filed now, `
    + `the rest held by them (${held.size})`);
  return [...named];
}

/** What the verdict reads of the candidates the categories alone name. */
export interface MonumentCategoryReading {
  /** The monuments categories that file each candidate. */
  categories: Map<string, string[]>;
  /** The candidates that are classes rather than one place (#2248). */
  classObjects: Map<string, ClassObject>;
  /** Which of `VESSEL_ROOTS` each of their classes is a kind of. */
  roots: Map<string, string[]>;
}

/** An empty reading: nothing filed, nothing a class. */
export const noMonumentCategories = (): MonumentCategoryReading => ({ categories: new Map(), classObjects: new Map(), roots: new Map() });

/**
 * Read what the verdict asks of `qids`, the candidates the category decides.
 * A held place the copy does not file now — no copy is built, or English
 * Wikipedia has filed it elsewhere — keeps the categories it was last read
 * under as its witness.
 */
export async function readMonumentCategories(
  sparql: SparqlFn, qids: string[], facts: ReadonlyMap<string, EntityFacts>,
): Promise<MonumentCategoryReading> {
  if (!qids.length) return noMonumentCategories();
  const classes = [...new Set(qids.flatMap((qid) => facts.get(qid)?.classes ?? []))];
  const categories = await latestStructure() ? await structureCategoriesOfItems(qids, MONUMENTS_CATEGORY) : new Map<string, string[]>();
  const asked = new Set(qids);
  for (const [qid, titles] of await heldByCategory()) {
    if (asked.has(qid) && !categories.get(qid)?.length) categories.set(qid, titles);
  }
  return {
    categories,
    classObjects: await fetchClassObjects(sparql, qids),
    roots: await fetchRootsOfClasses(sparql, classes, Object.keys(VESSEL_ROOTS)),
  };
}

/** What the verdict reads of one candidate the category decides: the categories, and what makes it no place. */
export function filedAsMonument(qid: string, classes: readonly string[], reading: MonumentCategoryReading): FiledAsMonument {
  const classObject = reading.classObjects.get(qid);
  const vessel = classes.flatMap((c) => reading.roots.get(c) ?? []).map((root) => VESSEL_ROOTS[root]).find(Boolean);
  return {
    categories: reading.categories.get(qid) ?? [],
    ...(classObject ? { classObject } : {}),
    ...(vessel ? { vessel } : {}),
  };
}

/** The note a curator reads on an arrival the category brought: which categories file it. */
export function categoryNote(filed: FiledAsMonument): string {
  const named = filed.categories.length ? filed.categories.map((title) => `"${title}"`).join(', ') : 'a monuments category';
  return `Named by English Wikipedia's ${named}; no class of Wikidata names it a monument or memorial.`;
}

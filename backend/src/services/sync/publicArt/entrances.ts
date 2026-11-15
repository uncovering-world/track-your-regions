/**
 * How Public art's candidates enter the place gather beside its classes
 * (`places/gather.ts`): its editions (`PlaceKind.editions`, #880), and its
 * entrances (`PlaceKind.entrances`), the street-art places' (#2035) and the
 * monuments categories' (#2171, `monumentCategories.ts`).
 *
 * The entrance names the places Public art's classes cannot: every article
 * filed directly under an English Wikipedia category of street art or
 * graffiti, read from the copy of the category structure (ADR-0121); every
 * item filed under the genre street art or graffiti; every item typed a wall
 * of graffiti paintings (#2055), which is all that says the East Side Gallery
 * is street art; and every street-art place the source already holds, so a
 * place a category stops naming is judged by the street-art rule
 * (`streetArtTest.ts`) rather than refused for its lack of a sculpture class.
 */

import { admittedExternalIds } from '../admission.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureItemsInCategories } from '../wikipediaStructure.js';
import type { QueryRunner } from '../wikidataQueries.js';
import { fetchItemsOfClasses, fetchItemsOfGenres } from './streetArtQueries.js';
import { CAST_GROUP, fetchCastGroupPool, type EntityFacts, type PoolEntity } from './queries.js';
import { attachCasts, fetchCastItems } from './castGroups.js';
import { readGardenMakers } from './gardens.js';
import { enterMonumentCategories, MONUMENTS_CATEGORY_ENTRANCE } from './monumentCategories.js';

const LOG_PREFIX = '[Landmark Sync]';

/** The genres a street-art place is filed under (`P136`): street art and graffiti. */
export const STREET_ART_GENRES = ['Q17516', 'Q17514'] as const;

/**
 * The classes a street-art place is typed by (`P31`, through the class tree):
 * a wall of graffiti paintings, `Hall of Fame` in Wikidata's English label.
 * Of the items typed so, the East Side Gallery is the one the line passed,
 * measured on the subset on 2026-10-26: the others are halls of fame few read
 * about.
 */
export const GRAFFITI_WALL_CLASSES = ['Q1541532'] as const;

/**
 * The English Wikipedia categories the entrance reads: a title naming street
 * art, graffiti or urban art as a word of its own, read over the title as the
 * dump writes it (underscores for spaces), case aside.
 */
export const STREET_ART_CATEGORY = '(^|_)(street_art|streetart|graffiti|urban_art)(_|$)';

/**
 * The categories of those that file people, works and media rather than
 * places: `Street artists from Brazil`, `Graffiti and unauthorised signage`
 * stays — the Lennon Wall and Beco do Batman are filed there.
 */
export const NOT_A_PLACE_CATEGORY = '(artists|crews|stubs|articles|games|media|video|images?$|people|archaeology|organizations'
  + '|festivals|works_by|books|films|albums|songs|writers|painters|muralists|fresco|wikipedia|wikiproject|templates|^images)';

/** The source that holds street-art places: Public art's (`LANDMARK_SOURCE_ID`). */
const PUBLIC_ART_SOURCE_ID = 3;

/** The entrance's name on the kind's share (`KindShare.enteredBy`). */
export const STREET_ART_ENTRANCE = 'street art';

/** Every item the street-art entrance names. */
export async function enterStreetArtPlaces(run: QueryRunner): Promise<string[]> {
  const named = new Set<string>();
  if (await latestStructure()) {
    for (const qid of await structureItemsInCategories(STREET_ART_CATEGORY, NOT_A_PLACE_CATEGORY)) named.add(qid);
  } else {
    // The live API lists a category's members, not the categories whose title
    // matches: without the copy this half reads nothing.
    console.log(`${LOG_PREFIX} No copy of English Wikipedia's categories is built: the street-art categories are not read`);
  }
  const fromCategories = named.size;
  for (const qid of await fetchItemsOfGenres(run.sparql, STREET_ART_GENRES)) named.add(qid);
  // The gather steps before the entrance's first question; this is its second.
  await run.step();
  for (const qid of await fetchItemsOfClasses(run.sparql, GRAFFITI_WALL_CLASSES)) named.add(qid);
  const held = await admittedExternalIds(PUBLIC_ART_SOURCE_ID, 'street-art');
  for (const qid of held) named.add(qid);
  console.log(`${LOG_PREFIX} The street-art entrance named ${named.size} items: ${fromCategories} by an English Wikipedia `
    + `category, the rest by the genre, the class or held as street-art places (${held.size})`);
  return [...named];
}

/**
 * What the rule reads of a candidate once the facts are in, beside its own
 * statements: a group's casts, and who made a sculpture garden's works.
 */
async function readCastGroupsAndGardens(
  run: QueryRunner, pool: Map<string, PoolEntity>, facts: Map<string, EntityFacts>,
): Promise<void> {
  await readCastGroups(run, pool, facts);
  await readGardenMakers(run, facts);
}

/**
 * The casts of every group of casts among the candidates, written onto the
 * group (#880, ADR-0145 decision 2b): the group carries the fame and enters the
 * pool, its casts carry the points and the classes the rule reads.
 */
async function readCastGroups(run: QueryRunner, pool: Map<string, PoolEntity>, facts: Map<string, EntityFacts>): Promise<void> {
  const groups = [...pool.keys()].filter(qid => facts.get(qid)?.classes.includes(CAST_GROUP));
  if (!groups.length) return;
  run.phase(`Reading the casts of ${groups.length} groups of casts...`);
  for (const [group, casts] of await fetchCastItems(run, groups)) {
    const entity = pool.get(group);
    if (entity) attachCasts(entity, facts.get(group), casts);
  }
}

/** Public art's editions: the groups of casts that enter the pool through their casts, and what the rule reads of them. */
export const PUBLIC_ART_EDITIONS = {
  enter: fetchCastGroupPool,
  attach: readCastGroupsAndGardens,
};

/**
 * The street-art places no class names (#2035), which Public art decides by
 * their own rule, and the monuments English Wikipedia files that Wikidata
 * types as something else (#2171), which Monuments & memorials decides by its
 * frame. Each kind skips what only the other's entrance named.
 */
export const PUBLIC_ART_ENTRANCES = {
  [STREET_ART_ENTRANCE]: enterStreetArtPlaces,
  [MONUMENTS_CATEGORY_ENTRANCE]: enterMonumentCategories,
};

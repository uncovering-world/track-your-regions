/**
 * The two class questions this kind asks that no other collector already asks.
 *
 * Everything else it needs is a question some other import already sends: the
 * pool of places and the facts about them are the public-art questions, which
 * are generic over `P31` (`publicArt/queries.ts`); the pool of works, the venue
 * statements and the venue graph are the museum's (`museum/queries.ts`). What
 * is particular to a kind whose subject is the building is which classes make
 * a place of worship, what a reader would call it, and what inside it is worth
 * tracking on its own.
 */

import { fetchClassTree, type QueryRunner } from '../wikidataQueries.js';
import {
  buildWorshipTrees,
  TYPE_ROOTS,
  WORSHIP_ROOT,
  WORSHIP_TREASURE_CLASSES,
  type WorshipTrees,
  type WorshipType,
} from './classes.js';

/**
 * What a place of worship is, and what a reader filters it by: the tree under
 * `structure of worship`, and one tree per type in `TYPE_ROOTS`.
 *
 * A tree each rather than one walk, because the type answer *is* which tree a
 * row's classes reach — a cathedral and a mosque are both under the root, and
 * the root cannot tell them apart. The traversal is in class space, which is
 * cheap: 1265 classes under the root, measured, and a few dozen under most
 * type roots.
 *
 * Only the `roots` of each entry are walked, never its `direct` classes: the
 * generic `temple` and `shrine` have the whole kind under them — measured
 * 2026-09-08, `church building`, `cathedral` and `chapel` are under both — so
 * they are matched as a row's own class and their trees are never asked for.
 */
export async function fetchWorshipTrees(run: QueryRunner): Promise<WorshipTrees> {
  run.phase('Reading what a place of worship is...');
  await run.step();
  const worship = await fetchClassTree(run.sparql, WORSHIP_ROOT, 'places of worship');

  const typeTrees = {} as Record<WorshipType, string[]>;
  for (const { type, roots } of TYPE_ROOTS) {
    run.phase(`Reading what a ${type} is...`);
    const classes: string[] = [];
    for (const root of roots) {
      await run.step();
      classes.push(...(await fetchClassTree(run.sparql, root, `${type} classes`)));
    }
    typeTrees[type] = classes;
  }
  return buildWorshipTrees({ worship, typeTrees });
}

/**
 * The classes a treasure of a place of worship can be: each root of
 * `WORSHIP_TREASURE_CLASSES` and everything under it.
 *
 * The tree, not the root alone, because Wikidata files the famous ones under a
 * narrower class than the word a person would use. The Shroud of Turin is an
 * instance of `relic associated with Jesus`, which is a `Christian relic`,
 * which is a `relic` — and a question asking for instances of `relic` itself
 * answers with one row. Measured on 2026-09-08 at 10 sitelinks or more: 1
 * direct instance of `relic` against 14 through the tree, and 132 tombs
 * against 235. The five trees together hold 264 classes, so they are taken
 * whole, as the worship tree is.
 *
 * The value of each entry is the root it was reached from, which is what a log
 * line needs; the collector reads only the keys.
 */
export async function fetchTreasureClasses(run: QueryRunner): Promise<Record<string, string>> {
  const classes: Record<string, string> = {};
  for (const [root, label] of Object.entries(WORSHIP_TREASURE_CLASSES)) {
    run.phase(`Reading what a ${label} is...`);
    await run.step();
    for (const found of await fetchClassTree(run.sparql, root, `${label} classes`)) {
      classes[found] ??= label;
    }
  }
  return classes;
}

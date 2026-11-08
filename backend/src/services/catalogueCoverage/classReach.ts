/**
 * Which kinds' classes reach a calibration top's item (#2146): a top is offered
 * only if some kind's class question names it, and a top no kind's classes
 * reach is a candidate nowhere, apart from a rule's refusal and from a
 * candidate under the line.
 *
 * One rule, one runtime: a kind's classes are the ones its gather asks its
 * candidates by (`kindClasses`, over `PlaceKind.trees`), and an item is reached
 * when one of its own classes is one of them (`namedByClass`), exactly as the
 * place gather decides a kind's share. The kinds are the place pass's own
 * (`gatheredPlaceKinds`). The trees and each item's classes are read from the
 * local Wikidata subset through the door a run on the subset reads
 * (`subsetOnlyDoor`), so the report asks the query service nothing. With no
 * subset built nothing is read, and an item whose classes the subset does not
 * hold has no reach to say.
 *
 * Only a class question is read. A kind's other doors — Public art's street-art
 * and monuments-category entrances, its groups of casts, Archaeology's map, an
 * inscription on the World Heritage list — reach places no class names. A top
 * such a door brought into the catalogue is held or offered before its reach is
 * asked; one it names and no run kept still reads as reached by no class, which
 * is what it is, and its calibration entry's note says which door is its.
 */

import { entitiesAreHeld, latestSubset } from '../dumps/wikidata/subsetTables.js';
import { kindClasses, namedByClass } from '../sync/places/gather.js';
import { gatheredPlaceKinds } from '../sync/places/placePass.js';
import { termsOf } from '../sync/subset/entities.js';
import { fetchEntityFacts } from '../sync/publicArt/queries.js';
import { chunk } from '../sync/wikidataQueries.js';
import { subsetRunner } from './entryTypes.js';

/** One item's classes as the subset holds them, each with its label where the subset has one. */
export interface ItemClass {
  qid: string;
  label: string | null;
}

/** What the kinds' classes reach of a set of items. */
export interface ClassReach {
  /** The `experience_kinds` rows whose classes were read: a top of another kind's list has no reach to say. */
  kinds: ReadonlySet<number>;
  /** For each item whose classes the subset holds, the kinds whose classes reach it, and its classes. */
  items: ReadonlyMap<string, { reachedBy: readonly number[]; classes: readonly ItemClass[] }>;
}

/** One kind's classes, with the catalogue kinds it fills. */
export interface KindClasses {
  kindIds: readonly number[];
  classes: ReadonlySet<string>;
}

/** The kinds whose classes reach an item carrying `own`, in the order `kinds` names them. */
export function reachedBy(kinds: readonly KindClasses[], own: readonly string[]): number[] {
  return kinds.filter(({ classes }) => namedByClass(classes, own)).flatMap(({ kindIds }) => kindIds);
}

/** The subset answers per batch of items, as the gather asks it. */
const FACT_BATCH = 500;

/** The kinds' class reach of `items`, read from the local Wikidata subset; null where no subset is built. */
export async function readClassReach(items: readonly string[]): Promise<ClassReach | null> {
  if (!(await latestSubset()) || !(await entitiesAreHeld())) return null;
  const run = subsetRunner();
  const kinds: KindClasses[] = [];
  for (const { kindIds, kind } of gatheredPlaceKinds()) kinds.push({ kindIds, classes: kindClasses(kind, await kind.trees(run)) });
  const classes = new Map<string, readonly string[]>();
  for (const batch of chunk([...new Set(items)], FACT_BATCH)) {
    for (const [qid, facts] of await fetchEntityFacts(run.sparql, batch)) if (facts.classes.length > 0) classes.set(qid, facts.classes);
  }
  const terms = await termsOf([...new Set([...classes.values()].flat())]);
  const reach = new Map([...classes].map(([qid, own]) => [qid, {
    reachedBy: reachedBy(kinds, own),
    classes: own.map(cls => ({ qid: cls, label: terms.get(cls)?.label ?? null })),
  }]));
  return { kinds: new Set(kinds.flatMap(({ kindIds }) => kindIds)), items: reach };
}

/**
 * Whether a candidate is a tower a traveller climbs or looks at (#1854), and
 * the type it is filed under. The classes are `classes.ts`'; the fame line is
 * the classifier's (`kind.ts`).
 */

import { KILLS, OTHER_KINDS, TOWER_TYPES, type TowerTrees, type TowerType } from './classes.js';

export interface TowerFacts {
  classes: readonly string[];
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type TowerVerdict =
  | { pass: true; type: TowerType }
  | { pass: false; reason: string };

const carries = (classes: readonly string[], set: ReadonlySet<string>) => classes.some((c) => set.has(c));

/**
 * The verdict, in order:
 * 1. what is no place to visit: destroyed, proposed, a bare mast, ruins;
 * 2. what another kind holds: a lighthouse, a bridge, a city gate or a gate
 *    tower, a sculpture, a skyscraper (#1857). A TV or observation tower that
 *    Wikidata also calls a skyscraper is still a tower (the Oriental Pearl
 *    Tower), since its type names what it is visited for;
 * 3. a place of worship whose only tower class names its part (Hagia Sophia's
 *    minarets): Places of worship offers it. A worship class that is itself a
 *    tower class does not make one, since Wikidata files a minaret under
 *    structures of worship and the Qutb Minar is nothing but a minaret;
 * 4. an archaeological site no type of tower names (a nuraghe, a broch):
 *    Archaeology offers it;
 * 5. a candidate no tower class names, or one with no point on this planet.
 */
export function towerVerdict(facts: TowerFacts, trees: TowerTrees): TowerVerdict {
  const { classes } = facts;
  for (const [key, { reason }] of Object.entries(KILLS)) {
    if (carries(classes, trees.kills[key])) return { pass: false, reason };
  }
  const visitedTower = carries(classes, trees.types['observation-tower']);
  for (const [key, { reason }] of Object.entries(OTHER_KINDS)) {
    if (!carries(classes, trees.others[key])) continue;
    const building = key === 'skyscraper' || key === 'officeBuilding' || key === 'towerBlock';
    if (building && visitedTower) continue;
    return { pass: false, reason };
  }
  const towerClasses = classes.filter((c) => trees.tower.has(c));
  if (towerClasses.length === 0) return { pass: false, reason: 'no tower class' };
  const worshipBuilding = classes.some((c) => trees.worship.has(c) && !trees.tower.has(c));
  if (worshipBuilding && towerClasses.every((c) => trees.worshipParts.has(c))) {
    return { pass: false, reason: 'a place of worship with a tower, not a tower' };
  }
  const type = towerType(classes, trees);
  if (type === 'tower' && carries(classes, trees.archaeologicalSite)) {
    return { pass: false, reason: 'an archaeological site, not a tower' };
  }
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type };
}

/** The most telling type its classes name, `tower` where none does. */
export function towerType(classes: readonly string[], trees: TowerTrees): TowerType {
  for (const type of TOWER_TYPES) {
    if (type === 'tower') break;
    if (carries(classes, trees.types[type])) return type;
  }
  return 'tower';
}

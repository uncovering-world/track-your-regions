/**
 * Parks & gardens as a place kind over the place gather (#2254): built from its
 * declaration (`classes.ts`, #2318), its trees and pool classes, its rule and
 * the world bars.
 *
 * A proposed kind, declared in the six kinds' shape to test whether the
 * admission frame takes a kind from its declaration alone. It has no source and
 * no kind of its own yet, and no pass reads it: a dry run calls it. The world
 * tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`), the surroundings tier by ADR-0171's cut
 * (`places/surroundingsTier.ts`). The kind's canon is
 * `db/catalogue-coverage/calibration/parks-and-gardens.jsonl`.
  *
 * The verdict, in the order `places/declaredKind.ts` reads it: what is no
 * place to visit; what another kind offers whatever else it is (a national,
 * state or provincial park, a place of worship, a cemetery); a candidate no
 * class of the kind names; what the park tree holds that is no park a visitor
 * walks in, unless a park or garden class of its own names it (a protected
 * area, a zoo, an amusement or miniature park, a garden square, a sports
 * ground, a business park, an allotment: Gorky Park, an amusement park and a
 * park, stays); the exceptions of `PARKS_DECLARATION`; a candidate with no
 * point on this planet.
 */

import { declaredKind, type DeclaredTrees, type PlaceFacts } from '../places/declaredKind.js';
import { PARKS_DECLARATION, type ParkType } from './classes.js';

const PARKS = declaredKind(PARKS_DECLARATION);

export type ParkTrees = DeclaredTrees<ParkType>;
export type ParkFacts = PlaceFacts;
export const PARKS_KIND = PARKS.kind;
export const parkVerdict = PARKS.verdict;
export const parkType = PARKS.typeOf;
export const classifyParks = PARKS.classify;
export const PARKS_SURROUNDINGS = PARKS.surroundings;
export const PARKS_CLASSIFIER = PARKS.classifier;

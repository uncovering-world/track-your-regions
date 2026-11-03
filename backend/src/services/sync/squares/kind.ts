/**
 * Squares & streets as a place kind over the place gather (#1867): built from
 * its declaration (`classes.ts`, #2318), its trees and pool classes, its rule
 * and the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`). The third bar — readers where a guide marks the
 * place — matters most here: guides often name the monument on a square
 * rather than the square, and an expressway can be read as much as a street a
 * traveller crosses a city for. The kind's canon is
 * `db/catalogue-coverage/calibration/squares-and-streets.jsonl`.
 *
 * The verdict, in the order `places/declaredKind.ts` reads it: what is no
 * place to visit; what another kind offers, or no square or street a visitor
 * walks (a place of worship, a palace, a bridge, an archaeological site or an
 * ancient agora, a bullring, a railway line, a motorway, a river); a candidate
 * no class of the kind names; a canal only the bare thoroughfare names (Venice's
 * Grand Canal is a waterway, while Nyhavn, a canal and a street, is a quay a
 * visitor walks); a candidate with no point on this planet. A neighbourhood is
 * no refusal: Wikidata files a shopping street under neighbourhoods, and Oxford
 * Street and Fifth Avenue are streets a visitor walks.
 */

import { declaredKind, type DeclaredTrees, type PlaceFacts } from '../places/declaredKind.js';
import { SQUARES_DECLARATION, type SquareType } from './classes.js';

/** The source that fills Squares & streets, and the kind it fills (migration 151). */
export const SQUARES_SOURCE_ID = 9;

const SQUARES = declaredKind(SQUARES_DECLARATION);

export type SquareTrees = DeclaredTrees<SquareType>;
export type SquareFacts = PlaceFacts;
export const SQUARES_KIND = SQUARES.kind;
export const squareVerdict = SQUARES.verdict;
export const squareType = SQUARES.typeOf;
export const classifySquares = SQUARES.classify;
export const SQUARES_SURROUNDINGS = SQUARES.surroundings;
export const SQUARES_CLASSIFIER = SQUARES.classifier;

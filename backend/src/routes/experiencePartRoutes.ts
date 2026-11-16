/**
 * A place's parts on the curator's card (#2118), mounted at /api/experiences
 * with the curation routes (ADR-0071): what a place's *Parts* and *Part of*
 * sections read, the places a curator may add, a curator's word that a place
 * is a part of a whole or is taken out of it, and a list line moved to the
 * place it names (#2527). In a module of its own because the curation routes'
 * file is at the size the development guide allows.
 */

import { defineRoute } from '../api/route.js';
import { PartCandidates, PartLineMoved, PartWordAnswered, PlaceParts } from '../api/responses/parts.js';
import {
  addPart, findPartCandidates, listPlaceParts, replacePartPlace, takeOutPart,
} from '../controllers/experience/index.js';
import { authenticatedLimiter } from '../middleware/rateLimiter.js';
import { idParamSchema } from '../types/index.js';
import {
  partCandidatesQuerySchema, partWordBodySchema, replacePartBodySchema, takeOutPartBodySchema,
} from '../types/partSchemas.js';

export const experiencePartRoutes = [
  // What a place's card shows of its parts and wholes, and the places a curator
  // may add (#2118): reads, in the scope of the place.
  defineRoute({
    method: 'get', path: '/:id/parts', access: 'curator', cache: 'no-store',
    summary: 'List a place\'s parts and the wholes it is a part of, with whose word makes each one',
    params: idParamSchema,
    response: PlaceParts,
    handler: listPlaceParts,
  }),
  defineRoute({
    method: 'get', path: '/:id/part-candidates', access: 'curator', cache: 'no-store',
    summary: 'Find places to add as a part of a place, or wholes to add it to, nearest first',
    params: idParamSchema,
    query: partCandidatesQuerySchema,
    response: PartCandidates,
    handler: findPartCandidates,
  }),
  // A curator's word that a place is a part of a whole, or taken out of it
  // (#2118), from either place's card: a record in the whole and a log row on
  // each place in one transaction under both places' locks, limited as the
  // kind's add is.
  defineRoute({
    method: 'post', path: '/:id/parts', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Make a place a part of this place, or put back a part kept out; take it out with parts/take-out',
    params: idParamSchema,
    body: partWordBodySchema,
    response: PartWordAnswered,
    handler: addPart,
  }),
  defineRoute({
    method: 'post', path: '/:id/parts/take-out', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Take a place out of this place\'s parts; one a source still names is kept out until put back',
    params: idParamSchema,
    body: takeOutPartBodySchema,
    response: PartWordAnswered,
    handler: takeOutPart,
  }),
  // A list line moved from the place that holds it to the place it names, in
  // one act (#2527): the line's record and points and a log row on each of the
  // three places in one transaction under their locks.
  defineRoute({
    method: 'post', path: '/:id/parts/replace', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Move a list line of this place from the part that holds it to the place it names; moving it back undoes it',
    params: idParamSchema,
    body: replacePartBodySchema,
    response: PartLineMoved,
    handler: replacePartPlace,
  }),
];

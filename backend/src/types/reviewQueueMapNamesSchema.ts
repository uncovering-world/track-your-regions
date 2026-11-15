/**
 * The places whose names the review queue map's short list asks for (#2501):
 * `ids=4120,88213`, each a row id, each once, at most `QUEUE_MAP_NAMES_MAX` of
 * them. The text is bounded before it is split, at ten digits and a comma an id,
 * so the split never reads more than that many ids however many repeat; the
 * split hands over numbers, so each is held to `bodyRowIdSchema`. Part of the
 * `types/index.ts` barrel, beside the map's own query schema.
 */

import { z } from 'zod/v4';
import { QUEUE_MAP_NAMES_MAX } from '@tyr/shared/reviewQueue';
import { bodyRowIdSchema } from './rowId.js';

/**
 * What the document says `ids` is, narrower than what the route reads: ids of
 * one to nine digits, none starting with 0, at most `QUEUE_MAP_NAMES_MAX` of
 * them. The route's own reading still decides, and every list the pattern
 * admits is one it answers, so a client generated from the document, and the
 * API contract lane, never send a list the route refuses: `0`, a run of zeros or
 * an id past int4.
 */
export const QUEUE_MAP_NAMES_PATTERN = new RegExp(String.raw`^[1-9]\d{0,8}(?:,[1-9]\d{0,8}){0,${QUEUE_MAP_NAMES_MAX - 1}}$`);

export const reviewQueueMapNamesQuerySchema = z.object({
  ids: z.string().max(QUEUE_MAP_NAMES_MAX * 11).regex(/^\d+(,\d+)*$/)
    .meta({ pattern: QUEUE_MAP_NAMES_PATTERN.source })
    .transform(value => [...new Set(value.split(',').map(Number))])
    .pipe(z.array(bodyRowIdSchema).min(1).max(QUEUE_MAP_NAMES_MAX)),
});

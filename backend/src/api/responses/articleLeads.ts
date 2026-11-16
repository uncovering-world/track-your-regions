/**
 * The first sentence of a place's English Wikipedia article (#2185): what a
 * review card shows of the place itself, under its question, so a curator who
 * has never heard of it reads what it is before answering.
 *
 * Each exported schema is the type of the same name in the web's generated
 * client, and the handler's body is held to it by `respond()`.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants, the schemas of the other modules here, and the pure
 * helpers beside `respond()` in `backend/src/api/`.
 */

import { z } from 'zod/v4';

const ArticleLead = z.strictObject({
  placeId: z.number().int(),
  title: z.string().describe("The article's title as a reader reads it, spaces and not underscores."),
  url: z.string().describe('The article, as the place holds it.'),
  sentence: z.string().describe("The first sentence of the article's lead, as Wikipedia's extract gives it in plain text."),
});

export const ReviewArticleLeads = z.strictObject({
  leads: z.array(ArticleLead).describe(
    'The asked places this curator has an open question about, with an English article whose lead was read. A place '
    + 'outside the scope, one with no English article, or one whose article Wikipedia did not answer for is left out.',
  ),
}).describe('The first sentence of the Wikipedia article of each place a page of review cards shows (#2185).');
export type ReviewArticleLeads = z.infer<typeof ReviewArticleLeads>;

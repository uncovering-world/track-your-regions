/**
 * The Wikivoyage articles that use a place's item (#2520): what a curator
 * opens behind a guide's yes, on the crowded-city figures and on the question
 * of whether a visitor goes to a place.
 *
 * Each exported schema is the type of the same name in the web's generated
 * client, and the handler's body is held to it by `respond()`.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants, the schemas of the other modules here, and the pure
 * helpers beside `respond()` in `backend/src/api/`.
 */

import { z } from 'zod/v4';

const GuideArticle = z.strictObject({
  site: z.string().describe("The edition's database name, as the dumps name it: dewikivoyage."),
  language: z.string().describe("The edition's language, as its host names it: de for de.wikivoyage.org."),
  title: z.string().describe('The article\'s title as a reader reads it, spaces and not underscores.'),
  url: z.string().describe("The article on its edition's own host, its title percent-encoded."),
});

export const GuideArticles = z.strictObject({
  item: z.string().nullable()
    .describe('The Wikidata item the guide evidence is read for, the one its source knows the place by; null where it has none.'),
  articlesKept: z.boolean()
    .describe('Whether the Wikivoyage copy in place keeps the articles: false where it was built before they were kept, or '
      + 'where no copy is in place. Then an empty list says nothing of whether a guide uses the item, and a rebuild of the '
      + 'Wikivoyage item usage keeps them.'),
  articles: z.array(GuideArticle)
    .describe('Every guide article that uses the item, by edition and then by title; empty where none does or none is kept.'),
  truncated: z.boolean().describe('More articles use the item than the read lists.'),
});
export type GuideArticles = z.infer<typeof GuideArticles>;

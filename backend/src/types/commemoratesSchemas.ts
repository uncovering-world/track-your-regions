/**
 * What a curator's list of whom or what a place commemorates may hold (#2144),
 * for the edit's body (`editExperienceBodySchema`). In a module of its own
 * because the barrel (`index.ts`) is at the size the development guide allows.
 */

import { z } from 'zod/v4';
import { tidyLabel } from '@tyr/shared/labels';
import { MAX_COMMEMORATED_SUBJECTS } from '@tyr/shared/commemorates';
import {
  ENGLISH_WIKIPEDIA_ARTICLE_MESSAGE, isEnglishWikipediaArticleUrl, normalizeStorableUrl,
} from './urlSafety.js';

/** Wikidata's own limit on the length of a label. */
const LABEL_MAX = 250;

/**
 * One subject, in the shape the runs store (`@tyr/shared/commemorates`): a
 * Wikidata item, its label as the card shows it, tidied as every stored name is
 * (`tidyLabel`), and its English Wikipedia article or null. The article is
 * Wikidata's English sitelink or nothing (`isEnglishWikipediaArticleUrl`), so
 * no other host, protocol or page reaches the card's link.
 */
const commemoratedSubjectSchema = z.strictObject({
  item: z.string().regex(/^Q[1-9]\d*$/, 'A subject is a Wikidata item, Q followed by its number'),
  label: z.string().transform(tidyLabel).pipe(z.string().min(1).max(LABEL_MAX)),
  articleUrl: z.string().trim()
    .refine(isEnglishWikipediaArticleUrl, { message: ENGLISH_WIKIPEDIA_ARTICLE_MESSAGE })
    .transform(normalizeStorableUrl)
    .pipe(z.string().max(2000))
    .nullable(),
});

/**
 * The list whole: what the card will name, an empty list included, which says
 * the place commemorates nobody. Each item at most once.
 */
export const commemoratesListSchema = z.array(commemoratedSubjectSchema).max(MAX_COMMEMORATED_SUBJECTS).refine(
  (subjects) => new Set(subjects.map((subject) => subject.item)).size === subjects.length,
  { message: 'The same subject is named twice' },
);

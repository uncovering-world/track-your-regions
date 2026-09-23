/**
 * What the place-search calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/geocode.ts` calls, declared once — places found
 * by name through Nominatim, and a picture suggested for a new experience from
 * Wikidata. The AI geocode that module also calls answers `AIGeocodeResult`, in
 * `ai.ts` beside this file, with the rest of what a model answers.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const PlaceResult = z.strictObject({
  display_name: z.string().describe('The place\'s full name as OpenStreetMap writes it, country last.'),
  lat: z.number(),
  lng: z.number(),
  type: z.string().describe('OpenStreetMap\'s word for what the place is: `city`, `museum`, `peak`, …'),
  wikidataId: z.string().nullable().describe('The Wikidata item OpenStreetMap links the place to, when it links one.'),
}).describe('One place found by name.');
export type PlaceResult = z.infer<typeof PlaceResult>;

export const PlaceSearch = z.strictObject({
  results: z.array(PlaceResult).describe('Best match first, as Nominatim ranks them.'),
}).describe('Places found by name.');
export type PlaceSearch = z.infer<typeof PlaceSearch>;

export const ImageSuggestion = z.strictObject({
  imageUrl: z.string().describe('The Wikimedia Commons file of the item\'s image statement.'),
  source: z.enum(['wikidata_direct', 'wikidata_spatial', 'wikidata_search'])
    .describe('How the item was found: by the id the curator gave, by the nearest item to the point, or by the name.'),
  entityLabel: z.string().describe('The item\'s English label, or its id when it has none, so the curator can tell whether it is the place they meant.'),
  wikidataId: z.string(),
  description: z.string().optional().describe('The item\'s English description.'),
  wikipediaUrl: z.string().optional().describe('The item\'s English Wikipedia article.'),
}).describe('A picture for a new experience, from the Wikidata item it most likely is.');
export type ImageSuggestion = z.infer<typeof ImageSuggestion>;
